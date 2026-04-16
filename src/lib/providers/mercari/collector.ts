import { existsSync } from "node:fs";

import type { MercariRawListing } from "@/lib/fixtures/types";
import {
  buildCollectorEnvelope,
  createProviderError,
  type RawMarketCollector,
} from "@/lib/providers/base";
import {
  MERCARI_BASE_URL,
  MERCARI_BROWSER_TIMEOUT_MS,
  MERCARI_CHROME_CANDIDATES,
  MERCARI_DEFAULT_ACCEPT_LANGUAGE,
  MERCARI_HTTP_TIMEOUT_MS,
  MERCARI_REQUEST_FINGERPRINTS,
  MERCARI_REQUEST_INTERVAL_MS,
  MERCARI_SEARCH_PATH,
  MERCARI_SESSION_COOLDOWN_MS,
  type MercariRequestFingerprint,
} from "@/lib/providers/mercari/config";
import {
  parseMercariDomCards,
  parseMercariSearchApiResponse,
  parseMercariSearchHtml,
  type MercariSearchStatus,
  type MercariDomCardSnapshot,
} from "@/lib/providers/mercari/parser";
import { dedupeByKey, retryTask } from "@/lib/providers/shared/runtime";
import type {
  ProviderExecutionStatus,
  ProviderQueryAttemptDebug,
  SearchQueryVariant,
} from "@/lib/types/market";
import { buildProviderQueryVariants, preprocessSearchQuery } from "@/lib/utils/query";

const MERCARI_CACHE_TTL_MS = 45_000;
const MERCARI_MAX_VARIANTS = 2;
const MERCARI_FETCH_RETRIES = 1;

type MercariRenderer = "http" | "playwright";
const MERCARI_SEARCH_API_URL_FRAGMENT = "api.mercari.jp/v2/entities:search";

interface MercariCollectorMeta extends Record<string, unknown> {
  strategy: "fetch_then_browser_fallback";
  requestCount: number;
  attemptedQueries: ProviderQueryAttemptDebug[];
  requestedUrls: string[];
  fallbackUsed: boolean;
  renderer: MercariRenderer;
  sessionId: string;
  fingerprintId?: string;
  fingerprintLabel?: string;
}

interface MercariAttemptDiagnostics {
  responseStatus?: number;
  finalUrl?: string;
  antiBotSignatures: string[];
  parserFailure: boolean;
}

interface MercariAttemptResult {
  status: ProviderExecutionStatus;
  items: MercariRawListing[];
  warnings: string[];
  requestedUrls: string[];
  retryCount: number;
  usedFallback: boolean;
  renderer: MercariRenderer;
  diagnostics: MercariAttemptDiagnostics;
}

export interface MercariSmokePreviewResult {
  query: string;
  variant: SearchQueryVariant;
  status: ProviderExecutionStatus;
  renderer: MercariRenderer;
  warnings: string[];
  requestedUrls: string[];
  diagnostics: MercariAttemptDiagnostics;
  items: MercariRawListing[];
}

const mercariCache = new Map<
  string,
  {
    expiresAt: number;
    value: ReturnType<typeof buildCollectorEnvelope<MercariRawListing, MercariCollectorMeta>>;
  }
>();

let lastMercariRequestAt = 0;
let mercariCooldownUntil = 0;
let fingerprintCursor = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMercariRateLimit() {
  const target = Math.max(lastMercariRequestAt + MERCARI_REQUEST_INTERVAL_MS, mercariCooldownUntil);
  const waitMs = Math.max(0, target - Date.now());

  if (waitMs > 0) {
    await delay(waitMs);
  }

  lastMercariRequestAt = Date.now();
}

function resolveMercariSearchUrl(query: string, status: MercariSearchStatus): string {
  const url = new URL(MERCARI_SEARCH_PATH, MERCARI_BASE_URL);
  url.searchParams.set("keyword", query);
  url.searchParams.set("status", status);
  return url.toString();
}

function resolveBrowserExecutablePath(): string | null {
  return MERCARI_CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

function getFingerprint(seed: number): MercariRequestFingerprint {
  const index = (fingerprintCursor + seed) % MERCARI_REQUEST_FINGERPRINTS.length;
  const fingerprint = MERCARI_REQUEST_FINGERPRINTS[index] ?? MERCARI_REQUEST_FINGERPRINTS[0];
  fingerprintCursor = (index + 1) % MERCARI_REQUEST_FINGERPRINTS.length;
  return fingerprint;
}

function getCachedEnvelope(cacheKey: string) {
  const cached = mercariCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    mercariCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setCachedEnvelope(
  cacheKey: string,
  value: ReturnType<typeof buildCollectorEnvelope<MercariRawListing, MercariCollectorMeta>>,
) {
  if (!["success", "partial", "empty"].includes(value.status)) {
    return;
  }

  mercariCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + MERCARI_CACHE_TTL_MS,
  });
}

function compactWarnings(warnings: string[], limit = 10): string[] {
  const unique = [...new Set(warnings.filter(Boolean))];

  if (unique.length <= limit) {
    return unique;
  }

  return [...unique.slice(0, limit), `${unique.length - limit} additional warnings omitted.`];
}

function detectAntiBotSignatures(options: {
  html: string;
  bodyText?: string;
  responseStatus?: number;
  finalUrl?: string;
}): string[] {
  const signatures: string[] = [];
  const combined = `${options.bodyText ?? ""}`;
  const title =
    options.html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";

  if ([401, 403, 429, 503].includes(options.responseStatus ?? 0)) {
    signatures.push(`http_${options.responseStatus}`);
  }

  if (/captcha/i.test(title) || /\bcaptcha\b/i.test(combined)) {
    signatures.push("captcha");
  }

  if (/access denied|forbidden/i.test(title) || /access denied|forbidden/i.test(combined)) {
    signatures.push("access_denied");
  }

  if (/verify you are human|unusual traffic/i.test(title) || /verify you are human|unusual traffic/i.test(combined)) {
    signatures.push("anti_bot_copy");
  }

  if (/しばらく時間をおいて再度お試しください|ご利用の環境ではアクセスできません/i.test(combined)) {
    signatures.push("jp_block_copy");
  }

  if (options.finalUrl && !options.finalUrl.startsWith(MERCARI_BASE_URL)) {
    signatures.push("redirected_away");
  }

  return [...new Set(signatures)];
}

function annotateItems(
  items: MercariRawListing[],
  variant: SearchQueryVariant,
  confidenceScore: number,
): MercariRawListing[] {
  return items.map((item) => ({
    ...item,
    matchedQuery: variant.query,
    queryVariantKey: variant.key,
    queryVariantLabel: variant.label,
    rawConfidence: confidenceScore,
  }));
}

function computeConfidenceScore(options: {
  itemCount: number;
  fallbackUsed: boolean;
  status: ProviderExecutionStatus;
  renderer: MercariRenderer;
}) {
  if (options.itemCount === 0) {
    return options.status === "empty" ? 0.45 : 0;
  }

  let score = options.renderer === "playwright" ? 0.88 : 0.73;

  if (options.fallbackUsed) {
    score -= 0.04;
  }

  if (options.status === "partial") {
    score -= 0.08;
  }

  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

function buildErrorInfo(status: ProviderExecutionStatus, warnings: string[]) {
  if (status === "success" || status === "empty") {
    return undefined;
  }

  const details = warnings[0];

  if (status === "blocked") {
    return createProviderError({
      type: "blocked",
      message: "Mercari blocked the search request or returned an anti-bot page.",
      retryable: true,
      details,
    });
  }

  if (status === "parse_error") {
    return createProviderError({
      type: "parse_error",
      message: "Mercari search results were fetched, but parsing failed.",
      retryable: true,
      details,
    });
  }

  return createProviderError({
    type: "unknown",
    message: "Mercari collection failed.",
    retryable: true,
    details,
  });
}

async function loadPlaywrightChromium() {
  const playwrightModule = (await import("playwright-core")) as typeof import("playwright-core");
  return playwrightModule.chromium;
}

async function runMercariFetchCollector(options: {
  url: string;
  statusHint: MercariSearchStatus;
  timeoutMs: number;
  fingerprint: MercariRequestFingerprint;
}): Promise<MercariAttemptResult> {
  await waitForMercariRateLimit();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(options.url, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":
          options.fingerprint.acceptLanguage || MERCARI_DEFAULT_ACCEPT_LANGUAGE,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: `${MERCARI_BASE_URL}/`,
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": options.fingerprint.userAgent,
        ...options.fingerprint.headers,
      },
      redirect: "follow",
      signal: controller.signal,
    });

    const html = await response.text();
    const antiBotSignatures = detectAntiBotSignatures({
      html,
      responseStatus: response.status,
      finalUrl: response.url,
    });

    if (antiBotSignatures.length > 0) {
      return {
        status: "blocked",
        items: [],
        warnings: [
          `Mercari blocked fetch response (${antiBotSignatures.join(", ")}).`,
        ],
        requestedUrls: [options.url, response.url],
        retryCount: 0,
        usedFallback: false,
        renderer: "http",
        diagnostics: {
          responseStatus: response.status,
          finalUrl: response.url,
          antiBotSignatures,
          parserFailure: false,
        },
      };
    }

    const parsed = parseMercariSearchHtml(html, {
      statusHint: options.statusHint,
      source: "http",
    });
    const status: ProviderExecutionStatus =
      parsed.items.length > 0
        ? "success"
        : parsed.emptyResult
          ? "empty"
          : "parse_error";

    return {
      status,
      items: parsed.items,
      warnings: [
        ...(response.status >= 400 ? [`Mercari fetch returned ${response.status}.`] : []),
        ...parsed.warnings,
      ],
      requestedUrls: [options.url, response.url],
      retryCount: 0,
      usedFallback: false,
      renderer: "http",
      diagnostics: {
        responseStatus: response.status,
        finalUrl: response.url,
        antiBotSignatures: [],
        parserFailure: status === "parse_error",
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runMercariBrowserCollector(options: {
  url: string;
  statusHint: MercariSearchStatus;
  timeoutMs: number;
  fingerprint: MercariRequestFingerprint;
  limit: number;
}): Promise<MercariAttemptResult> {
  const executablePath = resolveBrowserExecutablePath();

  if (!executablePath) {
    return {
      status: "blocked",
      items: [],
      warnings: ["Chrome or Edge executable was not found for Mercari browser fallback."],
      requestedUrls: [options.url],
      retryCount: 0,
      usedFallback: true,
      renderer: "playwright",
      diagnostics: {
        antiBotSignatures: ["browser_missing"],
        parserFailure: false,
      },
    };
  }

  const chromium = await loadPlaywrightChromium();
  await waitForMercariRateLimit();

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--lang=ja-JP",
    ],
  });

  try {
    const context = await browser.newContext({
      locale: "ja-JP",
      userAgent: options.fingerprint.userAgent,
      viewport: {
        width: 1440,
        height: 2200,
      },
      extraHTTPHeaders: {
        "Accept-Language":
          options.fingerprint.acceptLanguage || MERCARI_DEFAULT_ACCEPT_LANGUAGE,
        Referer: `${MERCARI_BASE_URL}/`,
      },
    });

    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, "webdriver", {
        get() {
          return undefined;
        },
      });
    });

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(Math.min(options.timeoutMs, MERCARI_BROWSER_TIMEOUT_MS));
    page.setDefaultTimeout(Math.min(options.timeoutMs, MERCARI_BROWSER_TIMEOUT_MS));
    const apiCaptureTasks: Promise<void>[] = [];
    let searchApiCapture:
      | {
          url: string;
          status: number;
          payload?: unknown;
          error?: string;
        }
      | undefined;

    page.on("response", (apiResponse) => {
      if (!apiResponse.url().includes(MERCARI_SEARCH_API_URL_FRAGMENT)) {
        return;
      }

      const captureTask = (async () => {
        try {
          searchApiCapture = {
            url: apiResponse.url(),
            status: apiResponse.status(),
            payload: await apiResponse.json(),
          };
        } catch (error) {
          searchApiCapture = {
            url: apiResponse.url(),
            status: apiResponse.status(),
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })();

      apiCaptureTasks.push(captureTask);
    });

    const response = await page.goto(options.url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(options.timeoutMs, MERCARI_BROWSER_TIMEOUT_MS),
    });
    let searchApiResponse: {
      url: () => string;
      status: () => number;
      text: () => Promise<string>;
    } | null = null;

    const pollDeadline = Date.now() + Math.min(12_000, Math.max(options.timeoutMs - 1000, 4000));
    while (Date.now() < pollDeadline) {
      const cardCount = await page
        .locator('a[data-testid="thumbnail-link"][href*="/item/"], a[href*="/item/"]')
        .count()
        .catch(() => 0);
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const hasEmptyState = bodyText.includes("出品された商品がありません");

      if (cardCount > 0 || searchApiCapture || hasEmptyState) {
        break;
      }

      if (cardCount > 0 || bodyText.includes("出品された商品がありません")) {
        break;
      }

      await page.waitForTimeout(700);
    }

    await page.waitForTimeout(250);
    await Promise.allSettled(apiCaptureTasks);
    const finalUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const html = await page.content();

    if (searchApiCapture) {
      searchApiResponse = {
        url: () => searchApiCapture?.url ?? "",
        status: () => searchApiCapture?.status ?? response?.status() ?? 0,
        text: async () => JSON.stringify(searchApiCapture?.payload ?? ""),
      };
    }

    if (searchApiCapture) {
      const parsedApi =
        searchApiCapture.payload !== undefined
          ? parseMercariSearchApiResponse(searchApiCapture.payload, {
              statusHint: options.statusHint,
              source: "playwright",
              apiUrl: searchApiCapture.url,
            })
          : {
              items: [],
              totalCells: 0,
              ignoredCells: 0,
              warnings: [
                searchApiCapture.error
                  ? `Mercari browser fallback captured the search API response, but it could not be parsed (${searchApiCapture.error}).`
                  : "Mercari browser fallback captured the search API response, but it was not valid JSON.",
              ],
              foundItemGrid: false,
              emptyResult: false,
            };

      if (parsedApi.items.length > 0 || parsedApi.emptyResult) {
        return {
          status: parsedApi.items.length > 0 ? "success" : "empty",
          items: parsedApi.items.slice(0, options.limit),
          warnings: [
            ...(response && response.status() >= 400
              ? [`Mercari browser response returned ${response.status()}.`]
              : []),
            ...parsedApi.warnings,
          ],
          requestedUrls: [options.url, finalUrl, searchApiCapture.url],
          retryCount: 0,
          usedFallback: true,
          renderer: "playwright",
          diagnostics: {
            responseStatus: searchApiCapture.status,
            finalUrl,
            antiBotSignatures: [],
            parserFailure: false,
          },
        };
      }
    }

    if (searchApiResponse) {
      const apiText = await searchApiResponse.text().catch(() => "");
      let apiPayload: unknown;

      try {
        apiPayload = apiText ? JSON.parse(apiText) : undefined;
      } catch {
        apiPayload = undefined;
      }

      const parsedApi =
        apiPayload !== undefined
          ? parseMercariSearchApiResponse(apiPayload, {
              statusHint: options.statusHint,
              source: "playwright",
              apiUrl: searchApiResponse.url(),
            })
          : {
              items: [],
              totalCells: 0,
              ignoredCells: 0,
              warnings: ["Mercari browser fallback captured the search API response, but it was not valid JSON."],
              foundItemGrid: false,
              emptyResult: false,
            };

      if (parsedApi.items.length > 0 || parsedApi.emptyResult) {
        const status: ProviderExecutionStatus =
          parsedApi.items.length > 0 ? "success" : "empty";

        return {
          status,
          items: parsedApi.items.slice(0, options.limit),
          warnings: [
            ...(response && response.status() >= 400
              ? [`Mercari browser response returned ${response.status()}.`]
              : []),
            ...parsedApi.warnings,
          ],
          requestedUrls: [options.url, finalUrl, searchApiResponse.url()],
          retryCount: 0,
          usedFallback: true,
          renderer: "playwright",
          diagnostics: {
            responseStatus: searchApiResponse.status(),
            finalUrl,
            antiBotSignatures: [],
            parserFailure: false,
          },
        };
      }
    }

    const cards = await page.$$eval(
      'a[data-testid="thumbnail-link"][href*="/item/"], a[href*="/item/"]',
      (nodes, limit) =>
        nodes.slice(0, limit).map((node) => {
          const anchor = node as HTMLAnchorElement;
          const priceNode =
            anchor.querySelector(".merPrice") ??
            anchor.querySelector('[class*="price"]') ??
            anchor;
          const titleNode =
            anchor.querySelector('[data-testid="thumbnail-item-name"]') ??
            anchor.querySelector('[class*="itemName"]');
          const imageNode = anchor.querySelector("img");
          const soldBadge =
            anchor.querySelector('[data-testid="thumbnail-sticker"]') ??
            anchor.querySelector('[aria-label="売り切れ"]');

          return {
            href: anchor.getAttribute("href") ?? undefined,
            titleText:
              titleNode?.textContent?.trim() ?? anchor.textContent?.trim() ?? undefined,
            priceText:
              priceNode?.textContent?.trim() ?? anchor.textContent?.trim() ?? undefined,
            imageUrl:
              imageNode?.getAttribute("src") ??
              imageNode?.getAttribute("data-src") ??
              imageNode?.getAttribute("srcset") ??
              undefined,
            soldBadgeText: soldBadge?.getAttribute("aria-label") ?? undefined,
            textContent: anchor.textContent?.trim() ?? undefined,
          };
        }),
      Math.max(options.limit * 2, 18),
    );
    const antiBotSignatures = detectAntiBotSignatures({
      html,
      bodyText,
      responseStatus: response?.status(),
      finalUrl,
    });

    if (antiBotSignatures.length > 0) {
      return {
        status: "blocked",
        items: [],
        warnings: [
          `Mercari browser fallback detected anti-bot page (${antiBotSignatures.join(", ")}).`,
        ],
        requestedUrls: [
          options.url,
          finalUrl,
          ...(searchApiResponse ? [searchApiResponse.url()] : []),
        ],
        retryCount: 0,
        usedFallback: true,
        renderer: "playwright",
        diagnostics: {
          responseStatus: searchApiResponse?.status() ?? response?.status(),
          finalUrl,
          antiBotSignatures,
          parserFailure: false,
        },
      };
    }

    const parsed = parseMercariDomCards(cards as MercariDomCardSnapshot[], {
      statusHint: options.statusHint,
      source: "playwright",
      foundItemGrid: cards.length > 0 || /thumbnail-link|\/item\//i.test(html),
      emptyResult: /出品された商品がありません/.test(bodyText),
    });
    const status: ProviderExecutionStatus =
      parsed.items.length > 0
        ? "success"
        : parsed.emptyResult
          ? "empty"
          : "parse_error";

    return {
      status,
      items: parsed.items,
      warnings: [
        ...(response && response.status() >= 400
          ? [`Mercari browser response returned ${response.status()}.`]
          : []),
        ...parsed.warnings,
      ],
      requestedUrls: [
        options.url,
        finalUrl,
        ...(searchApiResponse ? [searchApiResponse.url()] : []),
      ],
      retryCount: 0,
      usedFallback: true,
      renderer: "playwright",
      diagnostics: {
        responseStatus: searchApiResponse?.status() ?? response?.status(),
        finalUrl,
        antiBotSignatures: [],
        parserFailure: status === "parse_error",
      },
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function collectMercariVariant(options: {
  variant: SearchQueryVariant;
  limit: number;
  timeoutMs: number;
  seed: number;
}): Promise<MercariAttemptResult & { attemptDebug: ProviderQueryAttemptDebug; fingerprint: MercariRequestFingerprint }> {
  const startedAt = Date.now();
  const fingerprint = getFingerprint(options.seed);
  const selectedItems: MercariRawListing[] = [];
  const warnings: string[] = [];
  const requestedUrls: string[] = [];
  let retryCount = 0;
  let usedFallback = false;
  let renderer: MercariRenderer = "http";
  let lastDiagnostics: MercariAttemptDiagnostics = {
    antiBotSignatures: [],
    parserFailure: false,
  };
  let status: ProviderExecutionStatus = "empty";
  const deadline = Date.now() + options.timeoutMs;

  for (const statusHint of ["on_sale", "sold_out"] as MercariSearchStatus[]) {
    const remainingMs = deadline - Date.now();

    if (remainingMs < 4500) {
      warnings.push("Mercari variant collection stopped early because the remaining time budget was too low.");
      break;
    }

    if (
      statusHint === "sold_out" &&
      selectedItems.length >= Math.max(6, Math.floor(options.limit * 0.7))
    ) {
      break;
    }

    const url = resolveMercariSearchUrl(options.variant.query, statusHint);
    requestedUrls.push(url);
    const attemptTimeoutMs =
      statusHint === "on_sale"
        ? Math.max(5000, Math.min(remainingMs - 500, 9500))
        : Math.max(4500, Math.min(remainingMs - 500, 7000));

    const fetched = await retryTask(
      () =>
        runMercariFetchCollector({
          url,
          statusHint,
          timeoutMs: Math.min(attemptTimeoutMs, MERCARI_HTTP_TIMEOUT_MS),
          fingerprint,
        }),
      {
        retries: MERCARI_FETCH_RETRIES,
        delayMs: 600,
      },
    );
    retryCount += fetched.retryCount;
    let selected = fetched.value;

    if (
      selected.status === "blocked" ||
      selected.status === "parse_error" ||
      (selected.status === "empty" && selectedItems.length === 0)
    ) {
      const browserAttempt = await runMercariBrowserCollector({
        url,
        statusHint,
        timeoutMs: attemptTimeoutMs,
        fingerprint,
        limit: options.limit,
      });

      if (
        browserAttempt.items.length > 0 ||
        browserAttempt.status === "empty" ||
        browserAttempt.status === "success"
      ) {
        selected = browserAttempt;
      }
    }

    selected.items.forEach((item) => selectedItems.push(item));
    warnings.push(...selected.warnings);
    requestedUrls.push(...selected.requestedUrls);
    usedFallback = usedFallback || selected.usedFallback;
    renderer = selected.renderer;
    lastDiagnostics = selected.diagnostics;

    if (selected.items.length > 0) {
      status = status === "partial" ? "partial" : "success";
      if (selectedItems.length >= options.limit) {
        break;
      }
      continue;
    }

    if (selected.status === "blocked") {
      mercariCooldownUntil = Date.now() + MERCARI_SESSION_COOLDOWN_MS;
      status = selectedItems.length > 0 ? "partial" : "blocked";
      continue;
    }

    if (selected.status === "parse_error") {
      status = selectedItems.length > 0 ? "partial" : "parse_error";
      continue;
    }

    if (selected.status === "empty" && status === "empty") {
      status = "empty";
    }
  }

  const confidenceScore = computeConfidenceScore({
    itemCount: selectedItems.length,
    fallbackUsed: usedFallback,
    status,
    renderer,
  });
  const annotatedItems = annotateItems(
    dedupeByKey(selectedItems, (item) => item.itemId ?? item.itemUrl),
    options.variant,
    confidenceScore,
  ).slice(0, options.limit);

  const finalStatus: ProviderExecutionStatus =
    annotatedItems.length > 0
      ? status === "partial"
        ? "partial"
        : "success"
      : status;

  return {
    status: finalStatus,
    items: annotatedItems,
    warnings: compactWarnings(warnings),
    requestedUrls: [...new Set(requestedUrls)],
    retryCount,
    usedFallback,
    renderer,
    diagnostics: lastDiagnostics,
    fingerprint,
    attemptDebug: {
      variantKey: options.variant.key,
      variantLabel: options.variant.label,
      query: options.variant.query,
      status: finalStatus,
      rawResultCount: annotatedItems.length,
      durationMs: Date.now() - startedAt,
      requestedUrls: [...new Set(requestedUrls)],
      warnings: compactWarnings(warnings, 4),
      usedFallback,
      retryCount,
    },
  };
}

export async function runMercariSmokePreview(
  query: string,
  options: { limit?: number; timeoutMs?: number } = {},
): Promise<MercariSmokePreviewResult> {
  const queryPlan = preprocessSearchQuery(query);
  const variant =
    buildProviderQueryVariants(queryPlan, "mercari").find((entry) => entry.query.trim().length > 0) ?? {
      key: "mercari-original",
      label: "Original",
      strategy: "original",
      query,
      confidence: 1,
      tokens: queryPlan.tokens,
      providerTargets: ["mercari"],
    };
  const fingerprint = getFingerprint(0);
  const limit = options.limit ?? 6;
  const timeoutMs = options.timeoutMs ?? 18_000;
  const url = resolveMercariSearchUrl(variant.query, "on_sale");

  const fetched = await retryTask(
    () =>
      runMercariFetchCollector({
        url,
        statusHint: "on_sale",
        timeoutMs: Math.min(timeoutMs, MERCARI_HTTP_TIMEOUT_MS),
        fingerprint,
      }),
    {
      retries: 1,
      delayMs: 600,
    },
  );

  let selected = fetched.value;

  if (
    selected.status === "blocked" ||
    selected.status === "parse_error" ||
    selected.status === "empty"
  ) {
    const browserAttempt = await runMercariBrowserCollector({
      url,
      statusHint: "on_sale",
      timeoutMs,
      fingerprint,
      limit,
    });

    selected = browserAttempt;
  }

  return {
    query,
    variant,
    status: selected.status,
    renderer: selected.renderer,
    warnings: compactWarnings(selected.warnings),
    requestedUrls: [...new Set(selected.requestedUrls)],
    diagnostics: selected.diagnostics,
    items: annotateItems(selected.items, variant, selected.items.length > 0 ? 0.92 : 0).slice(
      0,
      limit,
    ),
  };
}

export const mercariRealCollector: RawMarketCollector<
  MercariRawListing,
  MercariCollectorMeta
> = {
  id: "mercari",
  label: "Mercari",
  mode: "real",
  defaultTimeoutMs: 36_000,
  async collect(context) {
    const startedAt = Date.now();
    const sessionId = `mercari-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cacheKey = JSON.stringify({
      query: context.queryPlan.compact || context.query,
      limit: context.limit,
      mode: context.mode,
    });
    const cached = getCachedEnvelope(cacheKey);

    if (cached) {
      return {
        ...cached,
        fetchedAt: new Date().toISOString(),
        debug: cached.debug
          ? {
              ...cached.debug,
              cacheHit: true,
            }
          : cached.debug,
      };
    }

    const variants = buildProviderQueryVariants(context.queryPlan, "mercari")
      .filter((variant) => variant.query.trim().length > 0)
      .slice(0, MERCARI_MAX_VARIANTS);

    const fallbackVariant: SearchQueryVariant = {
      key: "mercari-original",
      label: "Original",
      strategy: "original",
      query: context.query,
      confidence: 1,
      tokens: context.queryPlan.tokens,
      providerTargets: ["mercari"],
    };

    const selectedVariants = variants.length > 0 ? variants : [fallbackVariant];
    const attemptResults: Array<
      Awaited<ReturnType<typeof collectMercariVariant>>
    > = [];
    const deadline = Date.now() + context.timeoutMs;

    for (const [index, variant] of selectedVariants.entries()) {
      const remainingMs = deadline - Date.now();

      if (remainingMs < 6000) {
        break;
      }

      const attempt = await collectMercariVariant({
        variant,
        limit: context.limit,
        timeoutMs: remainingMs,
        seed: index,
      });
      attemptResults.push(attempt);

      if (attempt.items.length >= Math.max(6, Math.floor(context.limit * 0.75))) {
        break;
      }
    }

    const rawItems = dedupeByKey(
      attemptResults.flatMap((attempt) => attempt.items),
      (item) => item.itemId ?? item.itemUrl,
    ).slice(0, context.limit);
    const warnings = compactWarnings(
      attemptResults.flatMap((attempt) => attempt.warnings),
    );
    const requestedUrls = [...new Set(attemptResults.flatMap((attempt) => attempt.requestedUrls))];
    const attemptStatuses = attemptResults.map((attempt) => attempt.status);
    const finalAttempt = attemptResults[attemptResults.length - 1];
    const blockedReasons = [
      ...new Set(
        attemptResults.flatMap((attempt) =>
          attempt.diagnostics.antiBotSignatures.length > 0
            ? [attempt.diagnostics.antiBotSignatures.join(", ")]
            : [],
        ),
      ),
    ];

    const status: ProviderExecutionStatus =
      rawItems.length > 0
        ? attemptStatuses.some((value) => value === "partial" || value === "blocked" || value === "parse_error")
          ? "partial"
          : "success"
        : attemptStatuses.some((value) => value === "blocked")
          ? "blocked"
          : attemptStatuses.some((value) => value === "parse_error")
            ? "parse_error"
            : "empty";
    const renderer = finalAttempt?.renderer ?? "http";
    const fallbackUsed = attemptResults.some((attempt) => attempt.usedFallback);
    const retryCount = attemptResults.reduce((sum, attempt) => sum + attempt.retryCount, 0);
    const confidenceScore = computeConfidenceScore({
      itemCount: rawItems.length,
      fallbackUsed,
      status,
      renderer,
    });

    const envelope = buildCollectorEnvelope<MercariRawListing, MercariCollectorMeta>({
      market: "mercari",
      label: "Mercari",
      mode: context.mode,
      query: context.query,
      status,
      rawItems,
      meta: {
        strategy: "fetch_then_browser_fallback",
        requestCount: requestedUrls.length,
        attemptedQueries: attemptResults.map((attempt) => attempt.attemptDebug),
        requestedUrls,
        fallbackUsed,
        renderer,
        sessionId,
        fingerprintId: finalAttempt?.fingerprint.id,
        fingerprintLabel: finalAttempt?.fingerprint.label,
      },
      warnings,
      confidenceScore,
      error: buildErrorInfo(status, warnings),
      durationMs: Date.now() - startedAt,
      debug: {
        market: "mercari",
        attemptedQueries: attemptResults.map((attempt) => attempt.attemptDebug),
        fallbackUsed,
        cacheHit: false,
        retryCount,
        blocked: status === "blocked",
        queryVariantCount: selectedVariants.length,
        summary: {
          rawCount: rawItems.length,
          requestedUrls,
          blockedReasons,
          responseStatus: finalAttempt?.diagnostics.responseStatus,
          finalUrl: finalAttempt?.diagnostics.finalUrl,
          antiBotSignatures: finalAttempt?.diagnostics.antiBotSignatures,
          parserFailure: finalAttempt?.diagnostics.parserFailure,
          sessionId,
          fingerprintId: finalAttempt?.fingerprint.id,
          fingerprintLabel: finalAttempt?.fingerprint.label,
          cooldownUntil:
            mercariCooldownUntil > Date.now()
              ? new Date(mercariCooldownUntil).toISOString()
              : undefined,
          browserFallbackUsed: fallbackUsed,
        },
      },
    });

    setCachedEnvelope(cacheKey, envelope);
    return envelope;
  },
};

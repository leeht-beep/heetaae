import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MercariRawListing } from "@/lib/fixtures/types";
import {
  buildCollectorEnvelope,
  createProviderError,
  RawMarketCollector,
} from "@/lib/providers/base";
import {
  dedupeByKey,
  retryTask,
  withMemoryCache,
} from "@/lib/providers/shared/runtime";
import {
  MERCARI_BASE_URL,
  MERCARI_BROWSER_TIMEOUT_MS,
  MERCARI_BROWSER_VIRTUAL_TIME_BUDGET_MS,
  MERCARI_CHROME_CANDIDATES,
  MERCARI_DEFAULT_ACCEPT_LANGUAGE,
  MERCARI_DEFAULT_USER_AGENT,
  MERCARI_HTTP_TIMEOUT_MS,
  MERCARI_REQUEST_INTERVAL_MS,
  MERCARI_SEARCH_PATH,
  MERCARI_WINDOW_SIZE,
} from "@/lib/providers/mercari/config";
import {
  MercariParseResult,
  MercariSearchStatus,
  parseMercariSearchHtml,
} from "@/lib/providers/mercari/parser";
import { buildProviderQueryVariants } from "@/lib/utils/query";
import {
  ProviderExecutionStatus,
  ProviderQueryAttemptDebug,
} from "@/lib/types/market";

const execFileAsync = promisify(execFile);
const MERCARI_CACHE_TTL_MS = 45_000;

interface MercariCollectorMeta extends Record<string, unknown> {
  strategy: "multi_variant_rendered_dom_http";
  perStatusLimit: number;
  requestCount: number;
  chromeExecutablePath?: string;
  fallbackUsed: boolean;
  attemptedQueries: ProviderQueryAttemptDebug[];
  statusResults: Array<{
    variantKey: string;
    variantLabel: string;
    query: string;
    status: MercariSearchStatus;
    source: "rendered_dom" | "http" | "empty" | "failed";
    requestedUrl: string;
    totalCells: number;
    parsedCount: number;
    ignoredCells: number;
  }>;
}

interface MercariStatusCollectionResult {
  items: MercariRawListing[];
  warnings: string[];
  source: "rendered_dom" | "http" | "empty" | "failed";
  totalCells: number;
  ignoredCells: number;
  blocked: boolean;
  chromeExecutablePath?: string;
  requestedUrl: string;
}

let lastMercariRequestAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMercariRateLimit(intervalMs = MERCARI_REQUEST_INTERVAL_MS) {
  const now = Date.now();
  const waitMs = Math.max(0, lastMercariRequestAt + intervalMs - now);

  if (waitMs > 0) {
    await delay(waitMs);
  }

  lastMercariRequestAt = Date.now();
}

function resolveChromeExecutablePath(): string | null {
  return MERCARI_CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

function buildMercariSearchUrl(query: string, status: MercariSearchStatus): string {
  const url = new URL(MERCARI_SEARCH_PATH, MERCARI_BASE_URL);
  url.searchParams.set("keyword", query);
  url.searchParams.set("status", status);
  url.searchParams.set("sort", "created_time");
  url.searchParams.set("order", "desc");

  return url.toString();
}

function isBlockedHtml(html: string): boolean {
  return /captcha|access denied|forbidden|service unavailable|robot/i.test(html);
}

async function fetchMercariSearchHtml(url: string, timeoutMs: number): Promise<string> {
  await waitForMercariRateLimit();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    Math.min(timeoutMs, MERCARI_HTTP_TIMEOUT_MS),
  );

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": MERCARI_DEFAULT_USER_AGENT,
        "Accept-Language": MERCARI_DEFAULT_ACCEPT_LANGUAGE,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Mercari responded with ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function renderMercariSearchHtml(url: string, timeoutMs: number) {
  const chromeExecutablePath = resolveChromeExecutablePath();

  if (!chromeExecutablePath) {
    throw createProviderError({
      type: "not_configured",
      message: "Mercari browser renderer requires Chrome or Edge.",
      retryable: false,
    });
  }

  await waitForMercariRateLimit();

  const profileDir = await mkdtemp(path.join(os.tmpdir(), "mercari-render-"));

  try {
    const { stdout } = await execFileAsync(
      chromeExecutablePath,
      [
        "--headless=new",
        "--disable-gpu",
        `--window-size=${MERCARI_WINDOW_SIZE}`,
        `--virtual-time-budget=${MERCARI_BROWSER_VIRTUAL_TIME_BUDGET_MS}`,
        `--user-agent=${MERCARI_DEFAULT_USER_AGENT}`,
        "--lang=ja-JP",
        `--user-data-dir=${profileDir}`,
        "--dump-dom",
        url,
      ],
      {
        timeout: Math.min(timeoutMs, MERCARI_BROWSER_TIMEOUT_MS),
        maxBuffer: 12 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
    );

    return {
      html: stdout,
      chromeExecutablePath,
    };
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function annotateItems(
  items: MercariRawListing[],
  query: string,
  variantKey: string,
  variantLabel: string,
  rawConfidence: number,
): MercariRawListing[] {
  return items.map((item) => ({
    ...item,
    matchedQuery: query,
    queryVariantKey: variantKey,
    queryVariantLabel: variantLabel,
    rawConfidence,
  }));
}

function buildStatusWarnings(
  status: MercariSearchStatus,
  sourceLabel: string,
  parseResult: MercariParseResult,
): string[] {
  return parseResult.warnings.map((warning) => `[mercari:${status}:${sourceLabel}] ${warning}`);
}

function compactWarnings(warnings: string[], limit = 10): string[] {
  const uniqueWarnings = [...new Set(warnings)];

  if (uniqueWarnings.length <= limit) {
    return uniqueWarnings;
  }

  return [
    ...uniqueWarnings.slice(0, limit),
    `[mercari] ${uniqueWarnings.length - limit} additional warnings omitted.`,
  ];
}

async function collectMercariStatus(
  query: string,
  status: MercariSearchStatus,
  limit: number,
  timeoutMs: number,
  variantKey: string,
  variantLabel: string,
): Promise<MercariStatusCollectionResult> {
  const requestedUrl = buildMercariSearchUrl(query, status);
  const warnings: string[] = [];

  try {
    const rendered = await renderMercariSearchHtml(requestedUrl, timeoutMs);

    if (isBlockedHtml(rendered.html)) {
      return {
        items: [],
        warnings: [`[mercari:${status}:rendered_dom] blocked page detected.`],
        source: "failed",
        totalCells: 0,
        ignoredCells: 0,
        blocked: true,
        chromeExecutablePath: rendered.chromeExecutablePath,
        requestedUrl,
      };
    }

    const parsedFromDom = parseMercariSearchHtml(rendered.html, {
      statusHint: status,
      source: "rendered_dom",
    });

    warnings.push(...buildStatusWarnings(status, "rendered_dom", parsedFromDom));

    if (parsedFromDom.items.length > 0 || parsedFromDom.emptyResult || parsedFromDom.foundItemGrid) {
      return {
        items: annotateItems(
          dedupeByKey(parsedFromDom.items, (item) => item.itemId).slice(0, limit),
          query,
          variantKey,
          variantLabel,
          0.92,
        ),
        warnings,
        source: parsedFromDom.emptyResult ? "empty" : "rendered_dom",
        totalCells: parsedFromDom.totalCells,
        ignoredCells: parsedFromDom.ignoredCells,
        blocked: false,
        chromeExecutablePath: rendered.chromeExecutablePath,
        requestedUrl,
      };
    }

    warnings.push(
      `[mercari:${status}:rendered_dom] rendered DOM did not expose parseable item cells, falling back to HTTP HTML.`,
    );
  } catch (error) {
    warnings.push(
      `[mercari:${status}:rendered_dom] ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const rawHtmlResult = await retryTask(
      () => fetchMercariSearchHtml(requestedUrl, timeoutMs),
      {
        retries: 1,
        delayMs: 250,
        shouldRetry: () => true,
      },
    );
    const rawHtml = rawHtmlResult.value;

    if (isBlockedHtml(rawHtml)) {
      return {
        items: [],
        warnings: [...warnings, `[mercari:${status}:http] blocked page detected.`],
        source: "failed",
        totalCells: 0,
        ignoredCells: 0,
        blocked: true,
        requestedUrl,
      };
    }

    const parsedFromHttp = parseMercariSearchHtml(rawHtml, {
      statusHint: status,
      source: "http",
    });

    return {
      items: annotateItems(
        dedupeByKey(parsedFromHttp.items, (item) => item.itemId).slice(0, limit),
        query,
        variantKey,
        variantLabel,
        0.82,
      ),
      warnings: [...warnings, ...buildStatusWarnings(status, "http", parsedFromHttp)],
      source:
        parsedFromHttp.emptyResult
          ? "empty"
          : parsedFromHttp.items.length > 0
            ? "http"
            : "empty",
      totalCells: parsedFromHttp.totalCells,
      ignoredCells: parsedFromHttp.ignoredCells,
      blocked: false,
      requestedUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      items: [],
      warnings: [...warnings, `[mercari:${status}:http] ${message}`],
      source: "failed",
      totalCells: 0,
      ignoredCells: 0,
      blocked: false,
      requestedUrl,
    };
  }
}

export const mercariRealCollector: RawMarketCollector<MercariRawListing, MercariCollectorMeta> = {
  id: "mercari",
  label: "메루카리",
  mode: "real",
  defaultTimeoutMs: 22000,
  async collect(context) {
    const cacheKey = [
      "mercari",
      context.mode,
      context.queryPlan.compact,
      context.limit,
    ].join(":");

    const cached = await withMemoryCache(cacheKey, MERCARI_CACHE_TTL_MS, async () => {
      const startedAt = Date.now();
      const perStatusLimit = Math.max(Math.ceil(context.limit / 2), 10);
      const variants = buildProviderQueryVariants(context.queryPlan, "mercari").slice(0, 4);
      const attempts: ProviderQueryAttemptDebug[] = [];
      const statusResults: MercariCollectorMeta["statusResults"] = [];
      const allWarnings: string[] = [];
      const collectedItems: MercariRawListing[] = [];
      let totalRetryCount = 0;
      let requestCount = 0;
      let fallbackUsed = false;
      let blocked = false;
      let chromeExecutablePath: string | undefined;

      for (const variant of variants) {
        const attemptStartedAt = Date.now();
        const [activeResult, soldResult] = await Promise.all([
          collectMercariStatus(
            variant.query,
            "on_sale",
            perStatusLimit,
            context.timeoutMs,
            variant.key,
            variant.label,
          ),
          collectMercariStatus(
            variant.query,
            "sold_out",
            perStatusLimit,
            context.timeoutMs,
            variant.key,
            variant.label,
          ),
        ]);

        requestCount += 2;
        blocked = blocked || activeResult.blocked || soldResult.blocked;
        chromeExecutablePath =
          chromeExecutablePath ??
          activeResult.chromeExecutablePath ??
          soldResult.chromeExecutablePath;

        statusResults.push(
          {
            variantKey: variant.key,
            variantLabel: variant.label,
            query: variant.query,
            status: "on_sale",
            source: activeResult.source,
            requestedUrl: activeResult.requestedUrl,
            totalCells: activeResult.totalCells,
            parsedCount: activeResult.items.length,
            ignoredCells: activeResult.ignoredCells,
          },
          {
            variantKey: variant.key,
            variantLabel: variant.label,
            query: variant.query,
            status: "sold_out",
            source: soldResult.source,
            requestedUrl: soldResult.requestedUrl,
            totalCells: soldResult.totalCells,
            parsedCount: soldResult.items.length,
            ignoredCells: soldResult.ignoredCells,
          },
        );

        const mergedItems = dedupeByKey(
          [...activeResult.items, ...soldResult.items],
          (item) => item.itemId,
        );
        const attemptWarnings = [...activeResult.warnings, ...soldResult.warnings];
        allWarnings.push(...attemptWarnings);

        const attemptStatus: ProviderExecutionStatus =
          mergedItems.length > 0
            ? activeResult.source === "failed" || soldResult.source === "failed"
              ? "partial"
              : "success"
            : activeResult.blocked || soldResult.blocked
              ? "blocked"
              : activeResult.source === "empty" && soldResult.source === "empty"
                ? "empty"
                : "parse_error";

        attempts.push({
          variantKey: variant.key,
          variantLabel: variant.label,
          query: variant.query,
          status: attemptStatus,
          rawResultCount: mergedItems.length,
          durationMs: Date.now() - attemptStartedAt,
          requestedUrls: [activeResult.requestedUrl, soldResult.requestedUrl],
          warnings: compactWarnings(attemptWarnings, 4),
          usedFallback: attempts.length > 0,
          retryCount: 0,
          confidenceScore: Number(
            Math.max(0, Math.min(1, variant.confidence - (attempts.length > 0 ? 0.06 : 0)))
              .toFixed(3),
          ),
        });

        totalRetryCount += 0;

        if (attempts.length > 1) {
          fallbackUsed = true;
        }

        collectedItems.push(...mergedItems);
        const dedupedCollected = dedupeByKey(collectedItems, (item) => item.itemId);

        if (
          dedupedCollected.length >= context.limit ||
          (attempts.length === 1 && dedupedCollected.length >= Math.max(10, Math.ceil(context.limit * 0.7)))
        ) {
          break;
        }
      }

      const rawItems = dedupeByKey(collectedItems, (item) => item.itemId).slice(0, context.limit);
      const failedAttempts = attempts.filter((attempt) =>
        ["timeout", "parse_error", "blocked", "error"].includes(attempt.status),
      ).length;
      const status: ProviderExecutionStatus =
        rawItems.length > 0
          ? failedAttempts > 0
            ? "partial"
            : "success"
          : blocked
            ? "blocked"
            : attempts.some((attempt) => attempt.status === "parse_error")
              ? "parse_error"
              : "empty";
      const confidenceScore =
        rawItems.length > 0
          ? Number(
              Math.max(
                0,
                Math.min(
                  1,
                  attempts.reduce((sum, attempt) => sum + (attempt.confidenceScore ?? 0), 0) /
                    Math.max(attempts.length, 1) -
                    (fallbackUsed ? 0.05 : 0),
                ),
              ).toFixed(3),
            )
          : 0;

      const error =
        status === "blocked"
          ? createProviderError({
              type: "blocked",
              message: "Mercari blocked the search request or returned an anti-bot page.",
              retryable: true,
            })
          : status === "parse_error"
            ? createProviderError({
                type: "parse_error",
                message: "Mercari HTML changed and search results could not be parsed.",
                retryable: true,
                details: compactWarnings(allWarnings, 1)[0],
              })
            : status === "partial"
              ? createProviderError({
                  type: "partial_result",
                  message: "Mercari returned only a subset of expected search results.",
                  retryable: true,
                  details: compactWarnings(allWarnings, 1)[0],
                })
              : undefined;

      return buildCollectorEnvelope<MercariRawListing, MercariCollectorMeta>({
        market: "mercari",
        label: "메루카리",
        mode: "real",
        query: context.queryPlan.normalized || context.query,
        status,
        rawItems,
        meta: {
          strategy: "multi_variant_rendered_dom_http",
          perStatusLimit,
          requestCount,
          chromeExecutablePath,
          fallbackUsed,
          attemptedQueries: attempts,
          statusResults,
        },
        warnings: compactWarnings(allWarnings),
        confidenceScore,
        debug: {
          market: "mercari",
          attemptedQueries: attempts,
          fallbackUsed,
          cacheHit: false,
          retryCount: totalRetryCount,
          blocked,
          queryVariantCount: variants.length,
        },
        error,
        durationMs: Date.now() - startedAt,
      });
    });

    return {
      ...cached.value,
      debug: cached.value.debug
        ? {
            ...cached.value.debug,
            cacheHit: cached.cacheHit,
            attemptedQueries: cached.value.debug.attemptedQueries.map((attempt) => ({
              ...attempt,
              cacheHit: cached.cacheHit,
            })),
          }
        : undefined,
    };
  },
};

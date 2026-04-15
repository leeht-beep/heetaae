import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
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
  MERCARI_BROWSER_RENDERER,
  MERCARI_BROWSER_TIMEOUT_MS,
  MERCARI_BROWSER_VIRTUAL_TIME_BUDGET_MS,
  MERCARI_CHROME_CANDIDATES,
  MERCARI_DEFAULT_ACCEPT_LANGUAGE,
  MERCARI_DEFAULT_USER_AGENT,
  MERCARI_HTTP_TIMEOUT_MS,
  MERCARI_MAX_SESSION_RETRIES,
  MERCARI_REQUEST_FINGERPRINTS,
  MERCARI_REQUEST_INTERVAL_MS,
  MERCARI_SEARCH_PATH,
  MERCARI_SESSION_COOLDOWN_MS,
  MERCARI_SESSION_ROOT_DIR,
  MERCARI_SESSION_WARMUP_TTL_MS,
  MERCARI_WINDOW_SIZE,
  MercariRequestFingerprint,
} from "@/lib/providers/mercari/config";
import {
  MercariDomCardSnapshot,
  MercariParseResult,
  MercariSearchStatus,
  parseMercariDomCards,
  parseMercariSearchHtml,
} from "@/lib/providers/mercari/parser";
import { buildProviderQueryVariants } from "@/lib/utils/query";
import {
  ProviderExecutionStatus,
  ProviderQueryAttemptDebug,
} from "@/lib/types/market";

const execFileAsync = promisify(execFile);
const MERCARI_CACHE_TTL_MS = 45_000;
const MERCARI_WARMUP_URL = new URL(MERCARI_SEARCH_PATH, MERCARI_BASE_URL).toString();
const MERCARI_MAX_QUERY_VARIANTS = 2;
const MERCARI_MIN_STABLE_RESULT_COUNT = 6;
const MERCARI_MIN_FALLBACK_RESULT_COUNT = 4;
const MERCARI_MIN_NEXT_VARIANT_BUDGET_MS = 14_000;

interface MercariCollectorMeta extends Record<string, unknown> {
  strategy: "multi_variant_session_aware";
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
    source: "rendered_dom" | "playwright" | "http" | "empty" | "failed";
    renderer: "chrome_dump_dom" | "playwright" | "http";
    requestedUrl: string;
    totalCells: number;
    parsedCount: number;
    ignoredCells: number;
    blocked: boolean;
    blockedReasons: string[];
    sessionId?: string;
    fingerprintId?: string;
  }>;
}

interface MercariSessionState {
  sessionId: string;
  fingerprint: MercariRequestFingerprint;
  profileDir: string;
  lastUsedAt: number;
  lastWarmupAt?: number;
  cooldownUntil?: number;
  blockedCount: number;
  lastBlockedReasons: string[];
}

interface MercariBlockedAnalysis {
  blocked: boolean;
  reasons: string[];
  hasSearchSignals: boolean;
  hasItemSignals: boolean;
}

interface MercariBrowserRenderResult {
  html: string;
  renderer: "chrome_dump_dom" | "playwright";
  chromeExecutablePath?: string;
  domCards?: MercariDomCardSnapshot[];
  foundItemGrid?: boolean;
  emptyResult?: boolean;
  extractionWarnings?: string[];
}

interface MercariStatusCollectionResult {
  items: MercariRawListing[];
  warnings: string[];
  source: "rendered_dom" | "playwright" | "http" | "empty" | "failed";
  renderer: "chrome_dump_dom" | "playwright" | "http";
  totalCells: number;
  ignoredCells: number;
  blocked: boolean;
  blockedReasons: string[];
  chromeExecutablePath?: string;
  requestedUrl: string;
  requestCount: number;
  sessionId?: string;
  fingerprintId?: string;
}

interface MercariVariantCollectionResult {
  items: MercariRawListing[];
  warnings: string[];
  requestedUrls: string[];
  activeResult: MercariStatusCollectionResult;
  soldResult: MercariStatusCollectionResult;
  status: ProviderExecutionStatus;
  blockedReasons: string[];
  requestCount: number;
  retryCount: number;
  browserFallbackUsed: boolean;
  warmupUsed: boolean;
  chromeExecutablePath?: string;
  session?: MercariSessionState;
}

interface WarmupResult {
  used: boolean;
  warnings: string[];
  requestCount: number;
  browserFallbackUsed: boolean;
  chromeExecutablePath?: string;
}

const MERCARI_VARIANT_TIMEOUT_MS = 18_000;

let lastMercariRequestAt = 0;
let chromeExecutablePathCache: string | null | undefined;
let mercariFingerprintCursor = 0;
let playwrightLoadAttempted = false;
let playwrightModuleCache: unknown | null = null;
const mercariSessions = new Map<string, MercariSessionState>();

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

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function compactWarnings(warnings: string[], limit = 10): string[] {
  const uniqueWarnings = dedupeStrings(warnings);

  if (uniqueWarnings.length <= limit) {
    return uniqueWarnings;
  }

  return [
    ...uniqueWarnings.slice(0, limit),
    `[mercari] ${uniqueWarnings.length - limit} additional warnings omitted.`,
  ];
}

function hashString(value: string): number {
  return [...value].reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) >>> 0;
  }, 0);
}

function resolveChromeExecutablePath(): string | null {
  if (chromeExecutablePathCache !== undefined) {
    return chromeExecutablePathCache;
  }

  chromeExecutablePathCache =
    MERCARI_CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
  return chromeExecutablePathCache;
}

function buildMercariSearchUrl(query: string, status: MercariSearchStatus): string {
  const url = new URL(MERCARI_SEARCH_PATH, MERCARI_BASE_URL);
  url.searchParams.set("keyword", query);
  url.searchParams.set("status", status);
  url.searchParams.set("sort", "created_time");
  url.searchParams.set("order", "desc");
  return url.toString();
}

function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function analyzeMercariBlockedHtml(html: string): MercariBlockedAnalysis {
  const normalizedHtml = html.toLowerCase();
  const visibleText = extractVisibleText(html).toLowerCase();
  const hasItemGrid = /id="item-grid"/i.test(html);
  const itemCellCount = (html.match(/data-testid="item-cell"/gi) ?? []).length;
  const itemLinkCount = (html.match(/\/item\/[a-z0-9]+/gi) ?? []).length;
  const hasItemSignals = hasItemGrid || itemCellCount > 0 || itemLinkCount > 0;
  const hasSearchSignals =
    hasItemSignals ||
    /searchresult|検索結果|絞り込み|販売中|売り切れ|mercari/i.test(visibleText);
  const reasons: string[] = [];

  if (!hasItemSignals) {
    if (
      /challenge-platform|challenge-form|cf-chl|hcaptcha|g-recaptcha|turnstile|arkoselabs|captcha-delivery/i.test(
        normalizedHtml,
      )
    ) {
      reasons.push("challenge_script");
    }

    if (
      /(verify you are human|human verification|security check|access denied|attention required|just a moment|unusual traffic)/i.test(
        visibleText,
      )
    ) {
      reasons.push("verification_copy");
    }

    if (
      /(ロボットではありません|人間であること|セキュリティチェック|本人確認|アクセスを続行するには|しばらくしてからもう一度)/i.test(
        visibleText,
      )
    ) {
      reasons.push("verification_copy_ja");
    }

    if (
      /name="(?:cf-turnstile-response|g-recaptcha-response)"/i.test(html) ||
      /<form[^>]+(?:captcha|challenge|verify)/i.test(html)
    ) {
      reasons.push("challenge_form");
    }

    if (
      /<title>\s*(?:just a moment|access denied|attention required|security check)\s*<\/title>/i.test(
        html,
      )
    ) {
      reasons.push("challenge_title");
    }
  }

  return {
    blocked: !hasItemSignals && reasons.length > 0,
    reasons: dedupeStrings(reasons),
    hasSearchSignals,
    hasItemSignals,
  };
}

function annotateItems(
  items: MercariRawListing[],
  query: string,
  variantKey: string,
  variantLabel: string,
  rawConfidence: number,
  parserSource: MercariRawListing["parserSource"],
): MercariRawListing[] {
  return items.map((item) => ({
    ...item,
    parserSource,
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

function buildMercariRequestHeaders(
  fingerprint: MercariRequestFingerprint,
  referer?: string,
): HeadersInit {
  return {
    "User-Agent": fingerprint.userAgent || MERCARI_DEFAULT_USER_AGENT,
    "Accept-Language": fingerprint.acceptLanguage || MERCARI_DEFAULT_ACCEPT_LANGUAGE,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Cache-Control": "no-cache",
    Referer: referer ?? MERCARI_WARMUP_URL,
    ...(fingerprint.headers ?? {}),
  };
}

async function fetchMercariSearchHtml(
  url: string,
  timeoutMs: number,
  fingerprint: MercariRequestFingerprint,
): Promise<string> {
  await waitForMercariRateLimit();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    Math.min(timeoutMs, MERCARI_HTTP_TIMEOUT_MS),
  );

  try {
    const response = await fetch(url, {
      headers: buildMercariRequestHeaders(fingerprint, MERCARI_WARMUP_URL),
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

function sanitizeProfileDirectoryName(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").toLowerCase();
}

async function ensureMercariSession(
  fingerprint: MercariRequestFingerprint,
): Promise<MercariSessionState> {
  const sessionId = `mercari-${fingerprint.id}`;
  const existing = mercariSessions.get(sessionId);

  if (existing) {
    return existing;
  }

  const profileDir = path.join(
    MERCARI_SESSION_ROOT_DIR,
    sanitizeProfileDirectoryName(fingerprint.id),
  );
  await mkdir(profileDir, { recursive: true });

  const session: MercariSessionState = {
    sessionId,
    fingerprint,
    profileDir,
    lastUsedAt: 0,
    blockedCount: 0,
    lastBlockedReasons: [],
  };

  mercariSessions.set(sessionId, session);
  return session;
}

async function createMercariAttemptSession(
  session: MercariSessionState,
): Promise<MercariSessionState> {
  await mkdir(session.profileDir, { recursive: true });
  const attemptProfileDir = await mkdtemp(path.join(session.profileDir, "attempt-"));

  return {
    ...session,
    profileDir: attemptProfileDir,
  };
}

async function clearMercariProfileLocks(profileDir: string) {
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];

  await Promise.all(
    lockFiles.map((lockFile) =>
      rm(path.join(profileDir, lockFile), { force: true }).catch(() => undefined),
    ),
  );
}

function parseWindowSize(windowSize: string): { width: number; height: number } {
  const [width, height] = windowSize.split(",").map((value) => Number(value.trim()));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1600,
    height: Number.isFinite(height) && height > 0 ? height : 5000,
  };
}

async function renderMercariSearchHtmlWithChrome(
  url: string,
  timeoutMs: number,
  session: MercariSessionState,
): Promise<MercariBrowserRenderResult> {
  const chromeExecutablePath = resolveChromeExecutablePath();

  if (!chromeExecutablePath) {
    throw createProviderError({
      type: "not_configured",
      message: "Mercari browser renderer requires Chrome or Edge.",
      retryable: false,
    });
  }

  await mkdir(session.profileDir, { recursive: true });
  await clearMercariProfileLocks(session.profileDir);
  await waitForMercariRateLimit();

  const rendererScriptPath = path.join(
    process.cwd(),
    "scripts",
    "mercari-dump-dom.mjs",
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    [rendererScriptPath],
    {
      env: {
        ...process.env,
        MERCARI_RENDER_CHROME_PATH: chromeExecutablePath,
        MERCARI_RENDER_URL: url,
        MERCARI_RENDER_WINDOW_SIZE:
          session.fingerprint.windowSize ?? MERCARI_WINDOW_SIZE,
        MERCARI_RENDER_VIRTUAL_TIME_BUDGET: String(
          MERCARI_BROWSER_VIRTUAL_TIME_BUDGET_MS,
        ),
        MERCARI_RENDER_USER_AGENT:
          session.fingerprint.userAgent || MERCARI_DEFAULT_USER_AGENT,
        MERCARI_RENDER_PROFILE_DIR: session.profileDir,
        MERCARI_RENDER_TIMEOUT_MS: String(
          Math.min(timeoutMs, MERCARI_BROWSER_TIMEOUT_MS),
        ),
      },
      timeout: Math.min(timeoutMs, MERCARI_BROWSER_TIMEOUT_MS) + 2000,
      maxBuffer: 14 * 1024 * 1024,
      windowsHide: true,
      encoding: "utf8",
    },
  );

  return {
    html: stdout,
    renderer: "chrome_dump_dom",
    chromeExecutablePath,
  };
}

async function loadPlaywrightModule(): Promise<unknown | null> {
  if (playwrightLoadAttempted) {
    return playwrightModuleCache;
  }

  playwrightLoadAttempted = true;

  for (const packageName of ["playwright-core", "playwright"]) {
    try {
      const dynamicImport = Function(
        `return import('${packageName}')`,
      ) as () => Promise<unknown>;
      playwrightModuleCache = await dynamicImport();
      return playwrightModuleCache;
    } catch {
      continue;
    }
  }

  playwrightModuleCache = null;
  return null;
}

async function renderMercariSearchHtmlWithPlaywright(
  url: string,
  timeoutMs: number,
  session: MercariSessionState,
): Promise<MercariBrowserRenderResult | null> {
  const chromeExecutablePath = resolveChromeExecutablePath();
  const playwright = (await loadPlaywrightModule()) as {
    chromium?: {
      launch: (options: Record<string, unknown>) => Promise<{
        newContext: (options: Record<string, unknown>) => Promise<{
          newPage: () => Promise<{
            goto: (
              targetUrl: string,
              options: Record<string, unknown>,
            ) => Promise<unknown>;
            waitForLoadState: (
              state: string,
              options?: Record<string, unknown>,
            ) => Promise<unknown>;
            waitForFunction: (
              pageFunction: () => boolean,
              options?: Record<string, unknown>,
            ) => Promise<unknown>;
            evaluate: <T>(pageFunction: () => T) => Promise<T>;
            content: () => Promise<string>;
          }>;
          close: () => Promise<void>;
        }>;
        close: () => Promise<void>;
      }>;
    };
  } | null;

  if (!playwright?.chromium || !chromeExecutablePath) {
    return null;
  }

  await waitForMercariRateLimit();

  const viewport = parseWindowSize(session.fingerprint.windowSize ?? MERCARI_WINDOW_SIZE);
  const browser = await playwright.chromium.launch({
    executablePath: chromeExecutablePath,
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport,
      locale: "ja-JP",
      userAgent: session.fingerprint.userAgent || MERCARI_DEFAULT_USER_AGENT,
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(timeoutMs, MERCARI_BROWSER_TIMEOUT_MS),
    });
    await page
      .waitForLoadState("networkidle", {
        timeout: Math.min(5000, Math.max(timeoutMs - 1000, 1000)),
      })
      .catch(() => undefined);
    await page
      .waitForFunction(
        () => {
          const bodyText = document.body?.innerText ?? "";
          return Boolean(
            document.querySelector('[data-testid="item-cell"]') ||
              document.querySelector('a[href*="/item/"]') ||
              /検索結果はありません|該当する商品が見つかりませんでした|見つかりませんでした/.test(
                bodyText,
              ),
          );
        },
        {
          timeout: Math.min(12_000, Math.max(timeoutMs - 1000, 2_500)),
        },
      )
      .catch(() => undefined);

    const domSnapshot = await page.evaluate(() => {
      const textOf = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
      const cardElements = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="item-cell"]'),
      );
      const cards = cardElements.map((card) => {
        const anchor =
          card.querySelector<HTMLAnchorElement>('a[href*="/item/"]') ??
          card.closest<HTMLAnchorElement>('a[href*="/item/"]');
        const image =
          card.querySelector<HTMLImageElement>("img") ??
          anchor?.querySelector<HTMLImageElement>("img") ??
          null;
        const priceText =
          Array.from(card.querySelectorAll<HTMLElement>("span, div, p"))
            .map((element) => textOf(element.textContent))
            .find((text) => /(?:¥|￥)\s*[\d,]+/.test(text)) ?? textOf(card.textContent);
        const soldBadgeText = Array.from(card.querySelectorAll<HTMLElement>("span, div, p"))
          .map((element) => textOf(element.textContent))
          .find((text) => /sold|売り切れ/i.test(text));

        return {
          href: anchor?.getAttribute("href") ?? anchor?.href ?? undefined,
          titleText:
            image?.getAttribute("alt") ??
            anchor?.getAttribute("aria-label") ??
            textOf(anchor?.textContent) ??
            textOf(card.textContent),
          priceText,
          imageUrl:
            image?.getAttribute("src") ??
            image?.getAttribute("data-src") ??
            image?.getAttribute("srcset") ??
            undefined,
          soldBadgeText,
          textContent: textOf(card.textContent),
        };
      });
      const bodyText = textOf(document.body?.innerText);

      return {
        cards,
        foundItemGrid:
          Boolean(document.querySelector("#item-grid")) || cardElements.length > 0,
        emptyResult:
          cards.length === 0 &&
          /(no results|検索結果はありません|該当する商品が見つかりませんでした|見つかりませんでした)/i.test(
            bodyText,
          ),
      };
    });

    const html = await page.content();
    await context.close().catch(() => undefined);

    return {
      html,
      renderer: "playwright",
      chromeExecutablePath,
      domCards: domSnapshot.cards,
      foundItemGrid: domSnapshot.foundItemGrid,
      emptyResult: domSnapshot.emptyResult,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function maybeWarmMercariSession(
  session: MercariSessionState,
  timeoutMs: number,
): Promise<WarmupResult> {
  const now = Date.now();

  if (session.blockedCount === 0 && session.lastUsedAt === 0) {
    return {
      used: false,
      warnings: [],
      requestCount: 0,
      browserFallbackUsed: false,
    };
  }

  if (
    session.lastWarmupAt &&
    now - session.lastWarmupAt < MERCARI_SESSION_WARMUP_TTL_MS
  ) {
    return {
      used: false,
      warnings: [],
      requestCount: 0,
      browserFallbackUsed: false,
    };
  }

  const warnings: string[] = [];
  let requestCount = 0;
  let browserFallbackUsed = false;
  let chromeExecutablePath: string | undefined;

  try {
    const rendered = await renderMercariSearchHtmlWithChrome(
      MERCARI_WARMUP_URL,
      Math.min(timeoutMs, 10_000),
      session,
    );
    requestCount += 1;
    chromeExecutablePath = rendered.chromeExecutablePath;
    session.lastWarmupAt = Date.now();

    return {
      used: true,
      warnings,
      requestCount,
      browserFallbackUsed,
      chromeExecutablePath,
    };
  } catch (error) {
    warnings.push(
      `[mercari:warmup:chrome] ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (MERCARI_BROWSER_RENDERER === "chrome") {
    return {
      used: false,
      warnings,
      requestCount,
      browserFallbackUsed,
      chromeExecutablePath,
    };
  }

  const playwrightResult = await renderMercariSearchHtmlWithPlaywright(
    MERCARI_WARMUP_URL,
    Math.min(timeoutMs, 10_000),
    session,
  ).catch((error) => {
    warnings.push(
      `[mercari:warmup:playwright] ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });

  if (playwrightResult) {
    requestCount += 1;
    browserFallbackUsed = true;
    session.lastWarmupAt = Date.now();
  }

  return {
    used: Boolean(playwrightResult),
    warnings,
    requestCount,
    browserFallbackUsed,
    chromeExecutablePath,
  };
}

function markMercariSessionHealthy(session: MercariSessionState) {
  session.lastUsedAt = Date.now();
  session.cooldownUntil = undefined;
  session.blockedCount = 0;
  session.lastBlockedReasons = [];
}

function markMercariSessionBlocked(
  session: MercariSessionState,
  reasons: string[],
) {
  session.lastUsedAt = Date.now();
  session.blockedCount += 1;
  session.lastBlockedReasons = dedupeStrings(reasons);
  session.cooldownUntil =
    Date.now() +
    MERCARI_SESSION_COOLDOWN_MS * Math.min(3, Math.max(session.blockedCount, 1));
}

async function getMercariSessionCandidates(queryKey: string): Promise<MercariSessionState[]> {
  const rotationOffset =
    (hashString(queryKey) + mercariFingerprintCursor) %
    Math.max(MERCARI_REQUEST_FINGERPRINTS.length, 1);
  mercariFingerprintCursor =
    (mercariFingerprintCursor + 1) %
    Math.max(MERCARI_REQUEST_FINGERPRINTS.length, 1);

  const orderedFingerprints = [
    ...MERCARI_REQUEST_FINGERPRINTS.slice(rotationOffset),
    ...MERCARI_REQUEST_FINGERPRINTS.slice(0, rotationOffset),
  ];
  const sessions = await Promise.all(
    orderedFingerprints.map((fingerprint) => ensureMercariSession(fingerprint)),
  );
  const now = Date.now();
  const available = sessions.filter(
    (session) => !session.cooldownUntil || session.cooldownUntil <= now,
  );
  const orderedSessions =
    available.length > 0
      ? available
      : [...sessions].sort(
          (left, right) =>
            (left.cooldownUntil ?? Number.MAX_SAFE_INTEGER) -
            (right.cooldownUntil ?? Number.MAX_SAFE_INTEGER),
        );

  return orderedSessions.slice(0, MERCARI_MAX_SESSION_RETRIES);
}

function buildMercariStatusResult(
  requestedUrl: string,
  options: Partial<MercariStatusCollectionResult>,
): MercariStatusCollectionResult {
  return {
    items: [],
    warnings: [],
    source: "failed",
    renderer: "http",
    totalCells: 0,
    ignoredCells: 0,
    blocked: false,
    blockedReasons: [],
    requestedUrl,
    requestCount: 0,
    ...options,
  };
}

function shouldTryMercariFallbackVariant(options: {
  collectedCount: number;
  attemptCount: number;
  remainingBudgetMs: number;
  lastAttemptStatus: ProviderExecutionStatus;
  lastAttemptItemCount: number;
}) {
  if (options.remainingBudgetMs < MERCARI_MIN_NEXT_VARIANT_BUDGET_MS) {
    return false;
  }

  if (options.collectedCount === 0) {
    return true;
  }

  if (
    options.lastAttemptStatus === "blocked" ||
    options.lastAttemptStatus === "timeout" ||
    options.lastAttemptStatus === "parse_error"
  ) {
    return true;
  }

  if (options.attemptCount === 1) {
    return options.collectedCount < MERCARI_MIN_STABLE_RESULT_COUNT;
  }

  return options.lastAttemptItemCount < MERCARI_MIN_FALLBACK_RESULT_COUNT;
}

async function collectMercariStatus(
  query: string,
  status: MercariSearchStatus,
  limit: number,
  timeoutMs: number,
  variantKey: string,
  variantLabel: string,
  session: MercariSessionState,
): Promise<MercariStatusCollectionResult> {
  const requestedUrl = buildMercariSearchUrl(query, status);
  const warnings: string[] = [];
  let requestCount = 0;
  let chromeExecutablePath: string | undefined;

  const tryBrowserParse = (
    rendered: MercariBrowserRenderResult,
    parserSource: "rendered_dom" | "playwright",
  ): MercariStatusCollectionResult | null => {
    const blockedAnalysis = analyzeMercariBlockedHtml(rendered.html);
    const sourceLabel =
      rendered.renderer === "playwright" ? "playwright" : "rendered_dom";

    if (blockedAnalysis.blocked) {
      warnings.push(
        `[mercari:${status}:${sourceLabel}] blocked markers detected (${blockedAnalysis.reasons.join(", ")}).`,
      );

      return buildMercariStatusResult(requestedUrl, {
        warnings: compactWarnings(warnings),
        source: "failed",
        renderer: rendered.renderer,
        blocked: true,
        blockedReasons: blockedAnalysis.reasons,
        chromeExecutablePath: rendered.chromeExecutablePath,
        requestCount,
        sessionId: session.sessionId,
        fingerprintId: session.fingerprint.id,
      });
    }

    const parsedFromBrowser =
      rendered.renderer === "playwright" && rendered.domCards
        ? parseMercariDomCards(rendered.domCards, {
            statusHint: status,
            source: parserSource,
            foundItemGrid: rendered.foundItemGrid,
            emptyResult: rendered.emptyResult,
            warnings: rendered.extractionWarnings,
          })
        : parseMercariSearchHtml(rendered.html, {
            statusHint: status,
            source: parserSource,
          });

    warnings.push(...buildStatusWarnings(status, sourceLabel, parsedFromBrowser));

    if (
      parsedFromBrowser.items.length > 0 ||
      parsedFromBrowser.emptyResult ||
      parsedFromBrowser.foundItemGrid
    ) {
      const annotatedItems = annotateItems(
        dedupeByKey(parsedFromBrowser.items, (item) => item.itemId).slice(0, limit),
        query,
        variantKey,
        variantLabel,
        rendered.renderer === "playwright" ? 0.9 : 0.92,
        parserSource,
      );

      return buildMercariStatusResult(requestedUrl, {
        items: annotatedItems,
        warnings: compactWarnings(warnings),
        source: parsedFromBrowser.emptyResult ? "empty" : parserSource,
        renderer: rendered.renderer,
        totalCells: parsedFromBrowser.totalCells,
        ignoredCells: parsedFromBrowser.ignoredCells,
        blocked: false,
        blockedReasons: [],
        chromeExecutablePath: rendered.chromeExecutablePath,
        requestCount,
        sessionId: session.sessionId,
        fingerprintId: session.fingerprint.id,
      });
    }

    warnings.push(
      `[mercari:${status}:${sourceLabel}] browser render did not expose parseable item cells.`,
    );

    return null;
  };

  if (MERCARI_BROWSER_RENDERER !== "playwright") {
    try {
      const rendered = await renderMercariSearchHtmlWithChrome(
        requestedUrl,
        timeoutMs,
        session,
      );
      requestCount += 1;
      chromeExecutablePath = rendered.chromeExecutablePath;
      const parsed = tryBrowserParse(rendered, "rendered_dom");

      if (parsed) {
        return {
          ...parsed,
          requestCount,
        };
      }
    } catch (error) {
      warnings.push(
        `[mercari:${status}:rendered_dom] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (MERCARI_BROWSER_RENDERER !== "chrome") {
    try {
      const rendered = await renderMercariSearchHtmlWithPlaywright(
        requestedUrl,
        timeoutMs,
        session,
      );

      if (rendered) {
        requestCount += 1;
        const parsed = tryBrowserParse(rendered, "playwright");

        if (parsed) {
          return {
            ...parsed,
            requestCount,
          };
        }
      }
    } catch (error) {
      warnings.push(
        `[mercari:${status}:playwright] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    const rawHtmlResult = await retryTask(
      () => fetchMercariSearchHtml(requestedUrl, timeoutMs, session.fingerprint),
      {
        retries: 1,
        delayMs: 250,
        shouldRetry: () => true,
      },
    );
    const rawHtml = rawHtmlResult.value;
    requestCount += 1;
    const blockedAnalysis = analyzeMercariBlockedHtml(rawHtml);

    if (blockedAnalysis.blocked) {
      warnings.push(
        `[mercari:${status}:http] blocked markers detected (${blockedAnalysis.reasons.join(", ")}).`,
      );

      return buildMercariStatusResult(requestedUrl, {
        warnings: compactWarnings(warnings),
        source: "failed",
        renderer: "http",
        blocked: true,
        blockedReasons: blockedAnalysis.reasons,
        requestCount,
        sessionId: session.sessionId,
        fingerprintId: session.fingerprint.id,
      });
    }

    const parsedFromHttp = parseMercariSearchHtml(rawHtml, {
      statusHint: status,
      source: "http",
    });
    const source =
      parsedFromHttp.emptyResult
        ? "empty"
        : parsedFromHttp.items.length > 0
          ? "http"
          : "failed";

    return buildMercariStatusResult(requestedUrl, {
      items: annotateItems(
        dedupeByKey(parsedFromHttp.items, (item) => item.itemId).slice(0, limit),
        query,
        variantKey,
        variantLabel,
        0.8,
        "http",
      ),
      warnings: compactWarnings([
        ...warnings,
        ...buildStatusWarnings(status, "http", parsedFromHttp),
      ]),
      source,
      renderer: "http",
      totalCells: parsedFromHttp.totalCells,
      ignoredCells: parsedFromHttp.ignoredCells,
      blocked: false,
      blockedReasons: [],
      chromeExecutablePath,
      requestCount,
      sessionId: session.sessionId,
      fingerprintId: session.fingerprint.id,
    });
  } catch (error) {
    return buildMercariStatusResult(requestedUrl, {
      warnings: compactWarnings([
        ...warnings,
        `[mercari:${status}:http] ${error instanceof Error ? error.message : String(error)}`,
      ]),
      source: "failed",
      renderer: "http",
      requestCount,
      chromeExecutablePath,
      sessionId: session.sessionId,
      fingerprintId: session.fingerprint.id,
    });
  }
}

async function collectMercariVariant(
  query: string,
  variantKey: string,
  variantLabel: string,
  limit: number,
  timeoutMs: number,
): Promise<MercariVariantCollectionResult> {
  const candidateSessions = await getMercariSessionCandidates(`${variantKey}:${query}`);
  const deadlineAt = Date.now() + timeoutMs - 750;
  let requestCount = 0;
  let retryCount = 0;
  let browserFallbackUsed = false;
  let warmupUsed = false;
  let chromeExecutablePath: string | undefined;
  let lastResult: MercariVariantCollectionResult | undefined;

  for (let sessionIndex = 0; sessionIndex < candidateSessions.length; sessionIndex += 1) {
    const session = candidateSessions[sessionIndex];
    const attemptSession = await createMercariAttemptSession(session);
    const warnings: string[] = [];
    try {
      const warmup = await maybeWarmMercariSession(attemptSession, timeoutMs);
      requestCount += warmup.requestCount;
      browserFallbackUsed = browserFallbackUsed || warmup.browserFallbackUsed;
      warmupUsed = warmupUsed || warmup.used;
      chromeExecutablePath = chromeExecutablePath ?? warmup.chromeExecutablePath;
      warnings.push(...warmup.warnings);

      const activeTimeoutMs = Math.max(5_000, deadlineAt - Date.now());
      const activeResult = await collectMercariStatus(
        query,
        "on_sale",
        limit,
        activeTimeoutMs,
        variantKey,
        variantLabel,
        attemptSession,
      );
      const remainingAfterActive = deadlineAt - Date.now();
      const shouldCollectSold =
        remainingAfterActive >= 16_000 &&
        activeResult.items.length < Math.max(4, Math.ceil(limit * 0.35));
      const soldResult =
        shouldCollectSold
          ? await collectMercariStatus(
              query,
              "sold_out",
              limit,
              Math.min(remainingAfterActive, 12_000),
              variantKey,
              variantLabel,
              attemptSession,
            )
          : buildMercariStatusResult(buildMercariSearchUrl(query, "sold_out"), {
              source: "empty",
              renderer: "http",
              warnings: [
                "[mercari:sold_out] skipped sold-out collection to preserve active results within the provider timeout budget.",
              ],
              sessionId: session.sessionId,
              fingerprintId: session.fingerprint.id,
            });

      requestCount += activeResult.requestCount + soldResult.requestCount;
      chromeExecutablePath =
        chromeExecutablePath ??
        activeResult.chromeExecutablePath ??
        soldResult.chromeExecutablePath;
      browserFallbackUsed =
        browserFallbackUsed ||
        activeResult.renderer === "playwright" ||
        soldResult.renderer === "playwright";

      const mergedItems = dedupeByKey(
        [...activeResult.items, ...soldResult.items],
        (item) => item.itemId,
      );
      const blockedReasons = dedupeStrings([
        ...activeResult.blockedReasons,
        ...soldResult.blockedReasons,
      ]);
      const status: ProviderExecutionStatus =
        mergedItems.length > 0
          ? activeResult.source === "failed" || soldResult.source === "failed"
            ? "partial"
            : "success"
          : blockedReasons.length > 0
            ? "blocked"
            : activeResult.source === "empty" && soldResult.source === "empty"
              ? "empty"
              : "parse_error";

      warnings.push(...activeResult.warnings, ...soldResult.warnings);

      if (blockedReasons.length > 0) {
        markMercariSessionBlocked(session, blockedReasons);
      } else {
        markMercariSessionHealthy(session);
      }

      lastResult = {
        items: mergedItems,
        warnings: compactWarnings(warnings),
        requestedUrls: dedupeStrings([
          activeResult.requestedUrl,
          soldResult.requestedUrl,
        ]),
        activeResult,
        soldResult,
        status,
        blockedReasons,
        requestCount,
        retryCount,
        browserFallbackUsed,
        warmupUsed,
        chromeExecutablePath,
        session,
      };

      const shouldRetryWithAlternateSession =
        mergedItems.length === 0 &&
        sessionIndex < candidateSessions.length - 1 &&
        (status === "blocked" || status === "parse_error");

      if (shouldRetryWithAlternateSession) {
        retryCount += 1;
        continue;
      }

      return lastResult;
    } finally {
      void rm(attemptSession.profileDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  return (
    lastResult ?? {
      items: [],
      warnings: ["[mercari] no session candidates were available for the search."],
      requestedUrls: [],
      activeResult: buildMercariStatusResult(buildMercariSearchUrl(query, "on_sale"), {
        source: "failed",
      }),
      soldResult: buildMercariStatusResult(buildMercariSearchUrl(query, "sold_out"), {
        source: "failed",
      }),
      status: "error",
      blockedReasons: [],
      requestCount,
      retryCount,
      browserFallbackUsed,
      warmupUsed,
    }
  );
}

async function collectMercariVariantWithTimeout(
  query: string,
  variantKey: string,
  variantLabel: string,
  limit: number,
  timeoutMs: number,
): Promise<MercariVariantCollectionResult> {
  const timeoutWindowMs = Math.min(timeoutMs, MERCARI_VARIANT_TIMEOUT_MS);

  return Promise.race([
    collectMercariVariant(query, variantKey, variantLabel, limit, timeoutMs),
    new Promise<MercariVariantCollectionResult>((resolve) => {
      setTimeout(() => {
        resolve({
          items: [],
          warnings: [
            `[mercari:${variantKey}] variant collection timed out after ${timeoutWindowMs}ms.`,
          ],
          requestedUrls: [
            buildMercariSearchUrl(query, "on_sale"),
            buildMercariSearchUrl(query, "sold_out"),
          ],
          activeResult: buildMercariStatusResult(buildMercariSearchUrl(query, "on_sale"), {
            source: "failed",
            warnings: [
              `[mercari:on_sale] aborted after ${timeoutWindowMs}ms variant timeout guard.`,
            ],
          }),
          soldResult: buildMercariStatusResult(buildMercariSearchUrl(query, "sold_out"), {
            source: "failed",
            warnings: [
              `[mercari:sold_out] aborted after ${timeoutWindowMs}ms variant timeout guard.`,
            ],
          }),
          status: "timeout",
          blockedReasons: [],
          requestCount: 0,
          retryCount: 0,
          browserFallbackUsed: false,
          warmupUsed: false,
        });
      }, timeoutWindowMs);
    }),
  ]);
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
      const variants = buildProviderQueryVariants(context.queryPlan, "mercari").slice(
        0,
        MERCARI_MAX_QUERY_VARIANTS,
      );
      const collectorDeadlineAt = startedAt + context.timeoutMs - 800;
      const attempts: ProviderQueryAttemptDebug[] = [];
      const statusResults: MercariCollectorMeta["statusResults"] = [];
      const allWarnings: string[] = [];
      const collectedItems: MercariRawListing[] = [];
      const blockedReasons: string[] = [];
      const requestedUrls: string[] = [];
      let totalRetryCount = 0;
      let requestCount = 0;
      let fallbackUsed = false;
      let browserFallbackUsed = false;
      let warmupUsed = false;
      let chromeExecutablePath: string | undefined;
      let selectedSession: MercariSessionState | undefined;

      for (const variant of variants) {
        const attemptStartedAt = Date.now();
        const variantResult = await collectMercariVariantWithTimeout(
          variant.query,
          variant.key,
          variant.label,
          perStatusLimit,
          context.timeoutMs,
        );

        requestCount += variantResult.requestCount;
        totalRetryCount += variantResult.retryCount;
        fallbackUsed = fallbackUsed || attempts.length > 0;
        browserFallbackUsed =
          browserFallbackUsed || variantResult.browserFallbackUsed;
        warmupUsed = warmupUsed || variantResult.warmupUsed;
        chromeExecutablePath =
          chromeExecutablePath ?? variantResult.chromeExecutablePath;
        selectedSession = variantResult.session ?? selectedSession;

        blockedReasons.push(...variantResult.blockedReasons);
        requestedUrls.push(...variantResult.requestedUrls);
        allWarnings.push(...variantResult.warnings);
        collectedItems.push(...variantResult.items);

        statusResults.push(
          {
            variantKey: variant.key,
            variantLabel: variant.label,
            query: variant.query,
            status: "on_sale",
            source: variantResult.activeResult.source,
            renderer: variantResult.activeResult.renderer,
            requestedUrl: variantResult.activeResult.requestedUrl,
            totalCells: variantResult.activeResult.totalCells,
            parsedCount: variantResult.activeResult.items.length,
            ignoredCells: variantResult.activeResult.ignoredCells,
            blocked: variantResult.activeResult.blocked,
            blockedReasons: variantResult.activeResult.blockedReasons,
            sessionId: variantResult.activeResult.sessionId,
            fingerprintId: variantResult.activeResult.fingerprintId,
          },
          {
            variantKey: variant.key,
            variantLabel: variant.label,
            query: variant.query,
            status: "sold_out",
            source: variantResult.soldResult.source,
            renderer: variantResult.soldResult.renderer,
            requestedUrl: variantResult.soldResult.requestedUrl,
            totalCells: variantResult.soldResult.totalCells,
            parsedCount: variantResult.soldResult.items.length,
            ignoredCells: variantResult.soldResult.ignoredCells,
            blocked: variantResult.soldResult.blocked,
            blockedReasons: variantResult.soldResult.blockedReasons,
            sessionId: variantResult.soldResult.sessionId,
            fingerprintId: variantResult.soldResult.fingerprintId,
          },
        );

        const confidenceScore = Number(
          Math.max(
            0,
            Math.min(
              1,
              variant.confidence -
                (attempts.length > 0 ? 0.05 : 0) -
                variantResult.retryCount * 0.08 -
                (variantResult.status === "blocked" ? 0.25 : 0) -
                (variantResult.browserFallbackUsed ? 0.04 : 0),
            ),
          ).toFixed(3),
        );

        attempts.push({
          variantKey: variant.key,
          variantLabel: variant.label,
          query: variant.query,
          status: variantResult.status,
          rawResultCount: variantResult.items.length,
          durationMs: Date.now() - attemptStartedAt,
          requestedUrls: variantResult.requestedUrls,
          warnings: compactWarnings([
            ...variantResult.warnings,
            ...variantResult.blockedReasons.map(
              (reason) => `[mercari] blocked reason: ${reason}`,
            ),
          ], 4),
          usedFallback: attempts.length > 0 || variantResult.retryCount > 0,
          retryCount: variantResult.retryCount,
          confidenceScore,
        });

        const dedupedCollected = dedupeByKey(
          collectedItems,
          (item) => item.itemId,
        );
        const remainingBudgetMs = collectorDeadlineAt - Date.now();
        const shouldTryFallback = shouldTryMercariFallbackVariant({
          collectedCount: dedupedCollected.length,
          attemptCount: attempts.length,
          remainingBudgetMs,
          lastAttemptStatus: variantResult.status,
          lastAttemptItemCount: variantResult.items.length,
        });

        if (
          dedupedCollected.length >= context.limit ||
          !shouldTryFallback
        ) {
          break;
        }
      }

      const rawItems = dedupeByKey(collectedItems, (item) => item.itemId).slice(
        0,
        context.limit,
      );
      const failedAttempts = attempts.filter((attempt) =>
        ["timeout", "parse_error", "blocked", "error"].includes(attempt.status),
      ).length;
      const dedupedBlockedReasons = dedupeStrings(blockedReasons);
      const status: ProviderExecutionStatus =
        rawItems.length > 0
          ? failedAttempts > 0
            ? "partial"
            : "success"
          : dedupedBlockedReasons.length > 0
            ? "blocked"
            : attempts.some((attempt) => attempt.status === "timeout")
              ? "timeout"
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
                  attempts.reduce(
                    (sum, attempt) => sum + (attempt.confidenceScore ?? 0),
                    0,
                  ) / Math.max(attempts.length, 1) -
                    (fallbackUsed ? 0.04 : 0) -
                    dedupedBlockedReasons.length * 0.05,
                ),
              ).toFixed(3),
            )
          : 0;

      const error =
        status === "blocked"
          ? createProviderError({
              type: "blocked",
              message:
                "Mercari search returned a challenge page before item cells were available.",
              retryable: true,
              details: dedupedBlockedReasons[0],
            })
          : status === "timeout"
            ? createProviderError({
                type: "timeout",
                message: "Mercari browser collection exceeded the variant timeout guard.",
                retryable: true,
                details: compactWarnings(allWarnings, 1)[0],
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
                  details:
                    compactWarnings(
                      [...allWarnings, ...dedupedBlockedReasons],
                      1,
                    )[0],
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
          strategy: "multi_variant_session_aware",
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
          blocked: dedupedBlockedReasons.length > 0,
          queryVariantCount: variants.length,
          summary: {
            rawCount: rawItems.length,
            blockedReasons: dedupedBlockedReasons,
            requestedUrls: dedupeStrings(requestedUrls),
            sessionId: selectedSession?.sessionId,
            fingerprintId: selectedSession?.fingerprint.id,
            fingerprintLabel: selectedSession?.fingerprint.label,
            cooldownUntil: selectedSession?.cooldownUntil
              ? new Date(selectedSession.cooldownUntil).toISOString()
              : undefined,
            browserFallbackUsed,
            warmupUsed,
          },
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

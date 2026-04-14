import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MercariRawListing } from "@/lib/fixtures/types";
import { buildCollectorEnvelope, RawMarketCollector } from "@/lib/providers/base";
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
import { MercariParseResult, MercariSearchStatus, parseMercariSearchHtml } from "@/lib/providers/mercari/parser";
import { createProviderError } from "@/lib/providers/base";

const execFileAsync = promisify(execFile);

interface MercariCollectorMeta extends Record<string, unknown> {
  strategy: "rendered_dom_first_with_http_fallback";
  perStatusLimit: number;
  requestCount: number;
  chromeExecutablePath?: string;
  statusResults: Array<{
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
  chromeExecutablePath?: string;
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

  return url.toString();
}

async function fetchMercariSearchHtml(url: string, timeoutMs: number): Promise<string> {
  await waitForMercariRateLimit();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), Math.min(timeoutMs, MERCARI_HTTP_TIMEOUT_MS));

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": MERCARI_DEFAULT_USER_AGENT,
        "Accept-Language": MERCARI_DEFAULT_ACCEPT_LANGUAGE,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
      message: "Mercari 실수집기 렌더링에는 로컬 Chrome 또는 Edge가 필요합니다.",
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
        `--lang=ja-JP`,
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

function sliceMercariItems(items: MercariRawListing[], limit: number): MercariRawListing[] {
  const seenIds = new Set<string>();
  const deduped: MercariRawListing[] = [];

  for (const item of items) {
    if (!item.itemId || seenIds.has(item.itemId)) {
      continue;
    }

    seenIds.add(item.itemId);
    deduped.push(item);

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

function buildStatusWarnings(
  status: MercariSearchStatus,
  sourceLabel: string,
  parseResult: MercariParseResult,
): string[] {
  return parseResult.warnings.map(
    (warning) => `[mercari:${status}:${sourceLabel}] ${warning}`,
  );
}

function compactWarnings(warnings: string[], limit = 8): string[] {
  const uniqueWarnings = [...new Set(warnings)];

  if (uniqueWarnings.length <= limit) {
    return uniqueWarnings;
  }

  return [
    ...uniqueWarnings.slice(0, limit),
    `[mercari] ${uniqueWarnings.length - limit}개의 추가 경고는 생략되었습니다.`,
  ];
}

async function collectMercariStatus(
  query: string,
  status: MercariSearchStatus,
  limit: number,
  timeoutMs: number,
): Promise<MercariStatusCollectionResult> {
  const url = buildMercariSearchUrl(query, status);
  const warnings: string[] = [];

  try {
    const rendered = await renderMercariSearchHtml(url, timeoutMs);
    const parsedFromDom = parseMercariSearchHtml(rendered.html, {
      statusHint: status,
      source: "rendered_dom",
    });

    warnings.push(...buildStatusWarnings(status, "rendered_dom", parsedFromDom));

    if (parsedFromDom.items.length > 0 || parsedFromDom.emptyResult || parsedFromDom.foundItemGrid) {
      return {
        items: sliceMercariItems(parsedFromDom.items, limit),
        warnings,
        source: parsedFromDom.emptyResult ? "empty" : "rendered_dom",
        totalCells: parsedFromDom.totalCells,
        ignoredCells: parsedFromDom.ignoredCells,
        chromeExecutablePath: rendered.chromeExecutablePath,
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
    const rawHtml = await fetchMercariSearchHtml(url, timeoutMs);
    const parsedFromHttp = parseMercariSearchHtml(rawHtml, {
      statusHint: status,
      source: "http",
    });

    return {
      items: sliceMercariItems(parsedFromHttp.items, limit),
      warnings: [...warnings, ...buildStatusWarnings(status, "http", parsedFromHttp)],
      source: parsedFromHttp.emptyResult ? "empty" : parsedFromHttp.items.length > 0 ? "http" : "empty",
      totalCells: parsedFromHttp.totalCells,
      ignoredCells: parsedFromHttp.ignoredCells,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      items: [],
      warnings: [...warnings, `[mercari:${status}:http] ${message}`],
      source: "failed",
      totalCells: 0,
      ignoredCells: 0,
    };
  }
}

export const mercariRealCollector: RawMarketCollector<MercariRawListing, MercariCollectorMeta> = {
  id: "mercari",
  label: "메루카리",
  mode: "real",
  defaultTimeoutMs: 22000,
  async collect(context) {
    const startedAt = Date.now();
    const perStatusLimit = Math.max(Math.ceil(context.limit / 2), 12);
    const statusResults = await Promise.all([
      collectMercariStatus(context.query, "on_sale", perStatusLimit, context.timeoutMs),
      collectMercariStatus(context.query, "sold_out", perStatusLimit, context.timeoutMs),
    ]);

    const rawItems = sliceMercariItems(
      statusResults.flatMap((result) => result.items),
      context.limit,
    );
    const warnings = compactWarnings(
      statusResults.flatMap((result) => result.warnings),
    );
    const failedStatuses = statusResults.filter((result) => result.source === "failed").length;
    const hasAnyItems = rawItems.length > 0;
    const hasOnlyEmptyResults = statusResults.every((result) => result.source === "empty");
    const chromeExecutablePath = statusResults.find((result) => result.chromeExecutablePath)?.chromeExecutablePath;

    const status =
      failedStatuses > 0
        ? hasAnyItems
          ? "partial"
          : "error"
        : hasOnlyEmptyResults
          ? "empty"
          : hasAnyItems
            ? "success"
            : "empty";

    const error =
      status === "error"
        ? createProviderError({
            type: chromeExecutablePath ? "parsing_failure" : "not_configured",
            message: chromeExecutablePath
              ? "Mercari 검색 결과를 파싱하지 못했습니다."
              : "Mercari 실수집기 실행에 필요한 브라우저를 찾지 못했습니다.",
            retryable: true,
          })
        : status === "partial"
          ? createProviderError({
              type: "partial_result",
              message: "Mercari 일부 결과만 수집되었습니다.",
              retryable: true,
            })
          : undefined;

    return buildCollectorEnvelope<MercariRawListing, MercariCollectorMeta>({
      market: "mercari",
      label: "메루카리",
      mode: "real",
      query: context.query,
      status,
      rawItems,
      meta: {
        strategy: "rendered_dom_first_with_http_fallback",
        perStatusLimit,
        requestCount: 2,
        chromeExecutablePath: chromeExecutablePath ?? undefined,
        statusResults: [
          {
            status: "on_sale",
            source: statusResults[0]?.source ?? "failed",
            requestedUrl: buildMercariSearchUrl(context.query, "on_sale"),
            totalCells: statusResults[0]?.totalCells ?? 0,
            parsedCount: statusResults[0]?.items.length ?? 0,
            ignoredCells: statusResults[0]?.ignoredCells ?? 0,
          },
          {
            status: "sold_out",
            source: statusResults[1]?.source ?? "failed",
            requestedUrl: buildMercariSearchUrl(context.query, "sold_out"),
            totalCells: statusResults[1]?.totalCells ?? 0,
            parsedCount: statusResults[1]?.items.length ?? 0,
            ignoredCells: statusResults[1]?.ignoredCells ?? 0,
          },
        ],
      },
      warnings,
      error,
      durationMs: Date.now() - startedAt,
    });
  },
};

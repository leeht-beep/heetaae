import { BunjangRawListing } from "@/lib/fixtures/types";
import {
  buildCollectorEnvelope,
  createProviderError,
  RawMarketCollector,
} from "@/lib/providers/base";
import {
  BUNJANG_DEFAULT_ACCEPT_LANGUAGE,
  BUNJANG_DEFAULT_LIMIT,
  BUNJANG_DEFAULT_USER_AGENT,
  BUNJANG_HTTP_TIMEOUT_MS,
  BUNJANG_REQUEST_INTERVAL_MS,
} from "@/lib/providers/bunjang/config";
import {
  buildBunjangSearchApiUrl,
  parseBunjangSearchResponseText,
} from "@/lib/providers/bunjang/parser";

interface BunjangCollectorMeta extends Record<string, unknown> {
  strategy: "json_api";
  requestedUrl: string;
  requestCount: number;
  requestedCount: number;
  totalEntries: number;
  productEntries: number;
  adEntries: number;
  ignoredEntries: number;
  malformedEntries: number;
}

let lastBunjangRequestAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBunjangRateLimit(intervalMs = BUNJANG_REQUEST_INTERVAL_MS) {
  const now = Date.now();
  const waitMs = Math.max(0, lastBunjangRequestAt + intervalMs - now);

  if (waitMs > 0) {
    await delay(waitMs);
  }

  lastBunjangRequestAt = Date.now();
}

function compactWarnings(warnings: string[], limit = 6): string[] {
  const uniqueWarnings = [...new Set(warnings)];

  if (uniqueWarnings.length <= limit) {
    return uniqueWarnings;
  }

  return [
    ...uniqueWarnings.slice(0, limit),
    `[bunjang] ${uniqueWarnings.length - limit}개의 추가 경고는 생략되었습니다.`,
  ];
}

function sliceBunjangItems(items: BunjangRawListing[], limit: number): BunjangRawListing[] {
  const seenIds = new Set<string>();
  const deduped: BunjangRawListing[] = [];

  for (const item of items) {
    if (!item.productId || seenIds.has(item.productId)) {
      continue;
    }

    seenIds.add(item.productId);
    deduped.push(item);

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

async function fetchBunjangSearchResponse(
  url: string,
  timeoutMs: number,
): Promise<string> {
  await waitForBunjangRateLimit();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    Math.min(timeoutMs, BUNJANG_HTTP_TIMEOUT_MS),
  );

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": BUNJANG_DEFAULT_USER_AGENT,
        "Accept-Language": BUNJANG_DEFAULT_ACCEPT_LANGUAGE,
        Accept: "application/json, text/plain, */*",
        Referer: "https://m.bunjang.co.kr/search/products",
        "Cache-Control": "no-cache",
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`Bunjang responded with ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const bunjangRealCollector: RawMarketCollector<BunjangRawListing, BunjangCollectorMeta> = {
  id: "bunjang",
  label: "번개장터",
  mode: "real",
  defaultTimeoutMs: 12000,
  async collect(context) {
    const startedAt = Date.now();
    const requestedCount = Math.max(
      Math.min((context.limit ?? BUNJANG_DEFAULT_LIMIT) * 2, 100),
      context.limit ?? BUNJANG_DEFAULT_LIMIT,
    );
    const requestedUrl = buildBunjangSearchApiUrl(context.query, requestedCount);

    try {
      const rawText = await fetchBunjangSearchResponse(requestedUrl, context.timeoutMs);
      const parsed = parseBunjangSearchResponseText(rawText, {
        query: context.query,
        source: "api",
      });
      const rawItems = sliceBunjangItems(parsed.items, context.limit);
      const warnings = compactWarnings(parsed.warnings);

      const status =
        parsed.emptyResult || rawItems.length === 0
          ? "empty"
          : parsed.malformedEntries > 0
            ? "partial"
            : "success";

      const error =
        status === "partial"
          ? createProviderError({
              type: "partial_result",
              message: "번개장터 검색 결과 일부만 정상적으로 수집되었습니다.",
              retryable: true,
              details: warnings[0],
            })
          : status === "empty" && warnings.length > 0 && !parsed.emptyResult
            ? createProviderError({
                type: "parsing_failure",
                message: "번개장터 검색 응답을 파싱하지 못했습니다.",
                retryable: true,
                details: warnings[0],
              })
            : undefined;

      return buildCollectorEnvelope<BunjangRawListing, BunjangCollectorMeta>({
        market: "bunjang",
        label: "번개장터",
        mode: "real",
        query: context.query,
        status:
          status === "empty" && warnings.length > 0 && !parsed.emptyResult
            ? "error"
            : status,
        rawItems,
        meta: {
          strategy: "json_api",
          requestedUrl,
          requestCount: 1,
          requestedCount,
          totalEntries: parsed.totalEntries,
          productEntries: parsed.productEntries,
          adEntries: parsed.adEntries,
          ignoredEntries: parsed.ignoredEntries,
          malformedEntries: parsed.malformedEntries,
        },
        warnings,
        error,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      return buildCollectorEnvelope<BunjangRawListing, BunjangCollectorMeta>({
        market: "bunjang",
        label: "번개장터",
        mode: "real",
        query: context.query,
        status: "error",
        rawItems: [],
        meta: {
          strategy: "json_api",
          requestedUrl,
          requestCount: 1,
          requestedCount,
          totalEntries: 0,
          productEntries: 0,
          adEntries: 0,
          ignoredEntries: 0,
          malformedEntries: 0,
        },
        warnings: [],
        error: createProviderError({
          type: "network_error",
          message: "번개장터 검색 요청에 실패했습니다.",
          retryable: true,
          details: error instanceof Error ? error.message : String(error),
        }),
        durationMs: Date.now() - startedAt,
      });
    }
  },
};

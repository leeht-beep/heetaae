import { FruitsfamilyRawListing } from "@/lib/fixtures/types";
import {
  buildCollectorEnvelope,
  createProviderError,
  RawMarketCollector,
} from "@/lib/providers/base";
import {
  FRUITSFAMILY_DEFAULT_ACCEPT_LANGUAGE,
  FRUITSFAMILY_DEFAULT_USER_AGENT,
  FRUITSFAMILY_HTTP_TIMEOUT_MS,
  FRUITSFAMILY_REQUEST_INTERVAL_MS,
} from "@/lib/providers/fruitsfamily/config";
import {
  buildFruitsfamilySearchUrl,
  parseFruitsfamilySearchHtml,
} from "@/lib/providers/fruitsfamily/parser";

interface FruitsfamilyCollectorMeta extends Record<string, unknown> {
  strategy: "apollo_state_html";
  requestedUrl: string;
  requestCount: number;
  totalRefs: number;
  resolvedRefs: number;
  malformedEntries: number;
  ignoredEntries: number;
  urlMatchCount: number;
  usedFallbackCollection: boolean;
}

let lastFruitsfamilyRequestAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFruitsfamilyRateLimit(
  intervalMs = FRUITSFAMILY_REQUEST_INTERVAL_MS,
) {
  const now = Date.now();
  const waitMs = Math.max(0, lastFruitsfamilyRequestAt + intervalMs - now);

  if (waitMs > 0) {
    await delay(waitMs);
  }

  lastFruitsfamilyRequestAt = Date.now();
}

function compactWarnings(warnings: string[], limit = 6): string[] {
  const uniqueWarnings = [...new Set(warnings)];

  if (uniqueWarnings.length <= limit) {
    return uniqueWarnings;
  }

  return [
    ...uniqueWarnings.slice(0, limit),
    `[fruitsfamily] ${uniqueWarnings.length - limit}개의 추가 경고는 생략되었습니다.`,
  ];
}

function sliceFruitsfamilyItems(
  items: FruitsfamilyRawListing[],
  limit: number,
): FruitsfamilyRawListing[] {
  const seenIds = new Set<string>();
  const deduped: FruitsfamilyRawListing[] = [];

  for (const item of items) {
    if (!item.slug || seenIds.has(item.slug)) {
      continue;
    }

    seenIds.add(item.slug);
    deduped.push(item);

    if (deduped.length >= limit) {
      break;
    }
  }

  return deduped;
}

async function fetchFruitsfamilySearchHtml(
  url: string,
  timeoutMs: number,
): Promise<string> {
  await waitForFruitsfamilyRateLimit();

  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    Math.min(timeoutMs, FRUITSFAMILY_HTTP_TIMEOUT_MS),
  );

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": FRUITSFAMILY_DEFAULT_USER_AGENT,
        "Accept-Language": FRUITSFAMILY_DEFAULT_ACCEPT_LANGUAGE,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Cache-Control": "no-cache",
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`FruitsFamily responded with ${response.status} for ${url}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const fruitsfamilyRealCollector: RawMarketCollector<
  FruitsfamilyRawListing,
  FruitsfamilyCollectorMeta
> = {
  id: "fruitsfamily",
  label: "FruitsFamily",
  mode: "real",
  defaultTimeoutMs: 12000,
  async collect(context) {
    const startedAt = Date.now();
    const requestedUrl = buildFruitsfamilySearchUrl(context.query);

    try {
      const html = await fetchFruitsfamilySearchHtml(requestedUrl, context.timeoutMs);
      const parsed = parseFruitsfamilySearchHtml(html, {
        query: context.query,
        source: "apollo_state",
      });
      const rawItems = sliceFruitsfamilyItems(parsed.items, context.limit);
      const warnings = compactWarnings(parsed.warnings);

      const collectorStatus =
        parsed.emptyResult || rawItems.length === 0
          ? warnings.length > 0 && !parsed.emptyResult
            ? "error"
            : "empty"
          : parsed.malformedEntries > 0
            ? "partial"
            : "success";

      const error =
        collectorStatus === "partial"
          ? createProviderError({
              type: "partial_result",
              message: "FruitsFamily 검색 결과 일부만 정상적으로 수집되었습니다.",
              retryable: true,
              details: warnings[0],
            })
          : collectorStatus === "error"
            ? createProviderError({
                type: "parsing_failure",
                message: "FruitsFamily 검색 페이지를 파싱하지 못했습니다.",
                retryable: true,
                details: warnings[0],
              })
            : undefined;

      return buildCollectorEnvelope<FruitsfamilyRawListing, FruitsfamilyCollectorMeta>({
        market: "fruitsfamily",
        label: "FruitsFamily",
        mode: "real",
        query: context.query,
        status: collectorStatus,
        rawItems,
        meta: {
          strategy: "apollo_state_html",
          requestedUrl,
          requestCount: 1,
          totalRefs: parsed.totalRefs,
          resolvedRefs: parsed.resolvedRefs,
          malformedEntries: parsed.malformedEntries,
          ignoredEntries: parsed.ignoredEntries,
          urlMatchCount: parsed.urlMatchCount,
          usedFallbackCollection: parsed.usedFallbackCollection,
        },
        warnings,
        error,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      return buildCollectorEnvelope<FruitsfamilyRawListing, FruitsfamilyCollectorMeta>({
        market: "fruitsfamily",
        label: "FruitsFamily",
        mode: "real",
        query: context.query,
        status: "error",
        rawItems: [],
        meta: {
          strategy: "apollo_state_html",
          requestedUrl,
          requestCount: 1,
          totalRefs: 0,
          resolvedRefs: 0,
          malformedEntries: 0,
          ignoredEntries: 0,
          urlMatchCount: 0,
          usedFallbackCollection: false,
        },
        warnings: [],
        error: createProviderError({
          type: "network_error",
          message: "FruitsFamily 검색 요청에 실패했습니다.",
          retryable: true,
          details: error instanceof Error ? error.message : String(error),
        }),
        durationMs: Date.now() - startedAt,
      });
    }
  },
};

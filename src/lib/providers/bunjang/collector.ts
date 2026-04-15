import { BunjangRawListing } from "@/lib/fixtures/types";
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
import { buildProviderQueryVariants } from "@/lib/utils/query";
import {
  DropReasonSummary,
  ProviderExecutionStatus,
  ProviderQueryAttemptDebug,
} from "@/lib/types/market";

const BUNJANG_CACHE_TTL_MS = 45_000;

interface BunjangCollectorMeta extends Record<string, unknown> {
  strategy: "json_api_multi_variant";
  requestCount: number;
  attemptedQueries: ProviderQueryAttemptDebug[];
  requestedUrls: string[];
  fallbackUsed: boolean;
  dropReasons?: DropReasonSummary[];
  malformedCount?: number;
  salvagedCount?: number;
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

function compactWarnings(warnings: string[], limit = 8): string[] {
  const uniqueWarnings = [...new Set(warnings)];

  if (uniqueWarnings.length <= limit) {
    return uniqueWarnings;
  }

  return [
    ...uniqueWarnings.slice(0, limit),
    `[bunjang] ${uniqueWarnings.length - limit} additional warnings omitted.`,
  ];
}

function mergeDropReasonSummary(
  target: Map<string, { count: number; examples: string[] }>,
  reasons: DropReasonSummary[],
) {
  reasons.forEach((reason) => {
    const entry = target.get(reason.reason) ?? { count: 0, examples: [] };
    entry.count += reason.count;

    (reason.examples ?? []).forEach((example) => {
      if (entry.examples.length < 3 && !entry.examples.includes(example)) {
        entry.examples.push(example);
      }
    });

    target.set(reason.reason, entry);
  });
}

function toDropReasonSummary(
  reasons: Map<string, { count: number; examples: string[] }>,
): DropReasonSummary[] {
  return [...reasons.entries()]
    .map(([reason, value]) => ({
      reason,
      count: value.count,
      examples: value.examples,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.reason.localeCompare(right.reason);
    });
}

function isBlockedResponse(value: string): boolean {
  return /captcha|access denied|forbidden|cloudflare|blocked/i.test(value);
}

async function fetchBunjangSearchResponse(url: string, timeoutMs: number): Promise<string> {
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

function annotateItems(
  items: BunjangRawListing[],
  query: string,
  variantKey: string,
  variantLabel: string,
  confidenceScore: number,
): BunjangRawListing[] {
  return items.map((item) => ({
    ...item,
    matchedQuery: query,
    queryVariantKey: variantKey,
    queryVariantLabel: variantLabel,
    rawConfidence: confidenceScore,
  }));
}

export const bunjangRealCollector: RawMarketCollector<BunjangRawListing, BunjangCollectorMeta> = {
  id: "bunjang",
  label: "번개장터",
  mode: "real",
  defaultTimeoutMs: 12000,
  async collect(context) {
    const cacheKey = ["bunjang", context.mode, context.queryPlan.compact, context.limit].join(":");

    const cached = await withMemoryCache(cacheKey, BUNJANG_CACHE_TTL_MS, async () => {
      const startedAt = Date.now();
      const requestedCount = Math.max(
        Math.min((context.limit ?? BUNJANG_DEFAULT_LIMIT) * 2, 100),
        context.limit ?? BUNJANG_DEFAULT_LIMIT,
      );
      const variants = buildProviderQueryVariants(context.queryPlan, "bunjang").slice(0, 4);
      const attemptedQueries: ProviderQueryAttemptDebug[] = [];
      const collectedItems: BunjangRawListing[] = [];
      const requestedUrls: string[] = [];
      const warnings: string[] = [];
      const dropReasons = new Map<string, { count: number; examples: string[] }>();
      let totalRetryCount = 0;
      let fallbackUsed = false;
      let blocked = false;
      let malformedCount = 0;
      let salvagedCount = 0;

      for (const variant of variants) {
        const attemptStartedAt = Date.now();
        const requestedUrl = buildBunjangSearchApiUrl(variant.query, requestedCount);
        requestedUrls.push(requestedUrl);

        try {
          const response = await retryTask(
            () => fetchBunjangSearchResponse(requestedUrl, context.timeoutMs),
            {
              retries: 1,
              delayMs: 200,
              shouldRetry: () => true,
            },
          );
          totalRetryCount += response.retryCount;

          if (isBlockedResponse(response.value)) {
            blocked = true;
            attemptedQueries.push({
              variantKey: variant.key,
              variantLabel: variant.label,
              query: variant.query,
              status: "blocked",
              rawResultCount: 0,
              durationMs: Date.now() - attemptStartedAt,
              requestedUrls: [requestedUrl],
              warnings: ["Blocked response detected."],
              usedFallback: attemptedQueries.length > 0,
              retryCount: response.retryCount,
              confidenceScore: 0,
            });
            continue;
          }

          const parsed = parseBunjangSearchResponseText(response.value, {
            query: variant.query,
            source: "api",
          });
          const criticalDropCount = parsed.dropReasons
            .filter((reason) => !["ad_entry", "non_product_entry"].includes(reason.reason))
            .reduce((sum, reason) => sum + reason.count, 0);
          const dropSummaryWarnings = parsed.dropReasons.slice(0, 3).map((reason) => {
            const example = reason.examples?.[0] ? ` (${reason.examples[0]})` : "";
            return `drop:${reason.reason} x${reason.count}${example}`;
          });
          const items = annotateItems(
            dedupeByKey(parsed.items, (item) => item.productId).slice(0, context.limit),
            variant.query,
            variant.key,
            variant.label,
            attemptedQueries.length === 0 ? 0.9 : 0.82,
          );
          const attemptStatus: ProviderExecutionStatus =
            parsed.emptyResult || items.length === 0
              ? criticalDropCount > 0 && !parsed.emptyResult
                ? "parse_error"
                : "empty"
              : criticalDropCount > Math.max(3, Math.floor(parsed.totalEntries * 0.25))
                ? "partial"
                : "success";

          warnings.push(...parsed.warnings);
          mergeDropReasonSummary(dropReasons, parsed.dropReasons);
          malformedCount += parsed.malformedEntries;
          salvagedCount += parsed.salvagedEntries;
          collectedItems.push(...items);
          attemptedQueries.push({
            variantKey: variant.key,
            variantLabel: variant.label,
            query: variant.query,
            status: attemptStatus,
            rawResultCount: items.length,
            durationMs: Date.now() - attemptStartedAt,
            requestedUrls: [requestedUrl],
            warnings: compactWarnings([...parsed.warnings, ...dropSummaryWarnings], 4),
            usedFallback: attemptedQueries.length > 0,
            retryCount: response.retryCount,
            confidenceScore: Number(
              Math.max(
                0,
                (attemptedQueries.length === 0 ? 0.9 : 0.82) -
                  parsed.salvagedEntries * 0.01 -
                  criticalDropCount * 0.015,
              ).toFixed(3),
            ),
          });

          if (attemptedQueries.length > 1) {
            fallbackUsed = true;
          }

          const deduped = dedupeByKey(collectedItems, (item) => item.productId);

          if (
            deduped.length >= context.limit ||
            (attemptedQueries.length === 1 && deduped.length >= Math.max(8, Math.ceil(context.limit * 0.7)))
          ) {
            break;
          }
        } catch (error) {
          attemptedQueries.push({
            variantKey: variant.key,
            variantLabel: variant.label,
            query: variant.query,
            status: "error",
            rawResultCount: 0,
            durationMs: Date.now() - attemptStartedAt,
            requestedUrls: [requestedUrl],
            warnings: [error instanceof Error ? error.message : String(error)],
            usedFallback: attemptedQueries.length > 0,
            retryCount: 1,
            confidenceScore: 0,
          });
        }
      }

      const rawItems = dedupeByKey(collectedItems, (item) => item.productId).slice(0, context.limit);
      const failedAttempts = attemptedQueries.filter((attempt) =>
        ["blocked", "parse_error", "timeout", "error"].includes(attempt.status),
      ).length;
      const status: ProviderExecutionStatus =
        rawItems.length > 0
          ? failedAttempts > 0
            ? "partial"
            : "success"
          : blocked
            ? "blocked"
            : attemptedQueries.some((attempt) => attempt.status === "parse_error")
              ? "parse_error"
              : "empty";
      const confidenceScore =
        rawItems.length > 0
          ? Number(
              Math.max(
                0,
                Math.min(
                  1,
                  attemptedQueries.reduce((sum, attempt) => sum + (attempt.confidenceScore ?? 0), 0) /
                    Math.max(attemptedQueries.length, 1) -
                    (fallbackUsed ? 0.05 : 0),
                ),
              ).toFixed(3),
            )
          : 0;
      const dropReasonSummary = toDropReasonSummary(dropReasons);
      const error =
        status === "blocked"
          ? createProviderError({
              type: "blocked",
              message: "Bunjang blocked the search request.",
              retryable: true,
            })
          : status === "parse_error"
            ? createProviderError({
                type: "parse_error",
                message: "Bunjang response format changed and parsing failed.",
                retryable: true,
                details: compactWarnings(warnings, 1)[0],
              })
            : status === "partial"
              ? createProviderError({
                  type: "partial_result",
                  message: "Bunjang returned only a partial result set.",
                  retryable: true,
                  details: compactWarnings(warnings, 1)[0],
                })
              : undefined;

      return buildCollectorEnvelope<BunjangRawListing, BunjangCollectorMeta>({
        market: "bunjang",
        label: "번개장터",
        mode: "real",
        query: context.queryPlan.normalized || context.query,
        status,
        rawItems,
        meta: {
          strategy: "json_api_multi_variant",
          requestCount: attemptedQueries.length,
          attemptedQueries,
          requestedUrls,
          fallbackUsed,
          dropReasons: dropReasonSummary,
          malformedCount,
          salvagedCount,
        },
        warnings: compactWarnings(warnings),
        confidenceScore,
        debug: {
          market: "bunjang",
          attemptedQueries,
          fallbackUsed,
          cacheHit: false,
          retryCount: totalRetryCount,
          blocked,
          queryVariantCount: variants.length,
          summary: {
            rawCount: rawItems.length,
            requestedUrls,
            invalidCount: malformedCount,
            salvagedCount,
            dropReasons: dropReasonSummary,
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

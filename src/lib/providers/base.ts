import type {
  MarketCollectionSummary,
  MarketId,
  NormalizationEnvelope,
  ProviderErrorInfo,
  ProviderExecutionStatus,
  ProviderMode,
  RawCollectorEnvelope,
  SearchQueryPlan,
} from "@/lib/types/market";
import { preprocessSearchQuery } from "@/lib/utils/query";

export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;

export interface SearchProviderContext {
  query: string;
  queryPlan?: SearchQueryPlan;
  limit?: number;
  minRelevanceScore?: number;
  timeoutMs?: number;
  mode?: ProviderMode;
}

export interface ResolvedSearchProviderContext {
  query: string;
  queryPlan: SearchQueryPlan;
  limit: number;
  minRelevanceScore: number;
  timeoutMs: number;
  mode: ProviderMode;
}

export interface ProviderNormalizationContext<TRawItem> {
  query: string;
  queryPlan: SearchQueryPlan;
  market: MarketId;
  label: string;
  rawItems: TRawItem[];
  minRelevanceScore: number;
}

export interface RawMarketCollector<
  TRawItem = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  id: MarketId;
  label: string;
  mode: ProviderMode;
  defaultTimeoutMs?: number;
  collect(
    context: ResolvedSearchProviderContext,
  ): Promise<RawCollectorEnvelope<TRawItem, TMeta>>;
}

export interface MarketNormalizer<TRawItem = unknown> {
  market: MarketId;
  label: string;
  normalize(
    context: ProviderNormalizationContext<TRawItem>,
  ): Promise<NormalizationEnvelope> | NormalizationEnvelope;
}

export interface MarketDataSource<
  TRawItem = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  id: MarketId;
  label: string;
  collectors: Record<ProviderMode, RawMarketCollector<TRawItem, TMeta>>;
  normalizer: MarketNormalizer<TRawItem>;
}

export interface MarketProviderRunResult<
  TRawItem = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  collector: RawCollectorEnvelope<TRawItem, TMeta>;
  normalized: NormalizationEnvelope;
  summary: MarketCollectionSummary;
}

export function createProviderError(error: ProviderErrorInfo): ProviderErrorInfo {
  return error;
}

export function buildCollectorEnvelope<
  TRawItem = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
>(options: {
  market: MarketId;
  label: string;
  mode: ProviderMode;
  query: string;
  status: ProviderExecutionStatus;
  rawItems?: TRawItem[];
  meta?: TMeta;
  warnings?: string[];
  confidenceScore?: number;
  error?: ProviderErrorInfo;
  durationMs: number;
  fetchedAt?: string;
  debug?: RawCollectorEnvelope<TRawItem, TMeta>["debug"];
}): RawCollectorEnvelope<TRawItem, TMeta> {
  return {
    market: options.market,
    label: options.label,
    mode: options.mode,
    query: options.query,
    status: options.status,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    durationMs: options.durationMs,
    rawItems: options.rawItems ?? [],
    meta: (options.meta ?? {}) as TMeta,
    warnings: options.warnings ?? [],
    confidenceScore: options.confidenceScore,
    debug: options.debug,
    error: options.error,
  };
}

export function resolveSearchProviderContext(
  context: SearchProviderContext,
): ResolvedSearchProviderContext {
  return {
    query: context.query,
    queryPlan: context.queryPlan ?? preprocessSearchQuery(context.query),
    limit: context.limit ?? 24,
    minRelevanceScore: context.minRelevanceScore ?? 0.34,
    timeoutMs: context.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    mode: context.mode ?? "mock",
  };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const timeoutError = new Error(`Provider timed out after ${timeoutMs}ms`);
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function resolveSummaryStatus(
  collectorStatus: ProviderExecutionStatus,
  normalized: NormalizationEnvelope,
): ProviderExecutionStatus {
  if (collectorStatus === "timeout" || collectorStatus === "blocked" || collectorStatus === "error") {
    return normalized.listings.length > 0 ? "partial" : collectorStatus;
  }

  if (collectorStatus === "partial") {
    return normalized.listings.length > 0 ? "partial" : normalized.status;
  }

  if (
    normalized.status === "parse_error" ||
    normalized.status === "parsing_failure" ||
    normalized.status === "partial"
  ) {
    return normalized.status === "parsing_failure" ? "parse_error" : normalized.status;
  }

  if (normalized.listings.length === 0) {
    return "empty";
  }

  return "success";
}

function buildCollectionSummary<
  TRawItem,
  TMeta extends Record<string, unknown>,
>(
  collector: RawCollectorEnvelope<TRawItem, TMeta>,
  normalized: NormalizationEnvelope,
): MarketCollectionSummary {
  return {
    sourceMarket: collector.market,
    label: collector.label,
    mode: collector.mode,
    status: resolveSummaryStatus(collector.status, normalized),
    rawItemCount: collector.rawItems.length,
    normalizedItemCount: normalized.stats.normalizedCount,
    skippedItemCount: normalized.stats.skippedCount,
    activeListingCount: normalized.stats.activeCount,
    soldListingCount: normalized.stats.soldCount,
    durationMs: collector.durationMs,
    confidenceScore:
      normalized.confidenceScore > 0
        ? normalized.confidenceScore
        : collector.confidenceScore ?? 0,
    warnings: [...collector.warnings, ...normalized.warnings],
    debug: collector.debug,
    error: normalized.error ?? collector.error,
  };
}

function buildCollectorFailureEnvelope<
  TRawItem,
  TMeta extends Record<string, unknown>,
>(
  source: MarketDataSource<TRawItem, TMeta>,
  context: ResolvedSearchProviderContext,
  error: unknown,
): RawCollectorEnvelope<TRawItem, TMeta> {
  const providerError =
    isTimeoutError(error)
      ? createProviderError({
          type: "timeout",
          message: `${source.label} collection timed out.`,
          retryable: true,
        })
      : createProviderError({
          type: "unknown",
          message: `${source.label} collection failed.`,
          retryable: true,
          details: error instanceof Error ? error.message : String(error),
        });

  return buildCollectorEnvelope<TRawItem, TMeta>({
    market: source.id,
    label: source.label,
    mode: context.mode,
    query: context.query,
    status: providerError.type === "timeout" ? "timeout" : "error",
    rawItems: [],
    meta: {} as TMeta,
    warnings: [],
    error: providerError,
    confidenceScore: 0,
    durationMs: context.timeoutMs,
  });
}

export async function runMarketDataSource<
  TRawItem = unknown,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
>(
  source: MarketDataSource<TRawItem, TMeta>,
  context: SearchProviderContext,
): Promise<MarketProviderRunResult<TRawItem, TMeta>> {
  const requestedMode = context.mode ?? "mock";
  const collector = source.collectors[requestedMode];
  const resolvedContext = resolveSearchProviderContext({
    ...context,
    mode: requestedMode,
    timeoutMs: context.timeoutMs ?? collector?.defaultTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
  });

  const rawEnvelope = collector
    ? await withTimeout(collector.collect(resolvedContext), resolvedContext.timeoutMs).catch(
        (error) => buildCollectorFailureEnvelope(source, resolvedContext, error),
      )
    : buildCollectorEnvelope<TRawItem, TMeta>({
        market: source.id,
        label: source.label,
        mode: resolvedContext.mode,
        query: resolvedContext.query,
        status: "blocked",
        rawItems: [],
        meta: {} as TMeta,
        warnings: [],
        confidenceScore: 0,
        error: createProviderError({
          type: "not_configured",
          message: `${source.label} ${resolvedContext.mode} collector is not configured.`,
          retryable: false,
        }),
        durationMs: 0,
      });

  const normalized = await source.normalizer.normalize({
    query: rawEnvelope.query,
    queryPlan: resolvedContext.queryPlan,
    market: source.id,
    label: source.label,
    rawItems: rawEnvelope.rawItems,
    minRelevanceScore: resolvedContext.minRelevanceScore,
  });

  return {
    collector: rawEnvelope,
    normalized,
    summary: buildCollectionSummary(rawEnvelope, normalized),
  };
}

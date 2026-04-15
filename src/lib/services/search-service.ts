import { DEFAULT_MIN_RELEVANCE } from "@/lib/constants";
import { getConfiguredProviderMode, resolveProviderMode } from "@/lib/config/provider-mode";
import { marketDataSources } from "@/lib/providers";
import { runMarketDataSource } from "@/lib/providers/base";
import { stripMockScenarioTokens } from "@/lib/providers/mock/scenario";
import { getSearchCategoryPreset } from "@/lib/search/presets";
import {
  CategoryPresetId,
  ComparableGroup,
  CostSettings,
  DashboardSummary,
  MarketAnalysis,
  MarketListing,
  MarketProviderResultSnapshot,
  ProviderMode,
  SearchQueryPlan,
  SearchResponse,
} from "@/lib/types/market";
import {
  calculateMarketAnalysis,
  calculateProfitProjection,
  calculateRecommendation,
  enrichListingsWithKrw,
  pickRecommendedListings,
} from "@/lib/utils/calculations";
import {
  buildComparableLabel,
  computeListingSimilarity,
  normalizeText,
} from "@/lib/utils/normalize";
import { preprocessSearchQuery } from "@/lib/utils/query";

interface SearchServiceOptions {
  mode?: ProviderMode | string | null;
  preset?: CategoryPresetId | string | null;
  limit?: number;
  minRelevanceScore?: number;
  timeoutMs?: number;
}

const SEARCH_CACHE_TTL_MS = 30_000;
const searchResponseCache = new Map<string, { expiresAt: number; value: SearchResponse }>();

function sanitizeSearchTerm(searchTerm: string): string {
  const stripped = stripMockScenarioTokens(searchTerm);
  return stripped || searchTerm.trim();
}

function buildSearchCacheKey(
  queryPlan: SearchQueryPlan,
  costs: CostSettings,
  mode: ProviderMode,
  limit: number,
  minRelevanceScore: number,
): string {
  return JSON.stringify({
    mode,
    query: queryPlan.compact,
    presetId: queryPlan.presetId,
    limit,
    minRelevanceScore,
    costs,
  });
}

function getCachedSearchResponse(cacheKey: string): SearchResponse | null {
  const cached = searchResponseCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    searchResponseCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setCachedSearchResponse(cacheKey: string, value: SearchResponse) {
  searchResponseCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
}

function dedupeListings(listings: MarketListing[]): MarketListing[] {
  const byKey = new Map<string, MarketListing>();

  listings.forEach((listing) => {
    const key = `${listing.sourceMarket}:${listing.id}:${listing.itemUrl}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, listing);
      return;
    }

    if (
      listing.relevanceScore > existing.relevanceScore ||
      (listing.relevanceScore === existing.relevanceScore &&
        listing.confidenceScore > existing.confidenceScore)
    ) {
      byKey.set(key, listing);
    }
  });

  return [...byKey.values()];
}

function sortListings(listings: MarketListing[]): MarketListing[] {
  return [...listings].sort((left, right) => {
    if (right.relevanceScore !== left.relevanceScore) {
      return right.relevanceScore - left.relevanceScore;
    }

    if (right.confidenceScore !== left.confidenceScore) {
      return right.confidenceScore - left.confidenceScore;
    }

    return (right.soldAt ?? right.listedAt).localeCompare(left.soldAt ?? left.listedAt);
  });
}

function buildGroupNormalizedName(bucket: MarketListing[], seed: MarketListing): string {
  const counts = new Map<string, number>();

  bucket.forEach((listing) => {
    counts.set(listing.normalizedName, (counts.get(listing.normalizedName) ?? 0) + 1);
  });

  return (
    [...counts.entries()].sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].length - right[0].length;
    })[0]?.[0] ?? seed.normalizedName
  );
}

function resolveGroupingThreshold(
  left: MarketListing,
  right: MarketListing,
  presetId: CategoryPresetId,
): number {
  const preset = getSearchCategoryPreset(presetId);
  const sameBrand =
    left.brand !== "Unknown" &&
    right.brand !== "Unknown" &&
    normalizeText(left.brand) === normalizeText(right.brand);
  const sameCategory =
    left.category !== "uncategorized" &&
    right.category !== "uncategorized" &&
    normalizeText(left.category) === normalizeText(right.category);

  if (sameBrand && sameCategory) {
    return preset.similarity.sameBrandCategoryThreshold;
  }

  if (sameBrand) {
    return preset.similarity.sameBrandThreshold;
  }

  return preset.similarity.baseThreshold;
}

function buildComparableGroups(
  listings: MarketListing[],
  presetId: CategoryPresetId,
): ComparableGroup[] {
  const grouped: Array<{ seed: MarketListing; listings: MarketListing[] }> = [];
  const sortedListings = sortListings(listings);

  sortedListings.forEach((listing) => {
    let bestMatch:
      | {
          group: { seed: MarketListing; listings: MarketListing[] };
          score: number;
        }
      | undefined;

    grouped.forEach((group) => {
      const sampleListings = [group.seed, ...group.listings.slice(0, 2)];
      const score = Math.max(
        ...sampleListings.map((candidate) => computeListingSimilarity(listing, candidate, presetId)),
      );
      const threshold = Math.min(
        ...sampleListings.map((candidate) => resolveGroupingThreshold(listing, candidate, presetId)),
      );

      if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { group, score };
      }
    });

    if (bestMatch) {
      bestMatch.group.listings.push(listing);
      return;
    }

    grouped.push({
      seed: listing,
      listings: [listing],
    });
  });

  return grouped
    .map(({ seed, listings: bucket }, index) => {
      const prices = bucket.map((listing) => listing.priceKrw ?? 0).filter(Boolean);
      const normalizedName = buildGroupNormalizedName(bucket, seed);
      const label = buildComparableLabel(seed);

      return {
        id: `${normalizedName || "group"}-${index + 1}`,
        normalizedName,
        label,
        averagePriceKrw:
          prices.length > 0
            ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length)
            : 0,
        marketSpread: prices.length > 0 ? Math.max(...prices) - Math.min(...prices) : 0,
        listingCount: bucket.length,
        soldCount: bucket.filter((listing) => listing.listingType === "sold").length,
        activeCount: bucket.filter((listing) => listing.listingType === "active").length,
        listings: sortListings(bucket),
      };
    })
    .sort((left, right) => {
      if (right.soldCount !== left.soldCount) {
        return right.soldCount - left.soldCount;
      }

      const leftMarketCount = new Set(left.listings.map((listing) => listing.sourceMarket)).size;
      const rightMarketCount = new Set(right.listings.map((listing) => listing.sourceMarket)).size;

      if (rightMarketCount !== leftMarketCount) {
        return rightMarketCount - leftMarketCount;
      }

      return right.listingCount - left.listingCount;
    });
}

function buildMarketSnapshots(
  providerResults: Awaited<ReturnType<typeof runMarketDataSource>>[],
): MarketProviderResultSnapshot[] {
  return providerResults.map((result) => {
    const status = result.summary.status;
    const variantCounts = result.normalized.listings.reduce((accumulator, listing) => {
      const key = listing.queryVariantKey ?? "unknown";
      accumulator.set(key, (accumulator.get(key) ?? 0) + 1);
      return accumulator;
    }, new Map<string, number>());
    const debug = result.collector.debug
      ? {
          ...result.collector.debug,
          attemptedQueries: result.collector.debug.attemptedQueries.map((attempt) => {
            const normalizedResultCount = variantCounts.get(attempt.variantKey) ?? 0;

            return {
              ...attempt,
              normalizedResultCount,
              filteredOutCount: Math.max(attempt.rawResultCount - normalizedResultCount, 0),
            };
          }),
        }
      : undefined;

    return {
      ...result.summary,
      fetchedAt: result.collector.fetchedAt,
      debug,
      isSuccess: status === "success",
      isPartial: status === "partial",
      isEmpty: status === "empty",
    };
  });
}

function buildDashboardSummary(
  marketAnalyses: MarketAnalysis[],
  recommendationScore: number,
  recommendationGrade: DashboardSummary["recommendationGrade"],
  projection: SearchResponse["profitProjection"],
): DashboardSummary {
  const mercari = marketAnalyses.find((analysis) => analysis.sourceMarket === "mercari");
  const koreanMarkets = marketAnalyses.filter((analysis) => analysis.sourceMarket !== "mercari");
  const koreaAveragePrice =
    koreanMarkets.length > 0
      ? Math.round(
          koreanMarkets.reduce((sum, analysis) => sum + analysis.marketAveragePrice, 0) /
            koreanMarkets.length,
        )
      : 0;

  return {
    japanAveragePrice: mercari?.marketAveragePrice ?? 0,
    japanAveragePriceJpy: mercari?.nativeAveragePrice ?? 0,
    koreaAveragePrice,
    marketAveragePrices: {
      mercari: marketAnalyses.find((analysis) => analysis.sourceMarket === "mercari")?.marketAveragePrice ?? 0,
      bunjang: marketAnalyses.find((analysis) => analysis.sourceMarket === "bunjang")?.marketAveragePrice ?? 0,
      fruitsfamily:
        marketAnalyses.find((analysis) => analysis.sourceMarket === "fruitsfamily")?.marketAveragePrice ?? 0,
    },
    estimatedVolume7d: marketAnalyses.reduce((sum, analysis) => sum + analysis.estimatedVolume7d, 0),
    estimatedVolume14d: marketAnalyses.reduce((sum, analysis) => sum + analysis.estimatedVolume14d, 0),
    estimatedVolume30d: marketAnalyses.reduce((sum, analysis) => sum + analysis.estimatedVolume30d, 0),
    expectedNetProfit: projection.expectedNetProfit,
    expectedMarginRate: projection.expectedMarginRate,
    recommendedBuyPrice: projection.recommendedBuyPrice,
    recommendedBuyPriceJpy: projection.recommendedBuyPriceJpy,
    recommendedSellPrice: projection.recommendedSellPrice,
    recommendedSellMarket: projection.bestResaleMarket,
    marketActivityScore: Math.round(
      marketAnalyses.reduce((sum, analysis) => sum + analysis.liquidityScore, 0) /
        Math.max(marketAnalyses.length, 1),
    ),
    recommendationScore,
    recommendationGrade,
  };
}

function hasPartialFailures(marketResults: MarketProviderResultSnapshot[]): boolean {
  return marketResults.some((result) =>
    ["partial", "timeout", "parse_error", "parsing_failure", "blocked", "error"].includes(result.status),
  );
}

function hasAnySuccessfulMarket(marketResults: MarketProviderResultSnapshot[]): boolean {
  return marketResults.some((result) => result.status === "success" || result.status === "partial");
}

function buildSearchResponse(
  searchTerm: string,
  queryPlan: SearchQueryPlan,
  costs: CostSettings,
  providerMode: ProviderMode,
  providerResults: Awaited<ReturnType<typeof runMarketDataSource>>[],
  debugCacheHit: boolean,
  totalDurationMs: number,
): SearchResponse {
  const marketResults = buildMarketSnapshots(providerResults);
  const listings = sortListings(
    dedupeListings(
      enrichListingsWithKrw(
        providerResults.flatMap((result) => result.normalized.listings),
        costs,
      ),
    ),
  );
  const marketAnalyses = marketDataSources.map((source) =>
    calculateMarketAnalysis(
      source.id,
      listings.filter((listing) => listing.sourceMarket === source.id),
    ),
  );
  const profitProjection = calculateProfitProjection(marketAnalyses, costs);
  const groups = buildComparableGroups(listings, queryPlan.presetId);
  const recommendation = calculateRecommendation(
    listings,
    marketAnalyses,
    profitProjection,
    groups,
    queryPlan.presetId,
  );
  const recommendedListings = pickRecommendedListings(listings, profitProjection, queryPlan.presetId);
  const dashboard = buildDashboardSummary(
    marketAnalyses,
    recommendation.recommendationScore,
    recommendation.recommendationGrade,
    profitProjection,
  );

  return {
    searchTerm,
    generatedAt: new Date().toISOString(),
    costs,
    providerMode,
    queryPlan,
    alternativeQueries: queryPlan.alternativeSuggestions,
    marketResults,
    hasPartialFailures: hasPartialFailures(marketResults),
    hasAnySuccessfulMarket: hasAnySuccessfulMarket(marketResults),
    listings,
    recommendedListings,
    groups,
    marketAnalyses,
    profitProjection,
    recommendation,
    dashboard,
    debug: {
      cacheHit: debugCacheHit,
      totalDurationMs,
      queryPlan,
      providerDebug: marketResults.flatMap((result) => (result.debug ? [result.debug] : [])),
    },
  };
}

export async function searchResellOpportunities(
  searchTerm: string,
  costs: CostSettings,
  options: SearchServiceOptions = {},
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const providerMode = resolveProviderMode(options.mode ?? getConfiguredProviderMode());
  const sanitizedSearchTerm = sanitizeSearchTerm(searchTerm.trim());
  const queryPlan = preprocessSearchQuery(sanitizedSearchTerm, {
    presetId: options.preset,
  });
  const limit = options.limit ?? 24;
  const preset = getSearchCategoryPreset(queryPlan.presetId);
  const minRelevanceScore =
    options.minRelevanceScore ?? Math.max(DEFAULT_MIN_RELEVANCE, preset.id === "camera" ? 0.38 : preset.id === "vintage_furniture" ? 0.35 : DEFAULT_MIN_RELEVANCE);
  const cacheKey = buildSearchCacheKey(
    queryPlan,
    costs,
    providerMode,
    limit,
    minRelevanceScore,
  );
  const cachedResponse = getCachedSearchResponse(cacheKey);

  if (cachedResponse) {
    return {
      ...cachedResponse,
      generatedAt: new Date().toISOString(),
      debug: cachedResponse.debug
        ? {
            ...cachedResponse.debug,
            cacheHit: true,
            totalDurationMs: Date.now() - startedAt,
          }
        : cachedResponse.debug,
    };
  }

  const providerResults = await Promise.all(
    marketDataSources.map((source) =>
      runMarketDataSource(source, {
        query: queryPlan.normalized || sanitizedSearchTerm,
        queryPlan,
        limit,
        minRelevanceScore,
        timeoutMs: options.timeoutMs,
        mode: providerMode,
      }),
    ),
  );

  const response = buildSearchResponse(
    sanitizedSearchTerm,
    queryPlan,
    costs,
    providerMode,
    providerResults,
    false,
    Date.now() - startedAt,
  );

  setCachedSearchResponse(cacheKey, response);
  return response;
}

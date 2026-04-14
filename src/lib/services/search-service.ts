import { DEFAULT_MIN_RELEVANCE } from "@/lib/constants";
import { getConfiguredProviderMode, resolveProviderMode } from "@/lib/config/provider-mode";
import { runMarketDataSource } from "@/lib/providers/base";
import { marketDataSources } from "@/lib/providers";
import { stripMockScenarioTokens } from "@/lib/providers/mock/scenario";
import {
  ComparableGroup,
  CostSettings,
  DashboardSummary,
  MarketAnalysis,
  MarketListing,
  MarketProviderResultSnapshot,
  ProviderMode,
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

interface SearchServiceOptions {
  mode?: ProviderMode | string | null;
  limit?: number;
  minRelevanceScore?: number;
  timeoutMs?: number;
}

function sanitizeSearchTerm(searchTerm: string): string {
  const stripped = stripMockScenarioTokens(searchTerm);
  return stripped || searchTerm.trim();
}

function buildGroupNormalizedName(
  bucket: MarketListing[],
  seed: MarketListing,
): string {
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

function resolveGroupingThreshold(left: MarketListing, right: MarketListing): number {
  const sameBrand =
    left.brand !== "Unknown" &&
    right.brand !== "Unknown" &&
    normalizeText(left.brand) === normalizeText(right.brand);
  const sameCategory =
    left.category !== "uncategorized" &&
    right.category !== "uncategorized" &&
    normalizeText(left.category) === normalizeText(right.category);

  if (sameBrand && sameCategory) {
    return 0.56;
  }

  if (sameBrand) {
    return 0.6;
  }

  return 0.64;
}

function buildComparableGroups(listings: MarketListing[]): ComparableGroup[] {
  const grouped: Array<{ seed: MarketListing; listings: MarketListing[] }> = [];
  const sortedListings = [...listings].sort((left, right) => {
    if (right.relevanceScore !== left.relevanceScore) {
      return right.relevanceScore - left.relevanceScore;
    }

    if (left.listingType !== right.listingType) {
      return left.listingType === "sold" ? -1 : 1;
    }

    return (right.soldAt ?? right.listedAt).localeCompare(left.soldAt ?? left.listedAt);
  });

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
        ...sampleListings.map((candidate) => computeListingSimilarity(listing, candidate)),
      );
      const threshold = Math.min(
        ...sampleListings.map((candidate) => resolveGroupingThreshold(listing, candidate)),
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
        listings: bucket.sort((left, right) => {
          if (right.relevanceScore !== left.relevanceScore) {
            return right.relevanceScore - left.relevanceScore;
          }

          return (right.soldAt ?? right.listedAt).localeCompare(left.soldAt ?? left.listedAt);
        }),
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

    return {
      ...result.summary,
      fetchedAt: result.collector.fetchedAt,
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
    ["partial", "timeout", "parsing_failure", "error"].includes(result.status),
  );
}

function hasAnySuccessfulMarket(marketResults: MarketProviderResultSnapshot[]): boolean {
  return marketResults.some((result) => result.status === "success" || result.status === "partial");
}

export async function searchResellOpportunities(
  searchTerm: string,
  costs: CostSettings,
  options: SearchServiceOptions = {},
): Promise<SearchResponse> {
  const providerMode = resolveProviderMode(options.mode ?? getConfiguredProviderMode());
  const sanitizedSearchTerm = sanitizeSearchTerm(searchTerm.trim());

  const providerResults = await Promise.all(
    marketDataSources.map((source) =>
      runMarketDataSource(source, {
        query: sanitizedSearchTerm,
        limit: options.limit ?? 24,
        minRelevanceScore: options.minRelevanceScore ?? DEFAULT_MIN_RELEVANCE,
        timeoutMs: options.timeoutMs,
        mode: providerMode,
      }),
    ),
  );

  const marketResults = buildMarketSnapshots(providerResults);
  const listings = enrichListingsWithKrw(
    providerResults
      .flatMap((result) => result.normalized.listings)
      .sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }

        return (right.soldAt ?? right.listedAt).localeCompare(left.soldAt ?? left.listedAt);
      }),
    costs,
  );

  const marketAnalyses = marketDataSources.map((source) =>
    calculateMarketAnalysis(
      source.id,
      listings.filter((listing) => listing.sourceMarket === source.id),
    ),
  );
  const profitProjection = calculateProfitProjection(marketAnalyses, costs);
  const groups = buildComparableGroups(listings);
  const recommendation = calculateRecommendation(
    listings,
    marketAnalyses,
    profitProjection,
    groups,
  );
  const recommendedListings = pickRecommendedListings(listings, profitProjection);
  const dashboard = buildDashboardSummary(
    marketAnalyses,
    recommendation.recommendationScore,
    recommendation.recommendationGrade,
    profitProjection,
  );

  return {
    searchTerm: sanitizedSearchTerm,
    generatedAt: new Date().toISOString(),
    costs,
    providerMode,
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
  };
}

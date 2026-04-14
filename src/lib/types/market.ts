export type MarketId = "mercari" | "bunjang" | "fruitsfamily";
export type ListingType = "active" | "sold";
export type CurrencyCode = "JPY" | "KRW";
export type TrendDirection = "up" | "flat" | "down";
export type RecommendationGrade = "S" | "A" | "B" | "C";
export type ProviderMode = "mock" | "real";
export type ProviderExecutionStatus =
  | "success"
  | "empty"
  | "partial"
  | "timeout"
  | "parsing_failure"
  | "error";
export type ProviderErrorType =
  | "timeout"
  | "empty_result"
  | "partial_result"
  | "parsing_failure"
  | "network_error"
  | "not_configured"
  | "unknown";
export type ResultTab =
  | "recommended"
  | "all"
  | "active"
  | "sold"
  | MarketId;

export interface CostSettings {
  exchangeRate: number;
  japanDomesticShipping: number;
  internationalShipping: number;
  extraCosts: number;
  platformFeeRate: number;
  targetMarginRate: number;
}

export interface MarketListing {
  id: string;
  searchTerm: string;
  sourceMarket: MarketId;
  listingType: ListingType;
  title: string;
  price: number;
  currency: CurrencyCode;
  imageUrl: string;
  itemUrl: string;
  listedAt: string;
  soldAt?: string;
  size?: string;
  brand: string;
  model: string;
  season?: string;
  category: string;
  relevanceScore: number;
  normalizedName: string;
  relatedKeywords: string[];
  dateConfidence?: "observed" | "fallback";
  priceKrw?: number;
}

export type MockMarketListing = Omit<
  MarketListing,
  "searchTerm" | "relevanceScore" | "priceKrw"
>;

export interface ProviderErrorInfo {
  type: ProviderErrorType;
  message: string;
  retryable: boolean;
  details?: string;
}

export interface RawCollectorEnvelope<
  TRawItem = unknown,
  TMeta extends Record<string, unknown> = Record<string, never>,
> {
  market: MarketId;
  label: string;
  mode: ProviderMode;
  query: string;
  status: ProviderExecutionStatus;
  fetchedAt: string;
  durationMs: number;
  rawItems: TRawItem[];
  meta: TMeta;
  warnings: string[];
  error?: ProviderErrorInfo;
}

export interface NormalizationStats {
  receivedCount: number;
  normalizedCount: number;
  skippedCount: number;
  activeCount: number;
  soldCount: number;
}

export interface NormalizationEnvelope {
  market: MarketId;
  label: string;
  query: string;
  status: ProviderExecutionStatus;
  listings: MarketListing[];
  stats: NormalizationStats;
  warnings: string[];
  error?: ProviderErrorInfo;
}

export interface MarketCollectionSummary {
  sourceMarket: MarketId;
  label: string;
  mode: ProviderMode;
  status: ProviderExecutionStatus;
  rawItemCount: number;
  normalizedItemCount: number;
  skippedItemCount: number;
  activeListingCount: number;
  soldListingCount: number;
  durationMs: number;
  warnings: string[];
  error?: ProviderErrorInfo;
}

export interface MarketProviderResultSnapshot extends MarketCollectionSummary {
  fetchedAt: string;
  isSuccess: boolean;
  isPartial: boolean;
  isEmpty: boolean;
}

export interface MarketAnalysis {
  sourceMarket: MarketId;
  marketAveragePrice: number;
  marketMedianPrice: number;
  nativeAveragePrice: number;
  nativeMedianPrice: number;
  activeListingCount: number;
  soldListingCount: number;
  estimatedVolume7d: number;
  estimatedVolume14d: number;
  estimatedVolume30d: number;
  activeAveragePrice: number;
  soldAveragePrice: number;
  lowestPrice: number;
  highestPrice: number;
  trendDirection: TrendDirection;
  trendPercentage: number;
  liquidityScore: number;
}

export interface ProfitProjection {
  currentJapanAveragePrice: number;
  currentJapanAveragePriceJpy: number;
  recommendedBuyPrice: number;
  recommendedBuyPriceJpy: number;
  recommendedSellPrice: number;
  totalAdditionalCosts: number;
  netSellProceeds: number;
  expectedNetProfit: number;
  expectedMarginRate: number;
  bestResaleMarket: MarketId;
}

export interface RecommendationResult {
  recommendationScore: number;
  recommendationGrade: RecommendationGrade;
  recommendationReasons: string[];
  blockerReasons: string[];
  suggestedAdjustments: string[];
  bestMarketReasons: string[];
  bestResaleMarket: MarketId;
}

export interface RecommendedListing extends MarketListing {
  estimatedProfit: number;
  estimatedMarginRate: number;
  targetResaleMarket: MarketId;
  dealScore: number;
  isUnderRecommendedBuyPrice: boolean;
}

export interface ComparableGroup {
  id: string;
  normalizedName: string;
  label: string;
  averagePriceKrw: number;
  marketSpread: number;
  listingCount: number;
  soldCount: number;
  activeCount: number;
  listings: MarketListing[];
}

export interface DashboardSummary {
  japanAveragePrice: number;
  japanAveragePriceJpy: number;
  koreaAveragePrice: number;
  marketAveragePrices: Record<MarketId, number>;
  estimatedVolume7d: number;
  estimatedVolume14d: number;
  estimatedVolume30d: number;
  expectedNetProfit: number;
  expectedMarginRate: number;
  recommendedBuyPrice: number;
  recommendedBuyPriceJpy: number;
  recommendedSellPrice: number;
  recommendedSellMarket: MarketId;
  marketActivityScore: number;
  recommendationScore: number;
  recommendationGrade: RecommendationGrade;
}

export interface SearchResponse {
  searchTerm: string;
  generatedAt: string;
  costs: CostSettings;
  providerMode: ProviderMode;
  marketResults: MarketProviderResultSnapshot[];
  hasPartialFailures: boolean;
  hasAnySuccessfulMarket: boolean;
  listings: MarketListing[];
  recommendedListings: RecommendedListing[];
  groups: ComparableGroup[];
  marketAnalyses: MarketAnalysis[];
  profitProjection: ProfitProjection;
  recommendation: RecommendationResult;
  dashboard: DashboardSummary;
}

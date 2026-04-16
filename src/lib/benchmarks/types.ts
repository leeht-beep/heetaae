import type {
  CategoryPresetId,
  CategoryPresetSource,
  MarketId,
  ProviderExecutionStatus,
  ProviderMode,
  SearchQueryAliasMatch,
  SearchQueryVariant,
} from "@/lib/types/market";

export type BenchmarkTag =
  | "core"
  | "fashion"
  | "camera"
  | "furniture"
  | "brand-only"
  | "brand-model"
  | "mixed-lang"
  | "japanese"
  | "korean"
  | "english"
  | "abbrev"
  | "typo"
  | "exploratory";

export interface BenchmarkProviderExpectation {
  allowedStatuses?: ProviderExecutionStatus[];
  minNormalizedCount?: number;
  minTopRelevance?: number;
  minTopConfidence?: number;
}

export interface SearchBenchmarkCase {
  id: string;
  label: string;
  query: string;
  tags: BenchmarkTag[];
  notes?: string;
  recommendedPreset?: CategoryPresetId;
  assertions?: Partial<Record<MarketId, BenchmarkProviderExpectation>>;
  minProvidersWithResults?: number;
}

export interface BenchmarkProviderAttemptSummary {
  variantKey: string;
  variantLabel: string;
  strategy: SearchQueryVariant["strategy"] | "unknown";
  query: string;
  status: ProviderExecutionStatus;
  rawResultCount: number;
  normalizedResultCount: number;
  filteredOutCount: number;
  confidenceScore: number;
  usedFallback: boolean;
}

export interface BenchmarkProviderQueryResult {
  market: MarketId;
  status: ProviderExecutionStatus;
  confidenceScore: number;
  rawCount: number;
  normalizedCount: number;
  filteredCount: number;
  topRelevance: number;
  topConfidence: number;
  fallbackUsed: boolean;
  bestVariantKey?: string;
  bestVariantLabel?: string;
  bestVariantStrategy?: SearchQueryVariant["strategy"] | "unknown";
  attempts: BenchmarkProviderAttemptSummary[];
  issues: string[];
}

export interface BenchmarkPresetVariantResult {
  selectedPreset: CategoryPresetId | "auto";
  appliedPresetId: CategoryPresetId;
  appliedPresetSource: CategoryPresetSource;
  normalizedResultTotal: number;
  providersWithResults: number;
  averageTopRelevance: number;
  averageTopConfidence: number;
  recommendationScore: number;
  recommendationGrade: string;
  bestMarket: MarketId;
}

export interface BenchmarkPresetComparison {
  recommendedPreset?: CategoryPresetId;
  bestPreset: CategoryPresetId | "auto";
  notes: string[];
  variants: BenchmarkPresetVariantResult[];
}

export interface BenchmarkQueryReport {
  id: string;
  label: string;
  query: string;
  tags: BenchmarkTag[];
  recommendedPreset?: CategoryPresetId;
  appliedPresetId: CategoryPresetId;
  appliedPresetSource: CategoryPresetSource;
  normalizedQuery: string;
  aliasMatches: SearchQueryAliasMatch[];
  alternativeQueries: string[];
  providers: Record<MarketId, BenchmarkProviderQueryResult>;
  issues: string[];
  overallConfidence: number;
  presetComparison?: BenchmarkPresetComparison;
}

export interface BenchmarkProviderAggregate {
  market: MarketId;
  successRate: number;
  usefulRate: number;
  blockedRate: number;
  fallbackRate: number;
  averageRawCount: number;
  averageNormalizedCount: number;
  averageFilteredCount: number;
  averageTopRelevance: number;
  averageTopConfidence: number;
  lowConfidenceQueryIds: string[];
  weakQueryIds: string[];
  variantLeaderboard: Array<{
    variantKey: string;
    variantLabel: string;
    strategy: SearchQueryVariant["strategy"] | "unknown";
    usageCount: number;
    usefulCount: number;
    averageNormalizedCount: number;
    averageConfidence: number;
  }>;
}

export interface BenchmarkRegressionReport {
  regressions: string[];
  warnings: string[];
}

export interface SearchBenchmarkReport {
  generatedAt: string;
  mode: ProviderMode;
  selectedPreset: CategoryPresetId | "auto";
  comparePresets: boolean;
  selectedQueryIds: string[];
  selectedTags: string[];
  queryCount: number;
  providerSummary: Record<MarketId, BenchmarkProviderAggregate>;
  queryReports: BenchmarkQueryReport[];
  tuningPriorities: string[];
  regression: BenchmarkRegressionReport;
}


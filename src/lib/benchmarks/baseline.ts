import { MarketId } from "@/lib/types/market";

export interface ProviderRegressionBaseline {
  minUsefulRate: number;
  minAverageTopRelevance: number;
  minAverageTopConfidence: number;
  maxBlockedRate: number;
}

export interface QueryRegressionBaseline {
  minProvidersWithResults: number;
}

export const PROVIDER_REGRESSION_BASELINE: Record<MarketId, ProviderRegressionBaseline> = {
  mercari: {
    minUsefulRate: 0.35,
    minAverageTopRelevance: 0.42,
    minAverageTopConfidence: 0.46,
    maxBlockedRate: 0.65,
  },
  bunjang: {
    minUsefulRate: 0.4,
    minAverageTopRelevance: 0.44,
    minAverageTopConfidence: 0.5,
    maxBlockedRate: 0.35,
  },
  fruitsfamily: {
    minUsefulRate: 0.28,
    minAverageTopRelevance: 0.4,
    minAverageTopConfidence: 0.45,
    maxBlockedRate: 0.45,
  },
};

export const CORE_QUERY_REGRESSION_BASELINE: Record<string, QueryRegressionBaseline> = {
  "supreme-brand-en": { minProvidersWithResults: 2 },
  "supreme-box-logo-en": { minProvidersWithResults: 2 },
  "supreme-box-logo-ko": { minProvidersWithResults: 2 },
  "supreme-box-logo-ja": { minProvidersWithResults: 2 },
  "patagonia-retro-x-en": { minProvidersWithResults: 2 },
  "patagonia-retro-x-ko": { minProvidersWithResults: 2 },
  "arcteryx-beta-lt-en": { minProvidersWithResults: 2 },
  "arcteryx-beta-lt-abbrev": { minProvidersWithResults: 1 },
  "new-balance-992-ko": { minProvidersWithResults: 2 },
  "auralee-super-light-en": { minProvidersWithResults: 1 },
  "auralee-super-light-ja": { minProvidersWithResults: 1 },
  "comoli-tie-locken-ko": { minProvidersWithResults: 1 },
  "porter-classic-newton-ja": { minProvidersWithResults: 1 },
};

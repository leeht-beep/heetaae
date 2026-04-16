import type {
  CategoryPresetId,
  CategoryPresetSource,
  QueryVariantStrategy,
  SearchQueryAliasMatch,
} from "@/lib/types/market";

type PresetAttribute = "size" | "color" | "year" | "season" | "serial";

export interface CategoryPresetRelevanceWeights {
  tokenRecall: number;
  tokenJaccard: number;
  phraseMatch: number;
  exactNormalizedName: number;
  brandMatch: number;
  modelMatch: number;
  categoryMatch: number;
  keywordMatch: number;
  brandMissingPenalty: number;
  numericMismatchPenalty: number;
  noisePenalty: number;
}

export interface CategoryPresetSimilarityConfig {
  baseThreshold: number;
  sameBrandThreshold: number;
  sameBrandCategoryThreshold: number;
  brandWeight: number;
  modelWeight: number;
  categoryWeight: number;
  titleWeight: number;
  sizeWeight: number;
  colorWeight: number;
  seasonWeight: number;
  brandMismatchPenalty: number;
  categoryMismatchPenalty: number;
  numericMismatchPenalty: number;
  sizeMismatchPenalty: number;
  noisePenalty: number;
}

export interface CategoryPresetNormalizationRules {
  extraNoiseKeywords: string[];
  importantAttributes: PresetAttribute[];
  preserveNumericModelTokens: boolean;
  rejectKeywordPatterns: RegExp[];
}

export interface CategoryPresetRecommendationConfig {
  weights: {
    priceGap: number;
    demand: number;
    inventory: number;
    velocity: number;
    platformFit: number;
    profitability: number;
    matchQuality: number;
    liquidity: number;
    margin: number;
  };
  uncertaintyPenaltyMultiplier: number;
  minExpectedProfit: number;
  minMarginRate: number;
  highInventoryPressure: number;
  slowSellingDays: number;
  lowComparableCoverage: number;
}

export interface SearchCategoryPreset {
  id: CategoryPresetId;
  label: string;
  description: string;
  detectionKeywords: string[];
  detectionAliasKeys: string[];
  noiseKeywords: string[];
  preferredAliases: {
    brand: string[];
    model: string[];
    category: string[];
  };
  preferredQueryVariantStrategies: QueryVariantStrategy[];
  relevanceWeights: CategoryPresetRelevanceWeights;
  similarity: CategoryPresetSimilarityConfig;
  normalizationRules: CategoryPresetNormalizationRules;
  recommendation: CategoryPresetRecommendationConfig;
}

const COMMON_RELEVANCE: CategoryPresetRelevanceWeights = {
  tokenRecall: 0.32,
  tokenJaccard: 0.12,
  phraseMatch: 0.14,
  exactNormalizedName: 0.08,
  brandMatch: 0.14,
  modelMatch: 0.13,
  categoryMatch: 0.04,
  keywordMatch: 0.03,
  brandMissingPenalty: 0.08,
  numericMismatchPenalty: 0.18,
  noisePenalty: 0.2,
};

export const SEARCH_CATEGORY_PRESETS: Record<CategoryPresetId, SearchCategoryPreset> = {
  fashion: {
    id: "fashion",
    label: "패션",
    description: "브랜드/모델/사이즈/시즌이 중요한 의류 및 잡화 검색용 preset",
    detectionKeywords: [
      "hoodie",
      "shirt",
      "jacket",
      "fleece",
      "sneakers",
      "bag",
      "후드",
      "자켓",
      "셔츠",
      "스니커즈",
      "가방",
      "パーカー",
      "ジャケット",
      "スニーカー",
    ],
    detectionAliasKeys: [
      "supreme",
      "patagonia",
      "arcteryx",
      "new-balance",
      "the-north-face",
      "stussy",
      "auralee",
      "comoli",
      "porter-classic",
      "porter",
      "box-logo-hoodie",
      "retro-x",
      "beta-lt",
      "992",
      "super-light-wool-shirt",
      "tie-locken-coat",
      "newton-daypack",
      "hoodie",
      "jacket",
      "shirt",
      "sneakers",
      "bag",
    ],
    noiseKeywords: [
      "구매글",
      "삽니다",
      "교환",
      "교신",
      "정품문의",
      "예약중",
      "wanted",
      "trade",
    ],
    preferredAliases: {
      brand: ["supreme", "patagonia", "arcteryx", "new-balance", "auralee", "comoli"],
      model: ["box-logo-hoodie", "retro-x", "beta-lt", "992"],
      category: ["hoodie", "jacket", "shirt", "sneakers", "bag"],
    },
    preferredQueryVariantStrategies: [
      "brand_model",
      "localized_brand_model",
      "brand_category",
      "core_tokens",
      "brand_alias",
      "brand_only",
      "model_only",
      "category_alias",
      "model_alias",
      "original",
    ],
    relevanceWeights: {
      ...COMMON_RELEVANCE,
      categoryMatch: 0.06,
      keywordMatch: 0.04,
      numericMismatchPenalty: 0.12,
      noisePenalty: 0.24,
    },
    similarity: {
      baseThreshold: 0.64,
      sameBrandThreshold: 0.6,
      sameBrandCategoryThreshold: 0.56,
      brandWeight: 0.26,
      modelWeight: 0.3,
      categoryWeight: 0.12,
      titleWeight: 0.2,
      sizeWeight: 0.05,
      colorWeight: 0.03,
      seasonWeight: 0.04,
      brandMismatchPenalty: 0.28,
      categoryMismatchPenalty: 0.12,
      numericMismatchPenalty: 0.08,
      sizeMismatchPenalty: 0.06,
      noisePenalty: 0.08,
    },
    normalizationRules: {
      extraNoiseKeywords: ["착샷", "실착", "네고", "교신", "삽니다"],
      importantAttributes: ["size", "color", "season"],
      preserveNumericModelTokens: false,
      rejectKeywordPatterns: [/리셀 의뢰/iu],
    },
    recommendation: {
      weights: {
        priceGap: 0.2,
        demand: 0.16,
        inventory: 0.11,
        velocity: 0.1,
        platformFit: 0.12,
        profitability: 0.17,
        matchQuality: 0.08,
        liquidity: 0.06,
        margin: 0.1,
      },
      uncertaintyPenaltyMultiplier: 1,
      minExpectedProfit: 50000,
      minMarginRate: 0.12,
      highInventoryPressure: 2.2,
      slowSellingDays: 30,
      lowComparableCoverage: 0.45,
    },
  },
  camera: {
    id: "camera",
    label: "카메라",
    description: "모델 세대와 숫자 토큰 일치가 중요한 카메라/렌즈 검색용 preset",
    detectionKeywords: [
      "camera",
      "lens",
      "body",
      "카메라",
      "렌즈",
      "바디",
      "カメラ",
      "レンズ",
      "ボディ",
    ],
    detectionAliasKeys: ["sony", "leica", "m6", "a7c-ii", "camera"],
    noiseKeywords: ["고장", "부품용", "정품등록", "박스만", "렌즈별도", "junk"],
    preferredAliases: {
      brand: ["sony", "leica"],
      model: ["m6", "a7c-ii"],
      category: ["camera"],
    },
    preferredQueryVariantStrategies: [
      "brand_model",
      "localized_brand_model",
      "model_only",
      "brand_alias",
      "model_alias",
      "brand_only",
      "core_tokens",
      "original",
      "brand_category",
      "category_alias",
    ],
    relevanceWeights: {
      ...COMMON_RELEVANCE,
      modelMatch: 0.19,
      categoryMatch: 0.05,
      brandMissingPenalty: 0.1,
      numericMismatchPenalty: 0.28,
      noisePenalty: 0.28,
    },
    similarity: {
      baseThreshold: 0.69,
      sameBrandThreshold: 0.66,
      sameBrandCategoryThreshold: 0.63,
      brandWeight: 0.24,
      modelWeight: 0.38,
      categoryWeight: 0.11,
      titleWeight: 0.18,
      sizeWeight: 0,
      colorWeight: 0,
      seasonWeight: 0.02,
      brandMismatchPenalty: 0.3,
      categoryMismatchPenalty: 0.14,
      numericMismatchPenalty: 0.2,
      sizeMismatchPenalty: 0,
      noisePenalty: 0.06,
    },
    normalizationRules: {
      extraNoiseKeywords: ["박스만", "부품용", "고장", "렌즈별도", "컷수문의"],
      importantAttributes: ["year", "serial"],
      preserveNumericModelTokens: true,
      rejectKeywordPatterns: [/부품용/iu, /고장/iu],
    },
    recommendation: {
      weights: {
        priceGap: 0.18,
        demand: 0.12,
        inventory: 0.09,
        velocity: 0.08,
        platformFit: 0.11,
        profitability: 0.2,
        matchQuality: 0.14,
        liquidity: 0.03,
        margin: 0.05,
      },
      uncertaintyPenaltyMultiplier: 1.25,
      minExpectedProfit: 90000,
      minMarginRate: 0.1,
      highInventoryPressure: 1.9,
      slowSellingDays: 35,
      lowComparableCoverage: 0.5,
    },
  },
  vintage_furniture: {
    id: "vintage_furniture",
    label: "빈티지 가구",
    description: "브랜드/라인과 배송비, 회전 속도를 보수적으로 보는 빈티지 가구 preset",
    detectionKeywords: [
      "chair",
      "table",
      "sofa",
      "furniture",
      "의자",
      "테이블",
      "소파",
      "チェア",
      "テーブル",
      "家具",
    ],
    detectionAliasKeys: ["herman-miller", "karimoku60", "aeron-chair", "k-chair", "chair"],
    noiseKeywords: ["직거래만", "용달", "배송비별도", "리프로덕션", "복각", "pickup only"],
    preferredAliases: {
      brand: ["herman-miller", "karimoku60"],
      model: ["aeron-chair", "k-chair"],
      category: ["chair"],
    },
    preferredQueryVariantStrategies: [
      "brand_model",
      "brand_category",
      "localized_brand_model",
      "brand_alias",
      "brand_only",
      "core_tokens",
      "model_only",
      "category_alias",
      "model_alias",
      "original",
    ],
    relevanceWeights: {
      ...COMMON_RELEVANCE,
      tokenRecall: 0.29,
      tokenJaccard: 0.1,
      categoryMatch: 0.08,
      keywordMatch: 0.05,
      numericMismatchPenalty: 0.1,
      noisePenalty: 0.22,
    },
    similarity: {
      baseThreshold: 0.67,
      sameBrandThreshold: 0.63,
      sameBrandCategoryThreshold: 0.6,
      brandWeight: 0.28,
      modelWeight: 0.26,
      categoryWeight: 0.18,
      titleWeight: 0.18,
      sizeWeight: 0,
      colorWeight: 0.02,
      seasonWeight: 0,
      brandMismatchPenalty: 0.24,
      categoryMismatchPenalty: 0.18,
      numericMismatchPenalty: 0.08,
      sizeMismatchPenalty: 0,
      noisePenalty: 0.08,
    },
    normalizationRules: {
      extraNoiseKeywords: ["직거래", "용달", "배송비별도", "리프로덕션", "복각"],
      importantAttributes: ["year", "serial"],
      preserveNumericModelTokens: true,
      rejectKeywordPatterns: [/리프로덕션/iu, /복각/iu],
    },
    recommendation: {
      weights: {
        priceGap: 0.16,
        demand: 0.1,
        inventory: 0.09,
        velocity: 0.06,
        platformFit: 0.1,
        profitability: 0.24,
        matchQuality: 0.12,
        liquidity: 0.03,
        margin: 0.1,
      },
      uncertaintyPenaltyMultiplier: 1.15,
      minExpectedProfit: 140000,
      minMarginRate: 0.18,
      highInventoryPressure: 1.6,
      slowSellingDays: 50,
      lowComparableCoverage: 0.52,
    },
  },
};

export const DEFAULT_CATEGORY_PRESET_ID: CategoryPresetId = "fashion";

export function getSearchCategoryPreset(
  presetId?: CategoryPresetId | string | null,
): SearchCategoryPreset {
  if (presetId && presetId in SEARCH_CATEGORY_PRESETS) {
    return SEARCH_CATEGORY_PRESETS[presetId as CategoryPresetId];
  }

  return SEARCH_CATEGORY_PRESETS[DEFAULT_CATEGORY_PRESET_ID];
}

export function listSearchCategoryPresets(): SearchCategoryPreset[] {
  return Object.values(SEARCH_CATEGORY_PRESETS);
}

export function resolveCategoryPreset(
  normalizedQuery: string,
  tokens: string[],
  aliasMatches: SearchQueryAliasMatch[],
  explicitPresetId?: CategoryPresetId | string | null,
): { preset: SearchCategoryPreset; source: CategoryPresetSource } {
  if (explicitPresetId && explicitPresetId in SEARCH_CATEGORY_PRESETS) {
    return {
      preset: SEARCH_CATEGORY_PRESETS[explicitPresetId as CategoryPresetId],
      source: "user",
    };
  }

  const normalized = normalizedQuery.normalize("NFKC").toLowerCase();
  const bestMatch = Object.values(SEARCH_CATEGORY_PRESETS)
    .map((preset) => {
      const keywordScore = preset.detectionKeywords.reduce(
        (sum, keyword) => sum + (normalized.includes(keyword.normalize("NFKC").toLowerCase()) ? 1 : 0),
        0,
      );
      const aliasScore = aliasMatches.reduce(
        (sum, match) => sum + (preset.detectionAliasKeys.includes(match.key) ? 2 : 0),
        0,
      );
      const tokenScore = tokens.reduce(
        (sum, token) =>
          sum +
          (preset.detectionKeywords.some(
            (keyword) => keyword.normalize("NFKC").toLowerCase() === token,
          )
            ? 1
            : 0),
        0,
      );

      return {
        preset,
        score: keywordScore + aliasScore + tokenScore,
      };
    })
    .sort((left, right) => right.score - left.score)[0];

  if (bestMatch && bestMatch.score > 0) {
    return {
      preset: bestMatch.preset,
      source: "query",
    };
  }

  return {
    preset: SEARCH_CATEGORY_PRESETS[DEFAULT_CATEGORY_PRESET_ID],
    source: "default",
  };
}

export function getPresetStrategyRank(
  presetId: CategoryPresetId,
  strategy: QueryVariantStrategy,
): number {
  const preset = getSearchCategoryPreset(presetId);
  const rank = preset.preferredQueryVariantStrategies.indexOf(strategy);
  return rank === -1 ? preset.preferredQueryVariantStrategies.length + 1 : rank;
}

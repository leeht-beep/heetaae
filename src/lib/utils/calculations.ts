import { MARKET_LABELS } from "@/lib/constants";
import { getSearchCategoryPreset } from "@/lib/search/presets";
import {
  CategoryPresetId,
  ComparableGroup,
  CostSettings,
  MarketAnalysis,
  MarketId,
  MarketListing,
  ProfitProjection,
  RecommendationGrade,
  RecommendationResult,
  RecommendedListing,
} from "@/lib/types/market";

const DAY_MS = 24 * 60 * 60 * 1000;

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }

  return sorted[midpoint];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isWithinDays(value: string | undefined, days: number): boolean {
  if (!value) {
    return false;
  }

  return Date.now() - new Date(value).getTime() <= days * DAY_MS;
}

function hasObservedTimestamp(listing: MarketListing): boolean {
  return listing.dateConfidence !== "fallback";
}

function getPriceKrw(listing: MarketListing, exchangeRate: number): number {
  return listing.currency === "JPY" ? Math.round(listing.price * exchangeRate) : listing.price;
}

function getDurationDays(listing: MarketListing): number | null {
  if (!listing.listedAt || !listing.soldAt) {
    return null;
  }

  const listedAt = new Date(listing.listedAt).getTime();
  const soldAt = new Date(listing.soldAt).getTime();

  if (Number.isNaN(listedAt) || Number.isNaN(soldAt) || soldAt <= listedAt) {
    return null;
  }

  return Math.round((soldAt - listedAt) / DAY_MS);
}

function estimateAverageSellingDays(listings: MarketListing[]): number | null {
  const durations = listings
    .map(getDurationDays)
    .filter((value): value is number => value !== null && value > 0 && value <= 365);

  if (durations.length === 0) {
    return null;
  }

  return Math.round(median(durations));
}

function calculateObservedDateRate(listings: MarketListing[]): number {
  if (listings.length === 0) {
    return 0;
  }

  return listings.filter(hasObservedTimestamp).length / listings.length;
}

function calculateSpreadRate(analyses: MarketAnalysis[]): number {
  const spreadRates = analyses
    .filter((analysis) => analysis.marketAveragePrice > 0)
    .map((analysis) => (analysis.highestPrice - analysis.lowestPrice) / analysis.marketAveragePrice)
    .filter(Number.isFinite);

  return average(spreadRates);
}

function calculateComparableCoverage(
  groups: ComparableGroup[],
  totalListings: number,
): number {
  if (groups.length === 0 || totalListings === 0) {
    return 0;
  }

  const crossMarketListings = groups
    .filter((group) => new Set(group.listings.map((listing) => listing.sourceMarket)).size >= 2)
    .reduce((sum, group) => sum + group.listingCount, 0);

  return crossMarketListings / totalListings;
}

function calculateFieldCompletenessRate(listings: MarketListing[]): number {
  if (listings.length === 0) {
    return 0;
  }

  return average(listings.map((listing) => listing.fieldCompleteness ?? 0));
}

function calculateConfidenceRate(listings: MarketListing[]): number {
  if (listings.length === 0) {
    return 0;
  }

  return average(listings.map((listing) => listing.confidenceScore));
}

function countDistinctValues(values: Array<string | undefined>): number {
  return new Set(
    values
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  ).size;
}

function calculateNumericModelDiversity(listings: MarketListing[]): number {
  const numericTokens = listings.flatMap((listing) =>
    `${listing.brand} ${listing.model} ${listing.title}`
      .match(/[a-z]*\d+[a-z\d-]*/gi)
      ?.map((value) => value.toLowerCase()) ?? [],
  );

  return countDistinctValues(numericTokens);
}

function calculateSizeDiversity(listings: MarketListing[]): number {
  return countDistinctValues(listings.map((listing) => listing.size));
}

function calculateCategoryDiversity(listings: MarketListing[]): number {
  return countDistinctValues(listings.map((listing) => listing.category));
}

function calculatePremiumRate(basePrice: number, targetPrice: number): number {
  if (basePrice <= 0) {
    return 0;
  }

  return (targetPrice - basePrice) / basePrice;
}

function calculateTargetScore(
  value: number,
  target: number,
  maxScore = 100,
): number {
  if (target <= 0) {
    return 0;
  }

  return clamp((value / target) * maxScore, 0, maxScore);
}

function calculateInverseTargetScore(
  value: number,
  threshold: number,
  floor = 10,
): number {
  if (threshold <= 0) {
    return 0;
  }

  return clamp(100 - (value / threshold) * 100, floor, 100);
}

function resolveGrade(score: number): RecommendationGrade {
  if (score >= 85) {
    return "S";
  }

  if (score >= 70) {
    return "A";
  }

  if (score >= 55) {
    return "B";
  }

  return "C";
}

function chooseBestMarket(marketAnalyses: MarketAnalysis[]): MarketAnalysis {
  const koreanMarkets = marketAnalyses.filter((analysis) => analysis.sourceMarket !== "mercari");

  return (
    [...koreanMarkets].sort((left, right) => {
      const leftScore =
        left.marketMedianPrice * 0.52 +
        left.marketAveragePrice * 0.2 +
        left.liquidityScore * 1200 +
        left.estimatedVolume30d * 1400 -
        Math.max(
          left.activeListingCount / Math.max(left.estimatedVolume30d, 1) - 1.8,
          0,
        ) *
          12000;
      const rightScore =
        right.marketMedianPrice * 0.52 +
        right.marketAveragePrice * 0.2 +
        right.liquidityScore * 1200 +
        right.estimatedVolume30d * 1400 -
        Math.max(
          right.activeListingCount / Math.max(right.estimatedVolume30d, 1) - 1.8,
          0,
        ) *
          12000;

      return rightScore - leftScore;
    })[0] ?? marketAnalyses[0]
  );
}

function addUnique(target: string[], value: string | null) {
  if (!value) {
    return;
  }

  if (!target.includes(value)) {
    target.push(value);
  }
}

function applyPresetSpecificFeedback(
  presetId: CategoryPresetId,
  context: {
    recommendationReasons: string[];
    blockerReasons: string[];
    suggestedAdjustments: string[];
    bestMarketReasons: string[];
    averageSellingDays: number | null;
    comparableCoverage: number;
    sizeDiversity: number;
    categoryDiversity: number;
    numericModelDiversity: number;
    inventoryPressure: number;
    projection: ProfitProjection;
    bestMarket: MarketAnalysis;
    fieldCompletenessRate: number;
    confidenceRate: number;
  },
) {
  switch (presetId) {
    case "camera":
      if (context.numericModelDiversity <= 2 && context.comparableCoverage >= 0.52) {
        addUnique(
          context.recommendationReasons,
          "카메라 특성상 모델 세대와 숫자 토큰이 잘 맞는 비교군이 확보되어 모델 혼입 위험이 낮습니다.",
        );
      }

      if (context.numericModelDiversity >= 4) {
        addUnique(
          context.blockerReasons,
          "비슷한 숫자 모델이 많이 섞여 있어 바디 세대, 렌즈 포함 여부, 번들 구성 혼입 가능성이 큽니다.",
        );
      }

      if (context.confidenceRate < 0.62 || context.fieldCompletenessRate < 0.7) {
        addUnique(
          context.blockerReasons,
          "셔터카운트, 박스 구성, 렌즈 포함 여부처럼 카메라 핵심 필드가 부족해 보수적으로 판단해야 합니다.",
        );
      }

      addUnique(
        context.suggestedAdjustments,
        "카메라는 정확한 모델명과 세대 표기, 바디/렌즈 포함 여부, 박스 구성 키워드를 검색어에 함께 넣어 다시 비교해보세요.",
      );
      addUnique(
        context.bestMarketReasons,
        `${MARKET_LABELS[context.bestMarket.sourceMarket]}은(는) 카메라 카테고리 기준으로 최근 거래량과 가격 프리미엄 균형이 가장 안정적입니다.`,
      );
      break;
    case "vintage_furniture":
      if (context.projection.expectedNetProfit >= 180000) {
        addUnique(
          context.recommendationReasons,
          "빈티지 가구는 배송 부담이 크지만, 현재 예상 이익이면 물류 비용을 감안해도 방어 가능한 구간입니다.",
        );
      }

      if (
        (context.averageSellingDays !== null && context.averageSellingDays > 45) ||
        context.inventoryPressure > 1.4
      ) {
        addUnique(
          context.blockerReasons,
          "빈티지 가구는 회전이 느린 편이라 직거래/운송 부담까지 감안하면 자금 회수 기간이 길어질 수 있습니다.",
        );
      }

      if (context.categoryDiversity >= 3 || context.comparableCoverage < 0.5) {
        addUnique(
          context.blockerReasons,
          "체어/테이블 등 다른 라인이 섞였을 가능성이 있어 동일 라인 비교군을 더 좁혀보는 편이 안전합니다.",
        );
      }

      addUnique(
        context.suggestedAdjustments,
        "빈티지 가구는 브랜드명 외에 라인명, 우드 타입, 사이즈, 직거래/배송 조건을 검색어와 비용 계산에 함께 반영해보세요.",
      );
      addUnique(
        context.bestMarketReasons,
        `${MARKET_LABELS[context.bestMarket.sourceMarket]}은(는) 가구 카테고리 기준으로 재고 압박이 상대적으로 낮고 가격 방어력이 낫습니다.`,
      );
      break;
    case "fashion":
    default:
      if (context.sizeDiversity <= 2 && context.comparableCoverage >= 0.5) {
        addUnique(
          context.recommendationReasons,
          "패션 상품 기준으로 사이즈·시즌 혼입이 크지 않아 동일 상품 비교 정확도가 비교적 높습니다.",
        );
      }

      if (context.sizeDiversity >= 4) {
        addUnique(
          context.blockerReasons,
          "같은 모델이라도 사이즈 스펙트럼이 넓어 실제 판매가가 크게 갈릴 수 있습니다.",
        );
      }

      addUnique(
        context.suggestedAdjustments,
        "패션 카테고리는 사이즈, 컬러, 시즌명을 검색어에 추가하면 동일 상품 매칭 정확도가 더 좋아집니다.",
      );
      addUnique(
        context.bestMarketReasons,
        `${MARKET_LABELS[context.bestMarket.sourceMarket]}은(는) 패션 카테고리 기준으로 유동성과 평균 판매가의 균형이 좋습니다.`,
      );
      break;
  }
}

export function enrichListingsWithKrw(
  listings: MarketListing[],
  costs: CostSettings,
): MarketListing[] {
  return listings.map((listing) => ({
    ...listing,
    priceKrw: getPriceKrw(listing, costs.exchangeRate),
  }));
}

export function calculateMarketAnalysis(
  market: MarketId,
  listings: MarketListing[],
): MarketAnalysis {
  const activeListings = listings.filter((listing) => listing.listingType === "active");
  const soldListings = listings.filter((listing) => listing.listingType === "sold");
  const soldListingsWithObservedDates = soldListings.filter(hasObservedTimestamp);
  const activeListingsWithObservedDates = activeListings.filter(hasObservedTimestamp);
  const referenceListings = soldListings.length > 0 ? soldListings : listings;

  const prices = referenceListings.map((listing) => listing.priceKrw ?? 0).filter(Boolean);
  const nativePrices = referenceListings.map((listing) => listing.price).filter(Boolean);
  const soldPrices = soldListings.map((listing) => listing.priceKrw ?? 0).filter(Boolean);
  const activePrices = activeListings.map((listing) => listing.priceKrw ?? 0).filter(Boolean);
  const trendListings =
    soldListingsWithObservedDates.length >= 2
      ? soldListingsWithObservedDates
      : activeListingsWithObservedDates;
  const sortedTrendListings = [...trendListings].sort((left, right) =>
    (right.soldAt ?? right.listedAt).localeCompare(left.soldAt ?? left.listedAt),
  );

  let trendPercentage = 0;
  let trendDirection: MarketAnalysis["trendDirection"] = "flat";

  if (sortedTrendListings.length >= 2) {
    const splitIndex = Math.ceil(sortedTrendListings.length / 2);
    const recentPrices = sortedTrendListings
      .slice(0, splitIndex)
      .map((listing) => listing.priceKrw ?? 0);
    const previousPrices = sortedTrendListings
      .slice(splitIndex)
      .map((listing) => listing.priceKrw ?? 0);
    const recentAverage = average(recentPrices);
    const previousAverage = average(previousPrices);

    if (previousAverage > 0) {
      trendPercentage = (recentAverage - previousAverage) / previousAverage;
    }

    if (trendPercentage > 0.07) {
      trendDirection = "up";
    } else if (trendPercentage < -0.07) {
      trendDirection = "down";
    }
  }

  const volume7d = soldListingsWithObservedDates.filter((listing) => isWithinDays(listing.soldAt, 7)).length;
  const volume14d = soldListingsWithObservedDates.filter((listing) => isWithinDays(listing.soldAt, 14)).length;
  const volume30d = soldListingsWithObservedDates.filter((listing) => isWithinDays(listing.soldAt, 30)).length;
  const activePressure = volume30d > 0 ? activeListings.length / volume30d : activeListings.length;
  const liquidityScore = Math.round(
    clamp(
      32 +
        volume7d * 20 +
        volume14d * 11 +
        volume30d * 6 -
        Math.max(activePressure - 1.5, 0) * 14,
      5,
      98,
    ),
  );

  return {
    sourceMarket: market,
    marketAveragePrice: Math.round(average(prices)),
    marketMedianPrice: Math.round(median(prices)),
    nativeAveragePrice: Math.round(average(nativePrices)),
    nativeMedianPrice: Math.round(median(nativePrices)),
    activeListingCount: activeListings.length,
    soldListingCount: soldListings.length,
    estimatedVolume7d: volume7d,
    estimatedVolume14d: volume14d,
    estimatedVolume30d: volume30d,
    activeAveragePrice: Math.round(average(activePrices)),
    soldAveragePrice: Math.round(average(soldPrices)),
    lowestPrice: prices.length > 0 ? Math.min(...prices) : 0,
    highestPrice: prices.length > 0 ? Math.max(...prices) : 0,
    trendDirection,
    trendPercentage,
    liquidityScore,
  };
}

export function calculateProfitProjection(
  marketAnalyses: MarketAnalysis[],
  costs: CostSettings,
): ProfitProjection {
  const mercariAnalysis =
    marketAnalyses.find((analysis) => analysis.sourceMarket === "mercari") ??
    calculateMarketAnalysis("mercari", []);
  const bestMarket = chooseBestMarket(marketAnalyses);

  const currentJapanAveragePrice = Math.max(
    mercariAnalysis.marketMedianPrice,
    mercariAnalysis.marketAveragePrice,
  );
  const recommendedSellPrice = Math.round(
    bestMarket.marketMedianPrice * 0.6 + bestMarket.marketAveragePrice * 0.4,
  );
  const totalAdditionalCosts = Math.round(
    costs.japanDomesticShipping * costs.exchangeRate +
      costs.internationalShipping +
      costs.extraCosts,
  );
  const netSellProceeds = Math.round(recommendedSellPrice * (1 - costs.platformFeeRate));
  const expectedNetProfit = Math.round(
    netSellProceeds - currentJapanAveragePrice - totalAdditionalCosts,
  );
  const currentTotalCost = currentJapanAveragePrice + totalAdditionalCosts;
  const expectedMarginRate =
    currentTotalCost > 0 ? expectedNetProfit / currentTotalCost : 0;
  const recommendedBuyPrice = Math.max(
    0,
    Math.round((netSellProceeds - totalAdditionalCosts) / (1 + costs.targetMarginRate)),
  );

  return {
    currentJapanAveragePrice,
    currentJapanAveragePriceJpy: Math.round(currentJapanAveragePrice / costs.exchangeRate),
    recommendedBuyPrice,
    recommendedBuyPriceJpy: Math.round(recommendedBuyPrice / costs.exchangeRate),
    recommendedSellPrice,
    totalAdditionalCosts,
    netSellProceeds,
    expectedNetProfit,
    expectedMarginRate,
    bestResaleMarket: bestMarket.sourceMarket,
  };
}

export function calculateRecommendation(
  listings: MarketListing[],
  marketAnalyses: MarketAnalysis[],
  projection: ProfitProjection,
  groups: ComparableGroup[] = [],
  presetId?: CategoryPresetId,
): RecommendationResult {
  const preset = getSearchCategoryPreset(presetId);
  const mercariAnalysis =
    marketAnalyses.find((analysis) => analysis.sourceMarket === "mercari") ??
    calculateMarketAnalysis("mercari", []);
  const koreanAnalyses = marketAnalyses.filter((analysis) => analysis.sourceMarket !== "mercari");
  const koreanListings = listings.filter((listing) => listing.sourceMarket !== "mercari");
  const soldKoreanListings = koreanListings.filter((listing) => listing.listingType === "sold");
  const bestMarket = chooseBestMarket(marketAnalyses);
  const koreaAveragePrice = average(
    koreanAnalyses.map((analysis) => analysis.marketAveragePrice).filter(Boolean),
  );
  const priceGapRate =
    mercariAnalysis.marketAveragePrice > 0
      ? (koreaAveragePrice - mercariAnalysis.marketAveragePrice) /
        mercariAnalysis.marketAveragePrice
      : 0;
  const sold30d = koreanAnalyses.reduce(
    (sum, analysis) => sum + analysis.estimatedVolume30d,
    0,
  );
  const sold14d = koreanAnalyses.reduce(
    (sum, analysis) => sum + analysis.estimatedVolume14d,
    0,
  );
  const activeCount = koreanAnalyses.reduce(
    (sum, analysis) => sum + analysis.activeListingCount,
    0,
  );
  const averageRelevance = average(listings.map((listing) => listing.relevanceScore));
  const liquidity = average(koreanAnalyses.map((analysis) => analysis.liquidityScore));
  const highConfidenceRate =
    listings.length > 0
      ? listings.filter((listing) => listing.relevanceScore >= 0.72).length / listings.length
      : 0;
  const observedDateRate = calculateObservedDateRate(soldKoreanListings);
  const averageSellingDays = estimateAverageSellingDays(soldKoreanListings);
  const inventoryPressure = sold30d > 0 ? activeCount / sold30d : activeCount;
  const spreadRate = calculateSpreadRate(koreanAnalyses);
  const comparableCoverage = calculateComparableCoverage(groups, listings.length);
  const confidenceRate = calculateConfidenceRate(listings);
  const fieldCompletenessRate = calculateFieldCompletenessRate(listings);
  const sizeDiversity = calculateSizeDiversity(listings);
  const categoryDiversity = calculateCategoryDiversity(listings);
  const numericModelDiversity = calculateNumericModelDiversity(listings);
  const platformPremiumRate = calculatePremiumRate(
    mercariAnalysis.marketAveragePrice,
    bestMarket.marketMedianPrice,
  );
  const platformInventoryPressure =
    bestMarket.estimatedVolume30d > 0
      ? bestMarket.activeListingCount / bestMarket.estimatedVolume30d
      : bestMarket.activeListingCount;
  const weights = preset.recommendation.weights;

  const priceGapScore = clamp(50 + priceGapRate * 140, 0, 100);
  const demandScore = clamp(sold30d * 12 + sold14d * 4.5, 0, 100);
  const inventoryScore = clamp(
    100 -
      Math.max(
        inventoryPressure - Math.max(preset.recommendation.highInventoryPressure - 0.75, 0.8),
        0,
      ) *
        34,
    0,
    100,
  );
  const velocityScore =
    averageSellingDays !== null
      ? calculateInverseTargetScore(averageSellingDays, preset.recommendation.slowSellingDays, 12)
      : clamp(55 + sold14d * 6 - Math.max(inventoryPressure - 1.2, 0) * 16, 18, 92);
  const platformFitScore = clamp(
    bestMarket.liquidityScore * 0.54 +
      bestMarket.estimatedVolume30d * 7 +
      platformPremiumRate * 52 -
      Math.max(platformInventoryPressure - 1.4, 0) * 14,
    0,
    100,
  );
  const profitabilityScore = clamp(
    calculateTargetScore(
      projection.expectedNetProfit,
      preset.recommendation.minExpectedProfit,
      60,
    ) +
      calculateTargetScore(
        projection.expectedMarginRate,
        preset.recommendation.minMarginRate,
        40,
      ),
    0,
    100,
  );
  const matchQualityScore = clamp(
    averageRelevance * 56 +
      highConfidenceRate * 16 +
      comparableCoverage * 14 +
      confidenceRate * 9 +
      fieldCompletenessRate * 5,
    0,
    100,
  );
  const marginScore = calculateTargetScore(
    projection.expectedMarginRate,
    preset.recommendation.minMarginRate,
  );
  const uncertaintyPenalty = clamp(
    (Math.max(0, 0.64 - averageRelevance) * 62 +
      Math.max(0, 0.52 - confidenceRate) * 28 +
      Math.max(0, preset.recommendation.lowComparableCoverage - comparableCoverage) * 45 +
      Math.max(0, 0.45 - observedDateRate) * 18 +
      Math.max(spreadRate - 0.55, 0) * 24 +
      Math.max(0, 0.72 - fieldCompletenessRate) * 18) *
      preset.recommendation.uncertaintyPenaltyMultiplier,
    0,
    38,
  );

  const recommendationScore = Math.round(
    clamp(
      priceGapScore * weights.priceGap +
        demandScore * weights.demand +
        inventoryScore * weights.inventory +
        velocityScore * weights.velocity +
        platformFitScore * weights.platformFit +
        profitabilityScore * weights.profitability +
        matchQualityScore * weights.matchQuality +
        liquidity * weights.liquidity +
        marginScore * weights.margin -
        uncertaintyPenalty,
      0,
      100,
    ),
  );

  const recommendationReasons: string[] = [];
  const blockerReasons: string[] = [];
  const suggestedAdjustments: string[] = [];

  if (priceGapRate >= 0.16) {
    addUnique(
      recommendationReasons,
      `한국 평균 시세가 일본 평균 시세보다 ${(priceGapRate * 100).toFixed(1)}% 높아 기본 가격 차익 여지가 있습니다.`,
    );
  }

  if (sold30d >= 3) {
    addUnique(
      recommendationReasons,
      `최근 30일 판매완료 추정 ${sold30d}건, 판매중 ${activeCount}건으로 재고 압박은 ${inventoryPressure.toFixed(1)}배 수준입니다.`,
    );
  }

  if (averageSellingDays !== null && averageSellingDays <= Math.round(preset.recommendation.slowSellingDays * 0.6)) {
    addUnique(
      recommendationReasons,
      `판매완료 기준 추정 회전 기간 중앙값이 약 ${averageSellingDays}일로 비교적 빠른 편입니다.`,
    );
  }

  if (projection.expectedNetProfit >= preset.recommendation.minExpectedProfit) {
    addUnique(
      recommendationReasons,
      `비용 반영 후 예상 순이익이 약 ${projection.expectedNetProfit.toLocaleString("ko-KR")}원이며 마진율은 ${(projection.expectedMarginRate * 100).toFixed(1)}%입니다.`,
    );
  }

  if (comparableCoverage >= Math.max(0.5, preset.recommendation.lowComparableCoverage + 0.05)) {
    addUnique(
      recommendationReasons,
      `교차 마켓 비교군 커버리지가 ${(comparableCoverage * 100).toFixed(0)}%로 동일 상품 비교 신뢰도가 비교적 높습니다.`,
    );
  }

  if (platformPremiumRate >= 0.12) {
    addUnique(
      recommendationReasons,
      `${MARKET_LABELS[bestMarket.sourceMarket]}에서 메루카리 대비 가격 프리미엄이 ${(platformPremiumRate * 100).toFixed(1)}% 수준으로 관측됩니다.`,
    );
  }

  if (projection.expectedNetProfit <= 0) {
    addUnique(
      blockerReasons,
      "현재 비용 구조에서는 예상 순이익이 음수라서 즉시 매입 판단은 보류하는 편이 안전합니다.",
    );
  }

  if (projection.expectedMarginRate < preset.recommendation.minMarginRate) {
    addUnique(
      blockerReasons,
      `예상 마진율이 ${(preset.recommendation.minMarginRate * 100).toFixed(0)}% 목표에 못 미쳐 수수료나 배송비 변동에 취약합니다.`,
    );
  }

  if (inventoryPressure >= preset.recommendation.highInventoryPressure && activeCount > 3) {
    addUnique(
      blockerReasons,
      "판매중 재고가 최근 판매 흐름보다 많아 회전 속도 둔화 가능성이 있습니다.",
    );
  }

  if (averageSellingDays !== null && averageSellingDays > preset.recommendation.slowSellingDays) {
    addUnique(
      blockerReasons,
      `추정 회전 기간이 약 ${averageSellingDays}일로 길어 자금 회수 기간이 늘어질 수 있습니다.`,
    );
  }

  if (averageRelevance < 0.62 || comparableCoverage < preset.recommendation.lowComparableCoverage) {
    addUnique(
      blockerReasons,
      "검색 결과에 유사 모델이 섞여 있어 동일 상품 비교 정확도가 아직 충분하지 않습니다.",
    );
  }

  if (uncertaintyPenalty >= 18) {
    addUnique(
      blockerReasons,
      "날짜, 이미지, 핵심 속성 완성도가 충분하지 않아 현재 시세 해석은 보수적으로 보는 편이 좋습니다.",
    );
  }

  if (projection.expectedNetProfit < preset.recommendation.minExpectedProfit) {
    addUnique(
      suggestedAdjustments,
      "환율, 국제 배송비, 플랫폼 수수료를 다시 입력해 목표 이익 기준을 보수적으로 재계산해보세요.",
    );
  }

  if (averageRelevance < 0.7) {
    addUnique(
      suggestedAdjustments,
      "검색어에 브랜드명, 모델명, 핵심 속성 키워드를 더 구체적으로 넣어 동일 상품 매칭 정확도를 높여보세요.",
    );
  }

  if (inventoryPressure > Math.max(1.4, preset.recommendation.highInventoryPressure - 0.4)) {
    addUnique(
      suggestedAdjustments,
      "재고 압박이 큰 구간이라면 추천 매입가 이하의 저가 매물만 선별해 접근하는 편이 좋습니다.",
    );
  }

  if (sold30d < 2 || averageSellingDays === null) {
    addUnique(
      suggestedAdjustments,
      "7일, 14일, 30일 판매완료 흐름을 더 길게 보고 단발 거래인지 반복 거래인지 확인해보세요.",
    );
  }

  if (comparableCoverage < preset.recommendation.lowComparableCoverage) {
    addUnique(
      suggestedAdjustments,
      "같은 브랜드 안에서도 세부 모델명이 다른 매물이 섞였을 수 있으니 모델명과 숫자 토큰을 더 좁혀 재검색해보세요.",
    );
  }

  const alternativeKoreanMarkets = koreanAnalyses.filter(
    (analysis) => analysis.sourceMarket !== bestMarket.sourceMarket,
  );
  const alternativeMedian = average(
    alternativeKoreanMarkets.map((analysis) => analysis.marketMedianPrice).filter(Boolean),
  );
  const bestMarketReasons = [
    `${MARKET_LABELS[bestMarket.sourceMarket]}의 중간값은 ${bestMarket.marketMedianPrice.toLocaleString("ko-KR")}원으로 현재 비교군에서 가장 안정적입니다.`,
    `${MARKET_LABELS[bestMarket.sourceMarket]}의 최근 30일 판매완료 추정은 ${bestMarket.estimatedVolume30d}건이고 재고 압박은 ${platformInventoryPressure.toFixed(1)}배입니다.`,
    alternativeMedian > 0
      ? `${MARKET_LABELS[bestMarket.sourceMarket]}의 중간값이 다른 국내 마켓 평균보다 ${(bestMarket.marketMedianPrice - alternativeMedian).toLocaleString("ko-KR")}원 높습니다.`
      : `${MARKET_LABELS[bestMarket.sourceMarket]}의 시장 활발도 점수는 ${bestMarket.liquidityScore}점입니다.`,
  ];

  applyPresetSpecificFeedback(preset.id, {
    recommendationReasons,
    blockerReasons,
    suggestedAdjustments,
    bestMarketReasons,
    averageSellingDays,
    comparableCoverage,
    sizeDiversity,
    categoryDiversity,
    numericModelDiversity,
    inventoryPressure,
    projection,
    bestMarket,
    fieldCompletenessRate,
    confidenceRate,
  });

  if (recommendationReasons.length === 0) {
    addUnique(
      recommendationReasons,
      "시장 차익과 거래 속도가 아주 강한 구간은 아니어서 보수적으로 접근하는 편이 좋습니다.",
    );
  }

  if (blockerReasons.length === 0 && recommendationScore >= 70) {
    addUnique(
      blockerReasons,
      "큰 리스크는 적지만 실제 매입 전에는 실물 상태와 구성품, 사이즈/세대 차이를 다시 확인하는 것이 안전합니다.",
    );
  }

  if (suggestedAdjustments.length === 0) {
    addUnique(
      suggestedAdjustments,
      "현재 조건에서는 추천 매입가 이하 매물만 엄격하게 선별하는 전략이 가장 현실적입니다.",
    );
  }

  return {
    recommendationScore,
    recommendationGrade: resolveGrade(recommendationScore),
    recommendationReasons,
    blockerReasons,
    suggestedAdjustments,
    bestMarketReasons,
    bestResaleMarket: bestMarket.sourceMarket,
  };
}

export function pickRecommendedListings(
  listings: MarketListing[],
  projection: ProfitProjection,
  presetId?: CategoryPresetId,
): RecommendedListing[] {
  const preset = getSearchCategoryPreset(presetId);
  const mercariListings = listings.filter(
    (listing) =>
      listing.sourceMarket === "mercari" &&
      listing.listingType === "active" &&
      listing.priceKrw,
  );
  const minRelevanceByPreset: Record<CategoryPresetId, number> = {
    fashion: 0.5,
    camera: 0.58,
    vintage_furniture: 0.46,
  };

  return mercariListings
    .map((listing) => {
      const acquisitionCost = (listing.priceKrw ?? 0) + projection.totalAdditionalCosts;
      const estimatedProfit = projection.netSellProceeds - acquisitionCost;
      const estimatedMarginRate =
        acquisitionCost > 0 ? estimatedProfit / acquisitionCost : 0;
      const isUnderRecommendedBuyPrice =
        (listing.priceKrw ?? Number.MAX_SAFE_INTEGER) <= projection.recommendedBuyPrice;
      const profitabilityScore = calculateTargetScore(
        estimatedProfit,
        preset.recommendation.minExpectedProfit,
      );
      const marginScore = calculateTargetScore(
        estimatedMarginRate,
        preset.recommendation.minMarginRate,
      );
      const dealScore = Math.round(
        listing.relevanceScore * (preset.id === "camera" ? 46 : preset.id === "vintage_furniture" ? 38 : 42) +
          listing.confidenceScore * 18 +
          (isUnderRecommendedBuyPrice ? 24 : 8) +
          profitabilityScore * 0.18 +
          marginScore * 0.12,
      );

      return {
        ...listing,
        estimatedProfit: Math.round(estimatedProfit),
        estimatedMarginRate,
        targetResaleMarket: projection.bestResaleMarket,
        dealScore,
        isUnderRecommendedBuyPrice,
      };
    })
    .filter((listing) => listing.relevanceScore >= minRelevanceByPreset[preset.id])
    .sort((left, right) => {
      if (right.dealScore !== left.dealScore) {
        return right.dealScore - left.dealScore;
      }

      return right.estimatedProfit - left.estimatedProfit;
    })
    .slice(0, 6);
}

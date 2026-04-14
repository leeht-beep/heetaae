import {
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
import { MARKET_LABELS } from "@/lib/constants";

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
          (left.activeListingCount / Math.max(left.estimatedVolume30d, 1)) - 1.8,
          0,
        ) *
          12000;
      const rightScore =
        right.marketMedianPrice * 0.52 +
        right.marketAveragePrice * 0.2 +
        right.liquidityScore * 1200 +
        right.estimatedVolume30d * 1400 -
        Math.max(
          (right.activeListingCount / Math.max(right.estimatedVolume30d, 1)) - 1.8,
          0,
        ) *
          12000;

      return rightScore - leftScore;
    })[0] ?? marketAnalyses[0]
  );
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

export function calculateRecommendation(
  listings: MarketListing[],
  marketAnalyses: MarketAnalysis[],
  projection: ProfitProjection,
  groups: ComparableGroup[] = [],
): RecommendationResult {
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
      ? listings.filter((listing) => listing.relevanceScore >= 0.7).length / listings.length
      : 0;
  const observedDateRate = calculateObservedDateRate(soldKoreanListings);
  const averageSellingDays = estimateAverageSellingDays(soldKoreanListings);
  const inventoryPressure = sold30d > 0 ? activeCount / sold30d : activeCount;
  const spreadRate = calculateSpreadRate(koreanAnalyses);
  const comparableCoverage = calculateComparableCoverage(groups, listings.length);
  const priceGapScore = clamp(48 + priceGapRate * 130, 0, 100);
  const demandScore = clamp(sold30d * 13 + sold14d * 5, 0, 100);
  const inventoryScore = clamp(100 - Math.max(inventoryPressure - 1.15, 0) * 26, 0, 100);
  const velocityScore =
    averageSellingDays !== null
      ? clamp(100 - averageSellingDays * 2.4, 15, 100)
      : clamp(60 + sold14d * 5 - Math.max(inventoryPressure - 1.25, 0) * 14, 20, 90);
  const platformPremiumRate =
    mercariAnalysis.marketAveragePrice > 0
      ? (bestMarket.marketMedianPrice - mercariAnalysis.marketAveragePrice) /
        mercariAnalysis.marketAveragePrice
      : 0;
  const platformInventoryPressure =
    bestMarket.estimatedVolume30d > 0
      ? bestMarket.activeListingCount / bestMarket.estimatedVolume30d
      : bestMarket.activeListingCount;
  const platformFitScore = clamp(
    bestMarket.liquidityScore * 0.6 +
      bestMarket.estimatedVolume30d * 6 +
      platformPremiumRate * 55 -
      Math.max(platformInventoryPressure - 1.5, 0) * 12,
    0,
    100,
  );
  const profitabilityScore = clamp(
    projection.expectedNetProfit / 4000 + projection.expectedMarginRate * 140,
    0,
    100,
  );
  const matchQualityScore = clamp(
    averageRelevance * 72 + highConfidenceRate * 18 + comparableCoverage * 10,
    0,
    100,
  );
  const uncertaintyPenalty = clamp(
    Math.max(0, 0.62 - averageRelevance) * 70 +
      Math.max(0, 0.4 - highConfidenceRate) * 45 +
      Math.max(0, 0.4 - comparableCoverage) * 28 +
      Math.max(0, 0.45 - observedDateRate) * 16 +
      Math.max(spreadRate - 0.5, 0) * 24,
    0,
    32,
  );

  const recommendationScore = Math.round(
    clamp(
      priceGapScore * 0.2 +
        demandScore * 0.16 +
        inventoryScore * 0.11 +
        velocityScore * 0.1 +
        platformFitScore * 0.12 +
        profitabilityScore * 0.17 +
        matchQualityScore * 0.08 +
        liquidity * 0.06 +
        clamp(projection.expectedMarginRate * 120, 0, 100) * 0.1 -
        uncertaintyPenalty,
      0,
      100,
    ),
  );

  const recommendationReasons: string[] = [];
  const blockerReasons: string[] = [];
  const suggestedAdjustments: string[] = [];

  if (priceGapRate >= 0.18) {
    recommendationReasons.push(
      `한국 평균 시세가 일본 평균 시세보다 ${(priceGapRate * 100).toFixed(1)}% 높아 가격 차익 여지가 있습니다.`,
    );
  }

  if (sold30d >= 3) {
    recommendationReasons.push(
      `최근 30일 판매완료 추정 ${sold30d}건, 판매중 ${activeCount}건으로 재고 압박이 ${inventoryPressure.toFixed(1)}배 수준입니다.`,
    );
  }

  if (averageSellingDays !== null && averageSellingDays <= 18) {
    recommendationReasons.push(
      `판매완료 매물 기준 추정 회전 기간 중앙값이 약 ${averageSellingDays}일로 비교적 빠른 편입니다.`,
    );
  }

  if (projection.expectedNetProfit >= 50000) {
    recommendationReasons.push(
      `비용 반영 후 예상 순이익이 약 ${projection.expectedNetProfit.toLocaleString("ko-KR")}원이고 예상 마진율은 ${(projection.expectedMarginRate * 100).toFixed(1)}%입니다.`,
    );
  }

  if (comparableCoverage >= 0.55) {
    recommendationReasons.push(
      `서로 다른 마켓에서 같은 상품군으로 묶인 비교군 비중이 ${(comparableCoverage * 100).toFixed(0)}%로 비교 신뢰도가 무난합니다.`,
    );
  }

  if (projection.expectedNetProfit <= 0) {
    blockerReasons.push("현재 비용 조건에서는 예상 순이익이 음수라 즉시 매입 판단이 어렵습니다.");
  }

  if (projection.expectedMarginRate < 0.12) {
    blockerReasons.push("예상 마진율이 낮아 환율 변동이나 배송비 오차가 생기면 손익이 빠르게 악화될 수 있습니다.");
  }

  if (inventoryPressure >= 2.2 && activeCount > 3) {
    blockerReasons.push("판매중 재고가 최근 판매완료 흐름보다 많아 회전 속도가 둔화될 가능성이 있습니다.");
  }

  if (averageSellingDays !== null && averageSellingDays > 30) {
    blockerReasons.push(`판매완료 매물 기준 추정 회전 기간이 약 ${averageSellingDays}일로 길어 자금 회수가 느릴 수 있습니다.`);
  }

  if (averageRelevance < 0.6 || comparableCoverage < 0.45) {
    blockerReasons.push("검색 결과에 다른 모델이나 변형 상품이 섞여 있어 동일상품 비교 정확도가 아직 낮습니다.");
  }

  if (uncertaintyPenalty >= 18) {
    blockerReasons.push("표본 수와 날짜 신뢰도가 충분하지 않아 시세 판단을 보수적으로 해석하는 편이 안전합니다.");
  }

  if (projection.expectedNetProfit < 50000) {
    suggestedAdjustments.push("국제 배송비, 플랫폼 수수료, 기타 비용을 다시 입력해 손익 기준을 더 보수적으로 잡아 보세요.");
  }

  if (averageRelevance < 0.68) {
    suggestedAdjustments.push("검색어에 브랜드, 정확한 모델명, 시즌명, 색상, 사이즈를 추가해 노이즈 매물을 더 강하게 줄이세요.");
  }

  if (inventoryPressure > 1.6) {
    suggestedAdjustments.push("재고가 많은 구간이라면 추천 매입가 이하의 메루카리 저가 매물만 선별해서 접근하는 편이 안전합니다.");
  }

  if (sold30d < 2 || averageSellingDays === null) {
    suggestedAdjustments.push("7일 지표보다 14일, 30일 기준 판매완료 흐름을 더 크게 보고 천천히 거래되는 상품인지 확인하세요.");
  }

  if (comparableCoverage < 0.5) {
    suggestedAdjustments.push("같은 브랜드 안에서도 세부 모델명이 다른 매물이 섞일 수 있으니 모델명과 연식 키워드로 한 번 더 좁혀 보세요.");
  }

  const alternativeKoreanMarkets = koreanAnalyses.filter(
    (analysis) => analysis.sourceMarket !== bestMarket.sourceMarket,
  );
  const alternativeMedian = average(
    alternativeKoreanMarkets.map((analysis) => analysis.marketMedianPrice).filter(Boolean),
  );
  const bestMarketReasons = [
    `${MARKET_LABELS[bestMarket.sourceMarket]}의 중간값은 ${bestMarket.marketMedianPrice.toLocaleString("ko-KR")}원으로 현재 비교군에서 가장 안정적입니다.`,
    `${MARKET_LABELS[bestMarket.sourceMarket]}의 최근 30일 판매완료 추정은 ${bestMarket.estimatedVolume30d}건, 재고 압박은 ${platformInventoryPressure.toFixed(1)}배입니다.`,
    alternativeMedian > 0
      ? `${MARKET_LABELS[bestMarket.sourceMarket]}의 중간값이 다른 국내 마켓 평균보다 ${(bestMarket.marketMedianPrice - alternativeMedian).toLocaleString("ko-KR")}원 높습니다.`
      : `${MARKET_LABELS[bestMarket.sourceMarket]}의 시장 활발도 점수는 ${bestMarket.liquidityScore}점입니다.`,
  ];

  if (recommendationReasons.length === 0) {
    recommendationReasons.push("시장 차익과 거래 속도가 뚜렷하지 않아 보수적으로 접근해야 하는 구간입니다.");
  }

  if (blockerReasons.length === 0 && recommendationScore >= 70) {
    blockerReasons.push("큰 리스크는 적지만 실제 매입 전에는 동일 사이즈와 컨디션 기준으로 개별 매물을 다시 확인하는 편이 안전합니다.");
  }

  if (suggestedAdjustments.length === 0) {
    suggestedAdjustments.push("현재 조건으로는 추천 매입가와 예상 순이익을 기준 삼아 개별 매물 가격만 엄격히 고르면 됩니다.");
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
): RecommendedListing[] {
  const mercariListings = listings.filter(
    (listing) =>
      listing.sourceMarket === "mercari" &&
      listing.listingType === "active" &&
      listing.priceKrw,
  );

  return mercariListings
    .map((listing) => {
      const acquisitionCost = (listing.priceKrw ?? 0) + projection.totalAdditionalCosts;
      const estimatedProfit = projection.netSellProceeds - acquisitionCost;
      const estimatedMarginRate =
        acquisitionCost > 0 ? estimatedProfit / acquisitionCost : 0;
      const isUnderRecommendedBuyPrice =
        (listing.priceKrw ?? Number.MAX_SAFE_INTEGER) <= projection.recommendedBuyPrice;
      const dealScore = Math.round(
        listing.relevanceScore * 42 +
          (isUnderRecommendedBuyPrice ? 30 : 10) +
          clamp(estimatedProfit / 4000, -14, 30) +
          clamp(estimatedMarginRate * 40, -8, 18),
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
    .filter((listing) => listing.relevanceScore >= 0.5)
    .sort((left, right) => {
      if (right.dealScore !== left.dealScore) {
        return right.dealScore - left.dealScore;
      }

      return right.estimatedProfit - left.estimatedProfit;
    })
    .slice(0, 6);
}

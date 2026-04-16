import type { MARKET_LABELS } from "@/lib/constants";
import { getSearchCategoryPreset } from "@/lib/search/presets";
import { MARKET_LABELS as MARKET_LABELS_VALUE } from "@/lib/constants";
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
          "移대찓???뱀꽦??紐⑤뜽 ?몃?? ?レ옄 ?좏겙????留욌뒗 鍮꾧탳援곗씠 ?뺣낫?섏뼱 紐⑤뜽 ?쇱엯 ?꾪뿕????뒿?덈떎.",
        );
      }

      if (context.numericModelDiversity >= 4) {
        addUnique(
          context.blockerReasons,
          "鍮꾩듂???レ옄 紐⑤뜽??留롮씠 ?욎뿬 ?덉뼱 諛붾뵒 ?몃?, ?뚯쫰 ?ы븿 ?щ?, 踰덈뱾 援ъ꽦 ?쇱엯 媛?μ꽦???쎈땲??",
        );
      }

      if (context.confidenceRate < 0.62 || context.fieldCompletenessRate < 0.7) {
        addUnique(
          context.blockerReasons,
          "?뷀꽣移댁슫?? 諛뺤뒪 援ъ꽦, ?뚯쫰 ?ы븿 ?щ?泥섎읆 移대찓???듭떖 ?꾨뱶媛 遺議깊빐 蹂댁닔?곸쑝濡??먮떒?댁빞 ?⑸땲??",
        );
      }

      addUnique(
        context.suggestedAdjustments,
        "移대찓?쇰뒗 ?뺥솗??紐⑤뜽紐낃낵 ?몃? ?쒓린, 諛붾뵒/?뚯쫰 ?ы븿 ?щ?, 諛뺤뒪 援ъ꽦 ?ㅼ썙?쒕? 寃?됱뼱???④퍡 ?ｌ뼱 ?ㅼ떆 鍮꾧탳?대낫?몄슂.",
      );
      addUnique(
        context.bestMarketReasons,
        `${MARKET_LABELS_VALUE[context.bestMarket.sourceMarket]}?(?? 移대찓??移댄뀒怨좊━ 湲곗??쇰줈 理쒓렐 嫄곕옒?됯낵 媛寃??꾨━誘몄뾼 洹좏삎??媛???덉젙?곸엯?덈떎.`,
      );
      break;
    case "vintage_furniture":
      if (context.projection.expectedNetProfit >= 180000) {
        addUnique(
          context.recommendationReasons,
          "鍮덊떚吏 媛援щ뒗 諛곗넚 遺?댁씠 ?ъ?留? ?꾩옱 ?덉긽 ?댁씡?대㈃ 臾쇰쪟 鍮꾩슜??媛먯븞?대룄 諛⑹뼱 媛?ν븳 援ш컙?낅땲??",
        );
      }

      if (
        (context.averageSellingDays !== null && context.averageSellingDays > 45) ||
        context.inventoryPressure > 1.4
      ) {
        addUnique(
          context.blockerReasons,
          "鍮덊떚吏 媛援щ뒗 ?뚯쟾???먮┛ ?몄씠??吏곴굅???댁넚 遺?닿퉴吏 媛먯븞?섎㈃ ?먭툑 ?뚯닔 湲곌컙??湲몄뼱吏????덉뒿?덈떎.",
        );
      }

      if (context.categoryDiversity >= 3 || context.comparableCoverage < 0.5) {
        addUnique(
          context.blockerReasons,
          "泥댁뼱/?뚯씠釉????ㅻⅨ ?쇱씤???욎???媛?μ꽦???덉뼱 ?숈씪 ?쇱씤 鍮꾧탳援곗쓣 ??醫곹?蹂대뒗 ?몄씠 ?덉쟾?⑸땲??",
        );
      }

      addUnique(
        context.suggestedAdjustments,
        "鍮덊떚吏 媛援щ뒗 釉뚮옖?쒕챸 ?몄뿉 ?쇱씤紐? ?곕뱶 ??? ?ъ씠利? 吏곴굅??諛곗넚 議곌굔??寃?됱뼱? 鍮꾩슜 怨꾩궛???④퍡 諛섏쁺?대낫?몄슂.",
      );
      addUnique(
        context.bestMarketReasons,
        `${MARKET_LABELS_VALUE[context.bestMarket.sourceMarket]}?(?? 媛援?移댄뀒怨좊━ 湲곗??쇰줈 ?ш퀬 ?뺣컯???곷??곸쑝濡???퀬 媛寃?諛⑹뼱?μ씠 ?レ뒿?덈떎.`,
      );
      break;
    case "fashion":
    default:
      if (context.sizeDiversity <= 2 && context.comparableCoverage >= 0.5) {
        addUnique(
          context.recommendationReasons,
          "?⑥뀡 ?곹뭹 湲곗??쇰줈 ?ъ씠利댟룹떆利??쇱엯???ъ? ?딆븘 ?숈씪 ?곹뭹 鍮꾧탳 ?뺥솗?꾧? 鍮꾧탳???믪뒿?덈떎.",
        );
      }

      if (context.sizeDiversity >= 4) {
        addUnique(
          context.blockerReasons,
          "媛숈? 紐⑤뜽?대씪???ъ씠利??ㅽ럺?몃읆???볦뼱 ?ㅼ젣 ?먮ℓ媛媛 ?ш쾶 媛덈┫ ???덉뒿?덈떎.",
        );
      }

      addUnique(
        context.suggestedAdjustments,
        "?⑥뀡 移댄뀒怨좊━???ъ씠利? 而щ윭, ?쒖쫵紐낆쓣 寃?됱뼱??異붽??섎㈃ ?숈씪 ?곹뭹 留ㅼ묶 ?뺥솗?꾧? ??醫뗭븘吏묐땲??",
      );
      addUnique(
        context.bestMarketReasons,
        `${MARKET_LABELS_VALUE[context.bestMarket.sourceMarket]}?(?? ?⑥뀡 移댄뀒怨좊━ 湲곗??쇰줈 ?좊룞?깃낵 ?됯퇏 ?먮ℓ媛??洹좏삎??醫뗭뒿?덈떎.`,
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
      `?쒓뎅 ?됯퇏 ?쒖꽭媛 ?쇰낯 ?됯퇏 ?쒖꽭蹂대떎 ${(priceGapRate * 100).toFixed(1)}% ?믪븘 湲곕낯 媛寃?李⑥씡 ?ъ?媛 ?덉뒿?덈떎.`,
    );
  }

  if (sold30d >= 3) {
    addUnique(
      recommendationReasons,
      `理쒓렐 30???먮ℓ?꾨즺 異붿젙 ${sold30d}嫄? ?먮ℓ以?${activeCount}嫄댁쑝濡??ш퀬 ?뺣컯? ${inventoryPressure.toFixed(1)}諛??섏??낅땲??`,
    );
  }

  if (averageSellingDays !== null && averageSellingDays <= Math.round(preset.recommendation.slowSellingDays * 0.6)) {
    addUnique(
      recommendationReasons,
      `?먮ℓ?꾨즺 湲곗? 異붿젙 ?뚯쟾 湲곌컙 以묒븰媛믪씠 ??${averageSellingDays}?쇰줈 鍮꾧탳??鍮좊Ⅸ ?몄엯?덈떎.`,
    );
  }

  if (projection.expectedNetProfit >= preset.recommendation.minExpectedProfit) {
    addUnique(
      recommendationReasons,
      `鍮꾩슜 諛섏쁺 ???덉긽 ?쒖씠?듭씠 ??${projection.expectedNetProfit.toLocaleString("ko-KR")}?먯씠硫?留덉쭊?⑥? ${(projection.expectedMarginRate * 100).toFixed(1)}%?낅땲??`,
    );
  }

  if (comparableCoverage >= Math.max(0.5, preset.recommendation.lowComparableCoverage + 0.05)) {
    addUnique(
      recommendationReasons,
      `援먯감 留덉폆 鍮꾧탳援?而ㅻ쾭由ъ?媛 ${(comparableCoverage * 100).toFixed(0)}%濡??숈씪 ?곹뭹 鍮꾧탳 ?좊ː?꾧? 鍮꾧탳???믪뒿?덈떎.`,
    );
  }

  if (platformPremiumRate >= 0.12) {
    addUnique(
      recommendationReasons,
      `${MARKET_LABELS_VALUE[bestMarket.sourceMarket]}?먯꽌 硫붾（移대━ ?鍮?媛寃??꾨━誘몄뾼??${(platformPremiumRate * 100).toFixed(1)}% ?섏??쇰줈 愿痢〓맗?덈떎.`,
    );
  }

  if (projection.expectedNetProfit <= 0) {
    addUnique(
      blockerReasons,
      "?꾩옱 鍮꾩슜 援ъ“?먯꽌???덉긽 ?쒖씠?듭씠 ?뚯닔?쇱꽌 利됱떆 留ㅼ엯 ?먮떒? 蹂대쪟?섎뒗 ?몄씠 ?덉쟾?⑸땲??",
    );
  }

  if (projection.expectedMarginRate < preset.recommendation.minMarginRate) {
    addUnique(
      blockerReasons,
      `?덉긽 留덉쭊?⑥씠 ${(preset.recommendation.minMarginRate * 100).toFixed(0)}% 紐⑺몴??紐?誘몄퀜 ?섏닔猷뚮굹 諛곗넚鍮?蹂?숈뿉 痍⑥빟?⑸땲??`,
    );
  }

  if (inventoryPressure >= preset.recommendation.highInventoryPressure && activeCount > 3) {
    addUnique(
      blockerReasons,
      "?먮ℓ以??ш퀬媛 理쒓렐 ?먮ℓ ?먮쫫蹂대떎 留롮븘 ?뚯쟾 ?띾룄 ?뷀솕 媛?μ꽦???덉뒿?덈떎.",
    );
  }

  if (averageSellingDays !== null && averageSellingDays > preset.recommendation.slowSellingDays) {
    addUnique(
      blockerReasons,
      `異붿젙 ?뚯쟾 湲곌컙????${averageSellingDays}?쇰줈 湲몄뼱 ?먭툑 ?뚯닔 湲곌컙???섏뼱吏????덉뒿?덈떎.`,
    );
  }

  if (averageRelevance < 0.62 || comparableCoverage < preset.recommendation.lowComparableCoverage) {
    addUnique(
      blockerReasons,
      "寃??寃곌낵???좎궗 紐⑤뜽???욎뿬 ?덉뼱 ?숈씪 ?곹뭹 鍮꾧탳 ?뺥솗?꾧? ?꾩쭅 異⑸텇?섏? ?딆뒿?덈떎.",
    );
  }

  if (uncertaintyPenalty >= 18) {
    addUnique(
      blockerReasons,
      "?좎쭨, ?대?吏, ?듭떖 ?띿꽦 ?꾩꽦?꾧? 異⑸텇?섏? ?딆븘 ?꾩옱 ?쒖꽭 ?댁꽍? 蹂댁닔?곸쑝濡?蹂대뒗 ?몄씠 醫뗭뒿?덈떎.",
    );
  }

  if (projection.expectedNetProfit < preset.recommendation.minExpectedProfit) {
    addUnique(
      suggestedAdjustments,
      "?섏쑉, 援?젣 諛곗넚鍮? ?뚮옯???섏닔猷뚮? ?ㅼ떆 ?낅젰??紐⑺몴 ?댁씡 湲곗???蹂댁닔?곸쑝濡??ш퀎?고빐蹂댁꽭??",
    );
  }

  if (averageRelevance < 0.7) {
    addUnique(
      suggestedAdjustments,
      "寃?됱뼱??釉뚮옖?쒕챸, 紐⑤뜽紐? ?듭떖 ?띿꽦 ?ㅼ썙?쒕? ??援ъ껜?곸쑝濡??ｌ뼱 ?숈씪 ?곹뭹 留ㅼ묶 ?뺥솗?꾨? ?믪뿬蹂댁꽭??",
    );
  }

  if (inventoryPressure > Math.max(1.4, preset.recommendation.highInventoryPressure - 0.4)) {
    addUnique(
      suggestedAdjustments,
      "?ш퀬 ?뺣컯????援ш컙?대씪硫?異붿쿇 留ㅼ엯媛 ?댄븯???媛 留ㅻЪ留??좊퀎???묎렐?섎뒗 ?몄씠 醫뗭뒿?덈떎.",
    );
  }

  if (sold30d < 2 || averageSellingDays === null) {
    addUnique(
      suggestedAdjustments,
      "7?? 14?? 30???먮ℓ?꾨즺 ?먮쫫????湲멸쾶 蹂닿퀬 ?⑤컻 嫄곕옒?몄? 諛섎났 嫄곕옒?몄? ?뺤씤?대낫?몄슂.",
    );
  }

  if (comparableCoverage < preset.recommendation.lowComparableCoverage) {
    addUnique(
      suggestedAdjustments,
      "媛숈? 釉뚮옖???덉뿉?쒕룄 ?몃? 紐⑤뜽紐낆씠 ?ㅻⅨ 留ㅻЪ???욎??????덉쑝??紐⑤뜽紐낃낵 ?レ옄 ?좏겙????醫곹? ?ш??됲빐蹂댁꽭??",
    );
  }

  const alternativeKoreanMarkets = koreanAnalyses.filter(
    (analysis) => analysis.sourceMarket !== bestMarket.sourceMarket,
  );
  const alternativeMedian = average(
    alternativeKoreanMarkets.map((analysis) => analysis.marketMedianPrice).filter(Boolean),
  );
  const bestMarketReasons = [
    `${MARKET_LABELS_VALUE[bestMarket.sourceMarket]}??以묎컙媛믪? ${bestMarket.marketMedianPrice.toLocaleString("ko-KR")}?먯쑝濡??꾩옱 鍮꾧탳援곗뿉??媛???덉젙?곸엯?덈떎.`,
    `${MARKET_LABELS_VALUE[bestMarket.sourceMarket]}??理쒓렐 30???먮ℓ?꾨즺 異붿젙? ${bestMarket.estimatedVolume30d}嫄댁씠怨??ш퀬 ?뺣컯? ${platformInventoryPressure.toFixed(1)}諛곗엯?덈떎.`,
    alternativeMedian > 0
      ? `${MARKET_LABELS_VALUE[bestMarket.sourceMarket]}??以묎컙媛믪씠 ?ㅻⅨ 援?궡 留덉폆 ?됯퇏蹂대떎 ${(bestMarket.marketMedianPrice - alternativeMedian).toLocaleString("ko-KR")}???믪뒿?덈떎.`
      : `${MARKET_LABELS_VALUE[bestMarket.sourceMarket]}???쒖옣 ?쒕컻???먯닔??${bestMarket.liquidityScore}?먯엯?덈떎.`,
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
      "?쒖옣 李⑥씡怨?嫄곕옒 ?띾룄媛 ?꾩＜ 媛뺥븳 援ш컙? ?꾨땲?댁꽌 蹂댁닔?곸쑝濡??묎렐?섎뒗 ?몄씠 醫뗭뒿?덈떎.",
    );
  }

  if (blockerReasons.length === 0 && recommendationScore >= 70) {
    addUnique(
      blockerReasons,
      "??由ъ뒪?щ뒗 ?곸?留??ㅼ젣 留ㅼ엯 ?꾩뿉???ㅻЪ ?곹깭? 援ъ꽦?? ?ъ씠利??몃? 李⑥씠瑜??ㅼ떆 ?뺤씤?섎뒗 寃껋씠 ?덉쟾?⑸땲??",
    );
  }

  if (suggestedAdjustments.length === 0) {
    addUnique(
      suggestedAdjustments,
      "?꾩옱 議곌굔?먯꽌??異붿쿇 留ㅼ엯媛 ?댄븯 留ㅻЪ留??꾧꺽?섍쾶 ?좊퀎?섎뒗 ?꾨왂??媛???꾩떎?곸엯?덈떎.",
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


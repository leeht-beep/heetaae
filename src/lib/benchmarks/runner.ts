import type {
  CORE_QUERY_REGRESSION_BASELINE,
  PROVIDER_REGRESSION_BASELINE,
} from "@/lib/benchmarks/baseline";
import {
  CORE_QUERY_REGRESSION_BASELINE as CORE_QUERY_REGRESSION_BASELINE_VALUE,
  PROVIDER_REGRESSION_BASELINE as PROVIDER_REGRESSION_BASELINE_VALUE,
} from "@/lib/benchmarks/baseline";
import { filterBenchmarkDataset } from "@/lib/benchmarks/dataset";
import {
  BenchmarkPresetComparison,
  BenchmarkPresetVariantResult,
  BenchmarkProviderAggregate,
  BenchmarkProviderAttemptSummary,
  BenchmarkProviderQueryResult,
  BenchmarkQueryReport,
  SearchBenchmarkCase,
  SearchBenchmarkReport,
} from "@/lib/benchmarks/types";
import { DEFAULT_COST_SETTINGS } from "@/lib/constants";
import { resolveProviderMode } from "@/lib/config/provider-mode";
import { getSearchCategoryPreset, listSearchCategoryPresets } from "@/lib/search/presets";
import { searchResellOpportunities } from "@/lib/services/search-service";
import {
  CategoryPresetId,
  CostSettings,
  MarketId,
  MarketListing,
  MarketProviderResultSnapshot,
  ProviderMode,
  SearchResponse,
} from "@/lib/types/market";

interface SearchBenchmarkRunnerOptions {
  mode?: ProviderMode | string | null;
  preset?: CategoryPresetId | string | null;
  comparePresets?: boolean;
  ids?: string[];
  tags?: string[];
  maxQueries?: number;
  delayMs?: number;
  limit?: number;
  costs?: Partial<CostSettings>;
}

function resolveRequestedPreset(
  value?: CategoryPresetId | string | null,
): CategoryPresetId | "auto" {
  if (!value || value === "auto") {
    return "auto";
  }

  return listSearchCategoryPresets().some((preset) => preset.id === value)
    ? (value as CategoryPresetId)
    : "auto";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number(
    (values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(3),
  );
}

function sortListingsForProvider(listings: MarketListing[]): MarketListing[] {
  return [...listings].sort((left, right) => {
    if (right.relevanceScore !== left.relevanceScore) {
      return right.relevanceScore - left.relevanceScore;
    }

    return right.confidenceScore - left.confidenceScore;
  });
}

function inferVariantStrategyFromKey(
  variantKey?: string,
): BenchmarkProviderAttemptSummary["strategy"] {
  if (!variantKey) {
    return "unknown";
  }

  if (variantKey.includes("localized")) {
    return "localized_brand_model";
  }

  if (variantKey.includes("brand-alias")) {
    return "brand_alias";
  }

  if (variantKey.includes("model-alias")) {
    return "model_alias";
  }

  if (variantKey.includes("category-alias")) {
    return "category_alias";
  }

  if (variantKey === "original") {
    return "original";
  }

  if (variantKey === "brand-model") {
    return "brand_model";
  }

  if (variantKey === "brand-only") {
    return "brand_only";
  }

  if (variantKey === "model-only") {
    return "model_only";
  }

  if (variantKey === "brand-category") {
    return "brand_category";
  }

  if (variantKey === "core-tokens") {
    return "core_tokens";
  }

  return "unknown";
}

function buildProviderAttempts(snapshot: MarketProviderResultSnapshot): BenchmarkProviderAttemptSummary[] {
  return (snapshot.debug?.attemptedQueries ?? [])
    .map((attempt) => ({
      variantKey: attempt.variantKey,
      variantLabel: attempt.variantLabel,
      strategy: inferVariantStrategyFromKey(attempt.variantKey),
      query: attempt.query,
      status: attempt.status,
      rawResultCount: attempt.rawResultCount,
      normalizedResultCount: attempt.normalizedResultCount ?? 0,
      filteredOutCount: attempt.filteredOutCount ?? 0,
      confidenceScore: attempt.confidenceScore ?? 0,
      usedFallback: attempt.usedFallback,
    }))
    .sort((left, right) => {
      if (right.normalizedResultCount !== left.normalizedResultCount) {
        return right.normalizedResultCount - left.normalizedResultCount;
      }

      if (right.rawResultCount !== left.rawResultCount) {
        return right.rawResultCount - left.rawResultCount;
      }

      return right.confidenceScore - left.confidenceScore;
    });
}

function resolveAttemptStrategy(
  snapshot: MarketProviderResultSnapshot,
  variantKey?: string,
): BenchmarkProviderAttemptSummary["strategy"] {
  void snapshot;
  return inferVariantStrategyFromKey(variantKey);
}

function buildProviderIssues(
  snapshot: MarketProviderResultSnapshot,
  topListing: MarketListing | undefined,
  attempts: BenchmarkProviderAttemptSummary[],
): string[] {
  const issues: string[] = [];

  if (["timeout", "blocked", "error", "parse_error", "parsing_failure"].includes(snapshot.status)) {
    issues.push(`provider status: ${snapshot.status}`);
  }

  if (snapshot.status === "empty") {
    issues.push("no normalized results");
  }

  if (snapshot.debug?.fallbackUsed) {
    issues.push("fallback required");
  }

  if ((topListing?.relevanceScore ?? 0) < 0.42 && snapshot.normalizedItemCount > 0) {
    issues.push("top relevance is low");
  }

  if ((topListing?.confidenceScore ?? 0) < 0.5 && snapshot.normalizedItemCount > 0) {
    issues.push("top confidence is low");
  }

  if (attempts.length > 0 && attempts.every((attempt) => attempt.normalizedResultCount === 0)) {
    issues.push("all query variants failed to normalize");
  }

  return issues;
}

function buildBenchmarkProviderResult(
  market: MarketId,
  snapshot: MarketProviderResultSnapshot,
  listings: MarketListing[],
): BenchmarkProviderQueryResult {
  const providerListings = sortListingsForProvider(
    listings.filter((listing) => listing.sourceMarket === market),
  );
  const topListing = providerListings[0];
  const attempts = buildProviderAttempts(snapshot);
  const bestAttempt = attempts[0];
  const filteredCount =
    attempts.length > 0
      ? attempts.reduce((sum, attempt) => sum + attempt.filteredOutCount, 0)
      : Math.max(snapshot.rawItemCount - snapshot.normalizedItemCount, 0);

  return {
    market,
    status: snapshot.status,
    confidenceScore: snapshot.confidenceScore,
    rawCount: snapshot.rawItemCount,
    normalizedCount: snapshot.normalizedItemCount,
    filteredCount,
    topRelevance: Number((topListing?.relevanceScore ?? 0).toFixed(3)),
    topConfidence: Number((topListing?.confidenceScore ?? 0).toFixed(3)),
    fallbackUsed: snapshot.debug?.fallbackUsed ?? false,
    bestVariantKey: bestAttempt?.variantKey,
    bestVariantLabel: bestAttempt?.variantLabel,
    bestVariantStrategy: resolveAttemptStrategy(snapshot, bestAttempt?.variantKey),
    attempts,
    issues: buildProviderIssues(snapshot, topListing, attempts),
  };
}

function buildQueryIssues(
  benchmarkCase: SearchBenchmarkCase,
  providers: Record<MarketId, BenchmarkProviderQueryResult>,
): string[] {
  const issues: string[] = [];
  const providerResults = Object.values(providers);
  const providersWithResults = providerResults.filter((result) => result.normalizedCount > 0).length;

  if (
    typeof benchmarkCase.minProvidersWithResults === "number" &&
    providersWithResults < benchmarkCase.minProvidersWithResults
  ) {
    issues.push(
      `expected at least ${benchmarkCase.minProvidersWithResults} providers with results, got ${providersWithResults}`,
    );
  }

  providerResults.forEach((providerResult) => {
    if (
      ["timeout", "blocked", "error", "parse_error", "parsing_failure"].includes(
        providerResult.status,
      )
    ) {
      issues.push(`${providerResult.market} status ${providerResult.status}`);
      return;
    }

    if (benchmarkCase.tags.includes("core") && providerResult.normalizedCount === 0) {
      issues.push(`${providerResult.market} returned no normalized results`);
      return;
    }

    if (providerResult.normalizedCount > 0 && providerResult.topConfidence < 0.45) {
      issues.push(`${providerResult.market} top confidence is low`);
    }
  });

  providerResults.forEach((providerResult) => {
    const expectation = benchmarkCase.assertions?.[providerResult.market];

    if (!expectation) {
      return;
    }

    if (
      expectation.allowedStatuses &&
      !expectation.allowedStatuses.includes(providerResult.status)
    ) {
      issues.push(
        `${providerResult.market} status ${providerResult.status} is outside expected range`,
      );
    }

    if (
      typeof expectation.minNormalizedCount === "number" &&
      providerResult.normalizedCount < expectation.minNormalizedCount
    ) {
      issues.push(
        `${providerResult.market} normalized count ${providerResult.normalizedCount} < ${expectation.minNormalizedCount}`,
      );
    }

    if (
      typeof expectation.minTopRelevance === "number" &&
      providerResult.topRelevance < expectation.minTopRelevance
    ) {
      issues.push(
        `${providerResult.market} top relevance ${providerResult.topRelevance} < ${expectation.minTopRelevance}`,
      );
    }

    if (
      typeof expectation.minTopConfidence === "number" &&
      providerResult.topConfidence < expectation.minTopConfidence
    ) {
      issues.push(
        `${providerResult.market} top confidence ${providerResult.topConfidence} < ${expectation.minTopConfidence}`,
      );
    }
  });

  return issues;
}

function buildProviderAggregate(
  market: MarketId,
  queryReports: BenchmarkQueryReport[],
): BenchmarkProviderAggregate {
  const providerResults = queryReports.map((report) => report.providers[market]);
  const variantMap = new Map<
    string,
    {
      variantLabel: string;
      strategy: BenchmarkProviderAttemptSummary["strategy"];
      usageCount: number;
      usefulCount: number;
      normalizedCounts: number[];
      confidences: number[];
    }
  >();

  providerResults.forEach((result) => {
    const key = result.bestVariantKey ?? "none";
    const entry = variantMap.get(key) ?? {
      variantLabel: result.bestVariantLabel ?? "No best variant",
      strategy: result.bestVariantStrategy ?? "unknown",
      usageCount: 0,
      usefulCount: 0,
      normalizedCounts: [],
      confidences: [],
    };
    entry.usageCount += 1;
    if (result.normalizedCount > 0) {
      entry.usefulCount += 1;
    }
    entry.normalizedCounts.push(result.normalizedCount);
    entry.confidences.push(result.topConfidence);
    variantMap.set(key, entry);
  });

  return {
    market,
    successRate: average(
      providerResults.map((result) =>
        result.status === "success" || result.status === "partial" ? 1 : 0,
      ),
    ),
    usefulRate: average(providerResults.map((result) => (result.normalizedCount > 0 ? 1 : 0))),
    blockedRate: average(providerResults.map((result) => (result.status === "blocked" ? 1 : 0))),
    fallbackRate: average(providerResults.map((result) => (result.fallbackUsed ? 1 : 0))),
    averageRawCount: average(providerResults.map((result) => result.rawCount)),
    averageNormalizedCount: average(providerResults.map((result) => result.normalizedCount)),
    averageFilteredCount: average(providerResults.map((result) => result.filteredCount)),
    averageTopRelevance: average(providerResults.map((result) => result.topRelevance)),
    averageTopConfidence: average(providerResults.map((result) => result.topConfidence)),
    lowConfidenceQueryIds: queryReports
      .filter((report) => report.providers[market].topConfidence < 0.5)
      .map((report) => report.id),
    weakQueryIds: queryReports
      .filter(
        (report) =>
          report.providers[market].normalizedCount === 0 ||
          report.providers[market].issues.length > 0,
      )
      .map((report) => report.id),
    variantLeaderboard: [...variantMap.entries()]
      .map(([variantKey, entry]) => ({
        variantKey,
        variantLabel: entry.variantLabel,
        strategy: entry.strategy,
        usageCount: entry.usageCount,
        usefulCount: entry.usefulCount,
        averageNormalizedCount: average(entry.normalizedCounts),
        averageConfidence: average(entry.confidences),
      }))
      .sort((left, right) => {
        if (right.usefulCount !== left.usefulCount) {
          return right.usefulCount - left.usefulCount;
        }

        return right.averageNormalizedCount - left.averageNormalizedCount;
      }),
  };
}

function getPresetLabel(preset: CategoryPresetId | "auto"): string {
  return preset === "auto" ? "auto" : getSearchCategoryPreset(preset).label;
}

function buildPresetVariantResult(
  response: SearchResponse,
  selectedPreset: CategoryPresetId | "auto",
): BenchmarkPresetVariantResult {
  const providers = response.marketResults.filter((result) => result.normalizedItemCount > 0);
  const providerListings = (market: MarketId) =>
    sortListingsForProvider(response.listings.filter((listing) => listing.sourceMarket === market))[0];

  return {
    selectedPreset,
    appliedPresetId: response.queryPlan.presetId,
    appliedPresetSource: response.queryPlan.presetSource,
    normalizedResultTotal: response.marketResults.reduce(
      (sum, result) => sum + result.normalizedItemCount,
      0,
    ),
    providersWithResults: providers.length,
    averageTopRelevance: average(
      providers.map((provider) => providerListings(provider.sourceMarket)?.relevanceScore ?? 0),
    ),
    averageTopConfidence: average(
      providers.map((provider) => providerListings(provider.sourceMarket)?.confidenceScore ?? 0),
    ),
    recommendationScore: response.recommendation.recommendationScore,
    recommendationGrade: response.recommendation.recommendationGrade,
    bestMarket: response.recommendation.bestResaleMarket,
  };
}

function comparePresetVariants(
  left: BenchmarkPresetVariantResult,
  right: BenchmarkPresetVariantResult,
): number {
  if (right.providersWithResults !== left.providersWithResults) {
    return right.providersWithResults - left.providersWithResults;
  }

  if (right.normalizedResultTotal !== left.normalizedResultTotal) {
    return right.normalizedResultTotal - left.normalizedResultTotal;
  }

  if (right.averageTopRelevance !== left.averageTopRelevance) {
    return right.averageTopRelevance - left.averageTopRelevance;
  }

  if (right.averageTopConfidence !== left.averageTopConfidence) {
    return right.averageTopConfidence - left.averageTopConfidence;
  }

  return right.recommendationScore - left.recommendationScore;
}

function buildPresetComparisonNotes(
  benchmarkCase: SearchBenchmarkCase,
  variants: BenchmarkPresetVariantResult[],
): string[] {
  const notes: string[] = [];
  const sorted = [...variants].sort(comparePresetVariants);
  const best = sorted[0];
  const autoVariant = variants.find((variant) => variant.selectedPreset === "auto");
  const recommendedVariant = benchmarkCase.recommendedPreset
    ? variants.find((variant) => variant.selectedPreset === benchmarkCase.recommendedPreset)
    : undefined;

  if (best && best.selectedPreset !== "auto") {
    notes.push(
      `auto蹂대떎 ${getPresetLabel(best.selectedPreset)} preset?????믪? 而ㅻ쾭由ъ?/?뺥솗?꾨? 蹂댁??듬땲??`,
    );
  }

  if (
    autoVariant &&
    best &&
    best.selectedPreset !== "auto" &&
    best.normalizedResultTotal > autoVariant.normalizedResultTotal
  ) {
    notes.push(
      `${getPresetLabel(best.selectedPreset)} preset??auto ?鍮??뺢퇋??寃곌낵瑜?${best.normalizedResultTotal - autoVariant.normalizedResultTotal}嫄????뺣낫?덉뒿?덈떎.`,
    );
  }

  if (
    benchmarkCase.recommendedPreset &&
    recommendedVariant &&
    recommendedVariant.selectedPreset === best?.selectedPreset
  ) {
    notes.push(
      `??寃?됱뼱??沅뚯옣 preset(${getPresetLabel(benchmarkCase.recommendedPreset)})???ㅼ젣濡쒕룄 媛????留욎븯?듬땲??`,
    );
  }

  if (
    benchmarkCase.recommendedPreset &&
    recommendedVariant &&
    recommendedVariant.selectedPreset !== best?.selectedPreset
  ) {
    notes.push(
      `沅뚯옣 preset(${getPresetLabel(benchmarkCase.recommendedPreset)})蹂대떎 ${getPresetLabel(best!.selectedPreset)} preset ?깅뒫????醫뗭븯?듬땲??`,
    );
  }

  return notes;
}

function buildPresetComparison(
  benchmarkCase: SearchBenchmarkCase,
  autoResponse: SearchResponse | null,
  explicitPresetResponses: Array<{ selectedPreset: CategoryPresetId; response: SearchResponse }>,
): BenchmarkPresetComparison | undefined {
  const variants = [
    ...(autoResponse ? [buildPresetVariantResult(autoResponse, "auto")] : []),
    ...explicitPresetResponses.map(({ selectedPreset, response }) =>
      buildPresetVariantResult(response, selectedPreset),
    ),
  ];

  if (variants.length === 0) {
    return undefined;
  }

  const sorted = [...variants].sort(comparePresetVariants);
  const best = sorted[0];

  return {
    recommendedPreset: benchmarkCase.recommendedPreset,
    bestPreset: best?.selectedPreset ?? "auto",
    notes: buildPresetComparisonNotes(benchmarkCase, variants),
    variants,
  };
}

function buildTuningPriorities(
  queryReports: BenchmarkQueryReport[],
  providerSummary: Record<MarketId, BenchmarkProviderAggregate>,
): string[] {
  const priorities: string[] = [];
  const mercariJapaneseWeak = queryReports.filter(
    (report) =>
      (report.tags.includes("japanese") || report.tags.includes("mixed-lang")) &&
      report.providers.mercari.normalizedCount === 0,
  );
  const bunjangModelOnlyWeak = queryReports.filter(
    (report) =>
      (report.tags.includes("abbrev") || report.tags.includes("brand-model")) &&
      report.providers.bunjang.bestVariantStrategy === "model_only" &&
      report.providers.bunjang.normalizedCount === 0,
  );
  const fruitsLowConfidence = providerSummary.fruitsfamily.lowConfidenceQueryIds.length;
  const presetBetterThanAuto = queryReports.filter(
    (report) =>
      report.presetComparison &&
      report.presetComparison.bestPreset !== "auto",
  );
  const cameraPresetWins = queryReports.filter(
    (report) =>
      report.presetComparison?.bestPreset === "camera" &&
      report.tags.includes("camera"),
  ).length;
  const furniturePresetWins = queryReports.filter(
    (report) =>
      report.presetComparison?.bestPreset === "vintage_furniture" &&
      report.tags.includes("furniture"),
  ).length;

  if (mercariJapaneseWeak.length >= 2) {
    priorities.push(
      `Mercari ?쇰낯??alias ?뺤옣???곗꽑?낅땲?? ?쇰낯???쇳빀 寃?됱뼱 ${mercariJapaneseWeak.length}嫄댁뿉??寃곌낵媛 ?쏀뻽?듬땲??`,
    );
  }

  if (providerSummary.mercari.fallbackRate > 0.55) {
    priorities.push(
      "Mercari??fallback ?섏〈?꾧? ?믪뒿?덈떎. localized brand/model variant ?쒖꽌瑜????욌떦湲곌굅???쇰낯??蹂꾩묶 ?ъ쟾??蹂닿컯?대낫?몄슂.",
    );
  }

  if (bunjangModelOnlyWeak.length >= 1 || providerSummary.bunjang.fallbackRate > 0.5) {
    priorities.push(
      "踰덇컻?ν꽣??紐⑤뜽紐??⑤룆 ?먮뒗 異뺤빟??寃?됱씠 ?쏀빀?덈떎. brand + model 議고빀怨??쒓? 蹂꾩묶 ?곗꽑?쒖쐞瑜????믪씠???몄씠 醫뗭뒿?덈떎.",
    );
  }

  if (fruitsLowConfidence >= Math.max(2, Math.ceil(queryReports.length * 0.25))) {
    priorities.push(
      "FruitsFamily ?곸쐞 寃곌낵 confidence媛 ??? ?몄엯?덈떎. 釉뚮옖??異붿텧怨?title normalization 洹쒖튃??癒쇱? 蹂닿컯?대낫?몄슂.",
    );
  }

  if (presetBetterThanAuto.length >= Math.max(2, Math.ceil(queryReports.length * 0.2))) {
    priorities.push(
      `auto preset蹂대떎 ?섎룞 preset?????섏? 寃?됱뼱媛 ${presetBetterThanAuto.length}嫄??덉뒿?덈떎. query detection 洹쒖튃怨?alias mapping???ㅼ떆 議곗젙?대낵 媛移섍? ?쎈땲??`,
    );
  }

  if (cameraPresetWins >= 1) {
    priorities.push(
      `camera preset??移대찓??荑쇰━ ${cameraPresetWins}嫄댁뿉??媛??醫뗭? 寃곌낵瑜??덉뒿?덈떎. ?レ옄 紐⑤뜽 ?좏겙 蹂댁〈 洹쒖튃??移대찓??alias 履쎌뿉?????뺤옣?대낫?몄슂.`,
    );
  }

  if (furniturePresetWins >= 1) {
    priorities.push(
      `vintage_furniture preset??媛援?荑쇰━ ${furniturePresetWins}嫄댁뿉???곗꽭?덉뒿?덈떎. ?쇱씤紐?泥댁뼱/?뚯씠釉?移댄뀒怨좊━ alias瑜????섎━硫??④낵媛 ?????덉뒿?덈떎.`,
    );
  }

  if (priorities.length === 0) {
    priorities.push(
      "?꾩옱 踰ㅼ튂留덊겕?먯꽌????蹂묐ぉ??蹂댁씠吏 ?딆뒿?덈떎. weak query? preset comparison??湲곗??쇰줈 alias瑜?誘몄꽭 議곗젙?섎㈃ 醫뗭뒿?덈떎.",
    );
  }

  return priorities;
}

function buildRegressionReport(
  queryReports: BenchmarkQueryReport[],
  providerSummary: Record<MarketId, BenchmarkProviderAggregate>,
): SearchBenchmarkReport["regression"] {
  const regressions: string[] = [];
  const warnings: string[] = [];

  (Object.keys(providerSummary) as MarketId[]).forEach((market) => {
    const baseline = PROVIDER_REGRESSION_BASELINE_VALUE[market];
    const summary = providerSummary[market];

    if (summary.usefulRate < baseline.minUsefulRate) {
      regressions.push(
        `${market} usefulRate ${summary.usefulRate} dropped below ${baseline.minUsefulRate}`,
      );
    }

    if (summary.averageTopRelevance < baseline.minAverageTopRelevance) {
      regressions.push(
        `${market} averageTopRelevance ${summary.averageTopRelevance} dropped below ${baseline.minAverageTopRelevance}`,
      );
    }

    if (summary.averageTopConfidence < baseline.minAverageTopConfidence) {
      warnings.push(
        `${market} averageTopConfidence ${summary.averageTopConfidence} is lower than ${baseline.minAverageTopConfidence}`,
      );
    }

    if (summary.blockedRate > baseline.maxBlockedRate) {
      warnings.push(
        `${market} blockedRate ${summary.blockedRate} is higher than ${baseline.maxBlockedRate}`,
      );
    }
  });

  queryReports.forEach((report) => {
    const baseline = CORE_QUERY_REGRESSION_BASELINE_VALUE[report.id];
    if (!baseline) {
      return;
    }

    const providersWithResults = Object.values(report.providers).filter(
      (provider) => provider.normalizedCount > 0,
    ).length;

    if (providersWithResults < baseline.minProvidersWithResults) {
      regressions.push(
        `${report.id} only returned results from ${providersWithResults} providers (expected ${baseline.minProvidersWithResults})`,
      );
    }
  });

  return {
    regressions,
    warnings,
  };
}

function createBenchmarkQueryReport(
  benchmarkCase: SearchBenchmarkCase,
  response: SearchResponse,
  presetComparison?: BenchmarkPresetComparison,
): BenchmarkQueryReport {
  const providers = Object.fromEntries(
    response.marketResults.map((snapshot) => [
      snapshot.sourceMarket,
      buildBenchmarkProviderResult(snapshot.sourceMarket, snapshot, response.listings),
    ]),
  ) as Record<MarketId, BenchmarkProviderQueryResult>;

  const issues = buildQueryIssues(benchmarkCase, providers);

  return {
    id: benchmarkCase.id,
    label: benchmarkCase.label,
    query: benchmarkCase.query,
    tags: benchmarkCase.tags,
    recommendedPreset: benchmarkCase.recommendedPreset,
    appliedPresetId: response.queryPlan.presetId,
    appliedPresetSource: response.queryPlan.presetSource,
    normalizedQuery: response.queryPlan.normalized,
    aliasMatches: response.queryPlan.aliasMatches,
    alternativeQueries: response.alternativeQueries,
    providers,
    issues,
    overallConfidence: average(Object.values(providers).map((provider) => provider.confidenceScore)),
    presetComparison,
  };
}

async function runSearchForBenchmark(
  query: string,
  costs: CostSettings,
  mode: ProviderMode,
  limit: number,
  preset?: CategoryPresetId | string | null,
): Promise<SearchResponse> {
  return searchResellOpportunities(query, costs, {
    mode,
    limit,
    preset,
  });
}

export async function runSearchBenchmarks(
  options: SearchBenchmarkRunnerOptions = {},
): Promise<SearchBenchmarkReport> {
  const mode = resolveProviderMode(options.mode ?? "real");
  const selectedCases = filterBenchmarkDataset({
    ids: options.ids,
    tags: options.tags,
    maxQueries: options.maxQueries,
  });
  const costs: CostSettings = {
    ...DEFAULT_COST_SETTINGS,
    ...(options.costs ?? {}),
  };
  const delayMs = options.delayMs ?? 300;
  const limit = options.limit ?? 24;
  const selectedPreset = resolveRequestedPreset(options.preset);
  const comparePresets = Boolean(options.comparePresets);
  const presetIds = listSearchCategoryPresets().map((preset) => preset.id);
  const queryReports: BenchmarkQueryReport[] = [];

  for (const [index, benchmarkCase] of selectedCases.entries()) {
    const baseResponse = await runSearchForBenchmark(
      benchmarkCase.query,
      costs,
      mode,
      limit,
      selectedPreset === "auto" ? undefined : selectedPreset,
    );

    let presetComparison: BenchmarkPresetComparison | undefined;

    if (comparePresets) {
      const autoResponse =
        selectedPreset === "auto"
          ? baseResponse
          : await runSearchForBenchmark(benchmarkCase.query, costs, mode, limit);
      const explicitPresetResponses: Array<{
        selectedPreset: CategoryPresetId;
        response: SearchResponse;
      }> = [];

      for (const presetId of presetIds) {
        if (selectedPreset !== "auto" && presetId === selectedPreset) {
          explicitPresetResponses.push({
            selectedPreset: presetId,
            response: baseResponse,
          });
          continue;
        }

        if (selectedPreset === "auto" && presetId === baseResponse.queryPlan.presetId) {
          explicitPresetResponses.push({
            selectedPreset: presetId,
            response: await runSearchForBenchmark(
              benchmarkCase.query,
              costs,
              mode,
              limit,
              presetId,
            ),
          });
          continue;
        }

        explicitPresetResponses.push({
          selectedPreset: presetId,
          response: await runSearchForBenchmark(
            benchmarkCase.query,
            costs,
            mode,
            limit,
            presetId,
          ),
        });
      }

      presetComparison = buildPresetComparison(
        benchmarkCase,
        autoResponse,
        explicitPresetResponses,
      );
    }

    queryReports.push(
      createBenchmarkQueryReport(benchmarkCase, baseResponse, presetComparison),
    );

    if (delayMs > 0 && index < selectedCases.length - 1) {
      await sleep(delayMs);
    }
  }

  const providerSummary = {
    mercari: buildProviderAggregate("mercari", queryReports),
    bunjang: buildProviderAggregate("bunjang", queryReports),
    fruitsfamily: buildProviderAggregate("fruitsfamily", queryReports),
  } as Record<MarketId, BenchmarkProviderAggregate>;
  const regression = buildRegressionReport(queryReports, providerSummary);

  return {
    generatedAt: new Date().toISOString(),
    mode,
    selectedPreset,
    comparePresets,
    selectedQueryIds: selectedCases.map((entry) => entry.id),
    selectedTags: options.tags ?? [],
    queryCount: selectedCases.length,
    providerSummary,
    queryReports,
    tuningPriorities: buildTuningPriorities(queryReports, providerSummary),
    regression,
  };
}


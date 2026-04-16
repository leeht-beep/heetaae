import type {
  AliasLanguage,
  CategoryPresetId,
  MarketId,
  SearchQueryAliasMatch,
  SearchQueryPlan,
  SearchQueryVariant,
} from "@/lib/types/market";
import {
  BRAND_ALIAS_DICTIONARY,
  CATEGORY_ALIAS_DICTIONARY,
  MODEL_ALIAS_DICTIONARY,
  findAliasEntryByCanonical,
  findBestAliasMatch,
  getLocalizedAliasCandidates,
  getPreferredLanguagesForMarket,
} from "@/lib/search/alias-dictionary";
import type { AliasDictionaryEntry } from "@/lib/search/alias-dictionary";
import {
  getPresetStrategyRank,
  getSearchCategoryPreset,
  resolveCategoryPreset,
} from "@/lib/search/presets";
import { removeNoisePhrases, tokenize } from "@/lib/utils/normalize";

const SEASON_PATTERN = /\b(?:fw|ss|aw|fa|sp)\s?\d{2,4}\b|\b\d{2}(?:fw|ss|aw|fa|sp)\b/iu;
const SIZE_PATTERN =
  /\b(?:XXXL|XXL|XL|L|M|S|XS|OS|O\/S|FREE|ONE\s*SIZE|\d{2,3}(?:\.\d)?(?:cm|mm)?)\b/iu;

function lower(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function cleanupQuery(query: string): string {
  return removeNoisePhrases(query.normalize("NFKC"))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLanguageHints(query: string): Array<AliasLanguage | "mixed"> {
  const hasKo = /[\uac00-\ud7a3]/.test(query);
  const hasJa = /[\u3040-\u30ff\u4e00-\u9faf]/.test(query);
  const hasEn = /[a-z]/i.test(query);
  const hints: AliasLanguage[] = [];

  if (hasKo) {
    hints.push("ko");
  }

  if (hasJa) {
    hints.push("ja");
  }

  if (hasEn) {
    hints.push("en");
  }

  return hints.length > 1 ? [...hints, "mixed"] : hints;
}

function buildAliasMatch(
  kind: SearchQueryAliasMatch["kind"],
  entry: AliasDictionaryEntry | undefined,
  matchedAlias?: string,
): SearchQueryAliasMatch[] {
  if (!entry || !matchedAlias) {
    return [];
  }

  return [
    {
      kind,
      key: entry.key,
      canonical: entry.canonical,
      matchedAlias,
    },
  ];
}

function buildVariant(options: {
  key: string;
  label: string;
  strategy: SearchQueryVariant["strategy"];
  query: string;
  confidence: number;
  providerTargets: Array<MarketId | "shared">;
  languages?: AliasLanguage[];
}): SearchQueryVariant | null {
  const cleaned = cleanupQuery(options.query);
  const tokens = tokenize(cleaned);

  if (!cleaned || tokens.length === 0) {
    return null;
  }

  return {
    key: options.key,
    label: options.label,
    strategy: options.strategy,
    query: cleaned,
    confidence: options.confidence,
    tokens,
    providerTargets: options.providerTargets,
    languages: options.languages,
  };
}

function pushVariant(target: SearchQueryVariant[], variant: SearchQueryVariant | null) {
  if (!variant) {
    return;
  }

  const normalizedQuery = lower(variant.query);

  if (target.some((entry) => lower(entry.query) === normalizedQuery)) {
    return;
  }

  target.push(variant);
}

function sortVariantsForMercari(variants: SearchQueryVariant[]): SearchQueryVariant[] {
  const priorityByStrategy: Partial<Record<SearchQueryVariant["strategy"], number>> = {
    original: 0,
    brand_model: 1,
    brand_category: 2,
    model_only: 3,
    brand_only: 4,
    core_tokens: 5,
    localized_brand_model: 6,
    brand_alias: 7,
    model_alias: 8,
    category_alias: 9,
  };

  return [...variants].sort((left, right) => {
    const leftRank = priorityByStrategy[left.strategy] ?? 50;
    const rightRank = priorityByStrategy[right.strategy] ?? 50;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return right.confidence - left.confidence;
  });
}

function buildJoinedQuery(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function buildSuggestionCandidates(values: Array<string | undefined>, compact: string): string[] {
  return uniq(
    values.filter((value): value is string => Boolean(value && lower(value) !== compact)),
  ).slice(0, 6);
}

function sortVariantsForPreset(
  presetId: CategoryPresetId,
  variants: SearchQueryVariant[],
): SearchQueryVariant[] {
  return [...variants].sort((left, right) => {
    const leftRank = getPresetStrategyRank(presetId, left.strategy);
    const rightRank = getPresetStrategyRank(presetId, right.strategy);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return right.confidence - left.confidence;
  });
}

function applyPresetConfidenceBoost(
  presetId: CategoryPresetId,
  strategy: SearchQueryVariant["strategy"],
  confidence: number,
): number {
  const rank = getPresetStrategyRank(presetId, strategy);
  const boosted =
    confidence +
    (rank === 0 ? 0.04 : rank === 1 ? 0.025 : rank <= 3 ? 0.01 : 0);

  return Number(Math.max(0, Math.min(1, boosted)).toFixed(3));
}

function buildLocalizedBrandModelQuery(
  brandEntry: AliasDictionaryEntry | undefined,
  modelEntry: AliasDictionaryEntry | undefined,
  categoryEntry: AliasDictionaryEntry | undefined,
  fallbackBrand: string | undefined,
  fallbackModel: string | undefined,
  fallbackCategory: string | undefined,
  season: string | undefined,
  market: MarketId,
): { query: string; languages: AliasLanguage[] } | null {
  const languages = getPreferredLanguagesForMarket(market);
  const localizedBrand = getLocalizedAliasCandidates(brandEntry, languages)[0] ?? fallbackBrand;
  const localizedModel = getLocalizedAliasCandidates(modelEntry, languages)[0] ?? fallbackModel;
  const localizedCategory =
    getLocalizedAliasCandidates(categoryEntry, languages)[0] ?? fallbackCategory;
  const query = buildJoinedQuery([
    localizedBrand,
    localizedModel ?? undefined,
    !localizedModel ? localizedCategory : undefined,
    season,
  ]);

  return query ? { query, languages } : null;
}

export function preprocessSearchQuery(
  query: string,
  options: { presetId?: CategoryPresetId | string | null } = {},
): SearchQueryPlan {
  const cleaned = cleanupQuery(query);
  const compact = lower(cleaned);
  const tokens = tokenize(cleaned);
  const languageHints = detectLanguageHints(cleaned);
  const brandMatch = findBestAliasMatch(cleaned, BRAND_ALIAS_DICTIONARY);
  const modelMatch = findBestAliasMatch(cleaned, MODEL_ALIAS_DICTIONARY);
  const categoryMatch = findBestAliasMatch(cleaned, CATEGORY_ALIAS_DICTIONARY);
  const aliasMatches: SearchQueryAliasMatch[] = [
    ...buildAliasMatch("brand", brandMatch?.entry, brandMatch?.matchedAlias),
    ...buildAliasMatch("model", modelMatch?.entry, modelMatch?.matchedAlias),
    ...buildAliasMatch("category", categoryMatch?.entry, categoryMatch?.matchedAlias),
  ];
  const presetResolution = resolveCategoryPreset(
    cleaned,
    tokens,
    aliasMatches,
    options.presetId,
  );
  const preset = presetResolution.preset;
  const size = cleaned.match(SIZE_PATTERN)?.[0];
  const season = cleaned.match(SEASON_PATTERN)?.[0]?.replace(/\s+/g, "").toUpperCase();
  const exclusionSet = new Set([
    ...tokenize(brandMatch?.entry.canonical ?? ""),
    ...tokenize(modelMatch?.entry.canonical ?? ""),
    ...tokenize(categoryMatch?.entry.canonical ?? ""),
    ...(size ? tokenize(size) : []),
    ...(season ? tokenize(season) : []),
  ]);
  const coreTokens = tokens.filter((token) => !exclusionSet.has(token));
  const brand = brandMatch?.entry.canonical;
  const derivedModel = coreTokens.slice(0, 6).join(" ");
  const model = modelMatch?.entry.canonical ?? (derivedModel || undefined);
  const category = categoryMatch?.entry.canonical;
  const variants: SearchQueryVariant[] = [];

  pushVariant(
    variants,
    buildVariant({
      key: "original",
      label: "Original",
      strategy: "original",
      query: cleaned,
      confidence: applyPresetConfidenceBoost(preset.id, "original", 1),
      providerTargets: ["shared"],
      languages: languageHints.filter((entry): entry is AliasLanguage => entry !== "mixed"),
    }),
  );
  pushVariant(
    variants,
    buildVariant({
      key: "brand-model",
      label: "Brand + Model",
      strategy: "brand_model",
      query: buildJoinedQuery([brand, model, season]),
      confidence: applyPresetConfidenceBoost(preset.id, "brand_model", 0.95),
      providerTargets: ["shared"],
    }),
  );
  pushVariant(
    variants,
    buildVariant({
      key: "brand-category",
      label: "Brand + Category",
      strategy: "brand_category",
      query: buildJoinedQuery([brand, category, season]),
      confidence: applyPresetConfidenceBoost(preset.id, "brand_category", 0.84),
      providerTargets: ["shared"],
    }),
  );
  pushVariant(
    variants,
    buildVariant({
      key: "brand-only",
      label: "Brand only",
      strategy: "brand_only",
      query: brand ?? "",
      confidence: applyPresetConfidenceBoost(preset.id, "brand_only", 0.78),
      providerTargets: ["shared"],
    }),
  );
  pushVariant(
    variants,
    buildVariant({
      key: "model-only",
      label: "Model only",
      strategy: "model_only",
      query: model ?? "",
      confidence: applyPresetConfidenceBoost(preset.id, "model_only", 0.82),
      providerTargets: ["shared"],
    }),
  );
  pushVariant(
    variants,
    buildVariant({
      key: "core-tokens",
      label: "Core tokens",
      strategy: "core_tokens",
      query: coreTokens.slice(0, 5).join(" "),
      confidence: applyPresetConfidenceBoost(preset.id, "core_tokens", 0.72),
      providerTargets: ["shared"],
    }),
  );

  const localizedKorean = buildLocalizedBrandModelQuery(
    brandMatch?.entry,
    modelMatch?.entry,
    categoryMatch?.entry,
    brand,
    model,
    category,
    season,
    "bunjang",
  );
  const localizedJapanese = buildLocalizedBrandModelQuery(
    brandMatch?.entry,
    modelMatch?.entry,
    categoryMatch?.entry,
    brand,
    model,
    category,
    season,
    "mercari",
  );

  const alternativeSuggestions = buildSuggestionCandidates(
    [
      variants.find((variant) => variant.key === "brand-model")?.query,
      variants.find((variant) => variant.key === "brand-only")?.query,
      variants.find((variant) => variant.key === "model-only")?.query,
      localizedKorean?.query,
      localizedJapanese?.query,
      brand,
      model,
    ],
    compact,
  );

  const sortedVariants = sortVariantsForPreset(preset.id, variants);

  return {
    original: query.trim(),
    normalized: cleaned,
    compact,
    tokens,
    presetId: preset.id,
    presetSource: presetResolution.source,
    brand,
    model,
    category,
    size,
    season,
    languageHints,
    aliasMatches,
    variants: sortedVariants,
    alternativeSuggestions,
  };
}

export function buildProviderQueryVariants(
  plan: SearchQueryPlan,
  market: MarketId,
): SearchQueryVariant[] {
  const preset = getSearchCategoryPreset(plan.presetId);
  const brandEntry = findAliasEntryByCanonical(BRAND_ALIAS_DICTIONARY, plan.brand);
  const modelEntry = findAliasEntryByCanonical(MODEL_ALIAS_DICTIONARY, plan.model);
  const categoryEntry = findAliasEntryByCanonical(CATEGORY_ALIAS_DICTIONARY, plan.category);
  const localized = buildLocalizedBrandModelQuery(
    brandEntry,
    modelEntry,
    categoryEntry,
    plan.brand,
    plan.model,
    plan.category,
    plan.season,
    market,
  );
  const preferredLanguages = getPreferredLanguagesForMarket(market);
  const result: SearchQueryVariant[] = [];
  const originalLanguages = plan.languageHints.filter(
    (entry): entry is AliasLanguage => entry !== "mixed",
  );
  const shouldPrioritizeLocalized =
    market !== "mercari" &&
    localized &&
    localized.query &&
    !preferredLanguages.some((language) => originalLanguages.includes(language));

  if (shouldPrioritizeLocalized && localized) {
    pushVariant(
      result,
      buildVariant({
        key: `${market}-localized-brand-model`,
        label: "Localized brand + model",
        strategy: "localized_brand_model",
        query: localized.query,
        confidence: applyPresetConfidenceBoost(preset.id, "localized_brand_model", 0.99),
        providerTargets: [market],
        languages: localized.languages,
      }),
    );
  }

  plan.variants.forEach((variant) => {
    if (variant.providerTargets.includes("shared") || variant.providerTargets.includes(market)) {
      pushVariant(result, { ...variant });
    }
  });

  if (!shouldPrioritizeLocalized && localized) {
    pushVariant(
      result,
      buildVariant({
        key: `${market}-localized-brand-model`,
        label: market === "mercari" ? "Localized brand + model (JP)" : "Localized brand + model",
        strategy: "localized_brand_model",
        query: localized.query,
        confidence: applyPresetConfidenceBoost(
          preset.id,
          "localized_brand_model",
          market === "mercari" ? 0.96 : 0.91,
        ),
        providerTargets: [market],
        languages: localized.languages,
      }),
    );
  }

  const localizedBrandCandidates = getLocalizedAliasCandidates(brandEntry, preferredLanguages);
  localizedBrandCandidates.forEach((alias, index) => {
    pushVariant(
      result,
      buildVariant({
        key: `${market}-brand-alias-${index + 1}`,
        label: market === "mercari" ? "Brand alias (JP)" : "Brand alias",
        strategy: "brand_alias",
        query: buildJoinedQuery([alias, plan.model, plan.season]),
        confidence: applyPresetConfidenceBoost(
          preset.id,
          "brand_alias",
          market === "mercari" ? 0.9 : 0.84,
        ),
        providerTargets: [market],
        languages: preferredLanguages,
      }),
    );
  });

  const localizedModelCandidates = getLocalizedAliasCandidates(modelEntry, preferredLanguages);
  localizedModelCandidates.forEach((alias, index) => {
    pushVariant(
      result,
      buildVariant({
        key: `${market}-model-alias-${index + 1}`,
        label: market === "mercari" ? "Model alias (JP)" : "Model alias",
        strategy: "model_alias",
        query: buildJoinedQuery([plan.brand, alias, plan.season]),
        confidence: applyPresetConfidenceBoost(
          preset.id,
          "model_alias",
          market === "mercari" ? 0.88 : 0.82,
        ),
        providerTargets: [market],
        languages: preferredLanguages,
      }),
    );
  });

  const localizedCategoryCandidates = getLocalizedAliasCandidates(
    categoryEntry,
    preferredLanguages,
  );
  localizedCategoryCandidates.forEach((alias, index) => {
    pushVariant(
      result,
      buildVariant({
        key: `${market}-category-alias-${index + 1}`,
        label: market === "mercari" ? "Category alias (JP)" : "Category alias",
        strategy: "category_alias",
        query: buildJoinedQuery([plan.brand, plan.model, alias, plan.season]),
        confidence: applyPresetConfidenceBoost(preset.id, "category_alias", 0.74),
        providerTargets: [market],
        languages: preferredLanguages,
      }),
    );
  });

  return market === "mercari"
    ? sortVariantsForMercari(result)
    : sortVariantsForPreset(preset.id, result);
}

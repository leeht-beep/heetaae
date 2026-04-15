import {
  CurrencyCode,
  ListingType,
  MarketId,
  MarketListing,
  NormalizationEnvelope,
  ProviderErrorInfo,
  ProviderExecutionStatus,
  SearchQueryPlan,
} from "@/lib/types/market";
import {
  buildNormalizedName,
  buildRelatedKeywords,
  computeRelevanceScore,
  containsNoiseTerm,
  extractListingSignals,
  matchesSearchQuery,
  normalizeText,
} from "@/lib/utils/normalize";

export interface NormalizedListingDraft {
  id?: string;
  title?: string;
  price?: number | null;
  currency?: CurrencyCode;
  imageUrl?: string;
  itemUrl?: string;
  listedAt?: string;
  soldAt?: string;
  listingType?: ListingType;
  size?: string;
  brand?: string;
  model?: string;
  season?: string;
  category?: string;
  relatedKeywords?: string[];
  collectedQuery?: string;
  queryVariantKey?: string;
  rawConfidence?: number;
}

interface NormalizeRawItemsOptions<TRawItem> {
  market: MarketId;
  label: string;
  query: string;
  queryPlan: SearchQueryPlan;
  rawItems: TRawItem[];
  minRelevanceScore: number;
  mapRawItem: (rawItem: TRawItem, index: number) => NormalizedListingDraft;
}

function safeString(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeDate(value: string | null | undefined): string | undefined {
  const trimmed = safeString(value);

  if (!trimmed) {
    return undefined;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isValidHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveImageUrl(value: string | undefined, market: MarketId): string {
  if (isValidHttpUrl(value)) {
    return value as string;
  }

  return `https://picsum.photos/seed/${market}-placeholder/480/480`;
}

function resolveListingType(
  value: ListingType | undefined,
  soldAt?: string,
): ListingType {
  if (value) {
    return value;
  }

  return soldAt ? "sold" : "active";
}

function resolveRequiredString(value: string | undefined, fallback: string): string {
  return safeString(value) ?? fallback;
}

function inferFallbackBrand(title: string): string | undefined {
  const tokens = title.trim().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return undefined;
  }

  if (tokens[0]?.toLowerCase() === "new" && tokens[1]) {
    return `${tokens[0]} ${tokens[1]}`;
  }

  return tokens[0];
}

function calculateFieldCompleteness(listing: MarketListing): number {
  const checks = [
    Boolean(listing.title),
    Boolean(listing.price),
    Boolean(listing.currency),
    isValidHttpUrl(listing.imageUrl),
    isValidHttpUrl(listing.itemUrl),
    Boolean(listing.listedAt),
    listing.brand !== "Unknown",
    listing.model !== "Unknown",
    listing.category !== "uncategorized",
  ];

  return checks.filter(Boolean).length / checks.length;
}

function calculateListingConfidence(listing: MarketListing, rawConfidence?: number): number {
  const completeness = calculateFieldCompleteness(listing);
  const dateBonus = listing.dateConfidence === "observed" ? 1 : 0.55;
  const base =
    completeness * 0.42 +
    listing.relevanceScore * 0.38 +
    dateBonus * 0.12 +
    Math.min((listing.relatedKeywords.length || 0) / 6, 1) * 0.04 +
    (rawConfidence ?? 0.72) * 0.04;

  return Number(Math.min(1, Math.max(0, base)).toFixed(3));
}

function finalizeListing(
  market: MarketId,
  queryPlan: SearchQueryPlan,
  draft: NormalizedListingDraft,
  index: number,
): MarketListing | null {
  const title = safeString(draft.title);
  const price = typeof draft.price === "number" && Number.isFinite(draft.price) ? draft.price : null;
  const currency = draft.currency;
  const itemUrl = safeString(draft.itemUrl);
  const imageUrl = safeString(draft.imageUrl);

  if (!title || !price || !currency || !itemUrl || !isValidHttpUrl(itemUrl)) {
    return null;
  }

  if (containsNoiseTerm(title, queryPlan.presetId)) {
    return null;
  }

  const soldAt = safeDate(draft.soldAt);
  const observedListedAt = safeDate(draft.listedAt);
  const listedAt = observedListedAt ?? soldAt ?? new Date().toISOString();
  const relatedKeywords = draft.relatedKeywords?.filter(Boolean) ?? [];
  const listingSignals = extractListingSignals({
    title,
    brand: draft.brand,
    model: draft.model,
    season: draft.season,
    category: draft.category,
    size: draft.size,
    relatedKeywords,
  }, queryPlan.presetId);
  const brand = resolveRequiredString(
    safeString(draft.brand) ?? inferFallbackBrand(title),
    "Unknown",
  );
  const model = resolveRequiredString(
    safeString(draft.model) ??
      (listingSignals.modelTokens.length > 0
        ? listingSignals.modelTokens.slice(0, 6).join(" ")
        : undefined),
    "Unknown",
  );
  const category = resolveRequiredString(
    safeString(draft.category) ??
      (listingSignals.categoryTokens.length > 0
        ? listingSignals.categoryTokens.join(" ")
        : undefined),
    "uncategorized",
  );
  const season =
    safeString(draft.season) ??
    listingSignals.seasonTokens[0] ??
    listingSignals.yearTokens[0];
  const size = safeString(draft.size) ?? listingSignals.sizeTokens[0];
  const normalizedName = buildNormalizedName({
    title,
    brand,
    model,
    season,
    category,
    size,
  }, queryPlan.presetId);
  const mergedKeywords = Array.from(
    new Set(
      [
        ...relatedKeywords,
        ...buildRelatedKeywords({
          title,
          brand,
          model,
          season,
          category,
          size,
        }, queryPlan.presetId),
      ].filter(Boolean),
    ),
  );

  const listing: MarketListing = {
    id: safeString(draft.id) ?? `${market}-${index + 1}`,
    searchTerm: queryPlan.normalized || queryPlan.original,
    sourceMarket: market,
    listingType: resolveListingType(draft.listingType, soldAt),
    title,
    price,
    currency,
    imageUrl: resolveImageUrl(imageUrl, market),
    itemUrl,
    listedAt,
    soldAt,
    size,
    brand,
    model,
    season,
    category,
    relevanceScore: 0,
    confidenceScore: 0,
    normalizedName,
    relatedKeywords: mergedKeywords,
    dateConfidence: observedListedAt || soldAt ? "observed" : "fallback",
    collectedQuery: draft.collectedQuery,
    queryVariantKey: draft.queryVariantKey,
  };

  listing.fieldCompleteness = calculateFieldCompleteness(listing);
  listing.relevanceScore = computeRelevanceScore(queryPlan.normalized || queryPlan.original, listing, queryPlan.presetId);
  listing.confidenceScore = calculateListingConfidence(listing, draft.rawConfidence);

  return listing;
}

function buildNormalizationStatus(
  rawCount: number,
  normalizedCount: number,
  warnings: string[],
): ProviderExecutionStatus {
  if (rawCount === 0) {
    return "empty";
  }

  if (normalizedCount === 0) {
    return warnings.length > 0 ? "parse_error" : "empty";
  }

  if (warnings.length > 0) {
    return "partial";
  }

  return "success";
}

function buildNormalizationError(
  status: ProviderExecutionStatus,
  warnings: string[],
): ProviderErrorInfo | undefined {
  if (status === "parse_error" || status === "parsing_failure") {
    return {
      type: "parse_error",
      message: "Collected rows could not be normalized into comparable listings.",
      retryable: false,
      details: warnings[0],
    };
  }

  if (status === "partial") {
    return {
      type: "partial_result",
      message: "Some collected rows were dropped during normalization.",
      retryable: true,
      details: warnings[0],
    };
  }

  return undefined;
}

export function normalizeRawItems<TRawItem>(
  options: NormalizeRawItemsOptions<TRawItem>,
): NormalizationEnvelope {
  const warnings: string[] = [];
  const listings: MarketListing[] = [];
  let filteredOutCount = 0;
  let invalidCount = 0;

  options.rawItems.forEach((rawItem, index) => {
    try {
      const listing = finalizeListing(
        options.market,
        options.queryPlan,
        options.mapRawItem(rawItem, index),
        index,
      );

      if (!listing) {
        invalidCount += 1;
        warnings.push(`Skipped ${options.market} raw item at index ${index}.`);
        return;
      }

      const normalizedQuery = normalizeText(options.queryPlan.normalized || options.query);
      if (
        listing.relevanceScore < options.minRelevanceScore &&
        !listing.normalizedName.includes(normalizedQuery) &&
        !matchesSearchQuery(
          options.queryPlan.normalized || options.query,
          `${listing.title} ${listing.normalizedName}`,
          options.queryPlan.presetId,
        )
      ) {
        filteredOutCount += 1;
        warnings.push(`Filtered ${options.market} item by relevance at index ${index}.`);
        return;
      }

      listings.push(listing);
    } catch (error) {
      invalidCount += 1;
      warnings.push(
        error instanceof Error
          ? error.message
          : `Unknown normalization error at index ${index}.`,
      );
    }
  });

  const status = buildNormalizationStatus(
    options.rawItems.length,
    listings.length,
    warnings,
  );
  const confidenceScore =
    listings.length > 0
      ? Number(
          (
            listings.reduce((sum, listing) => sum + listing.confidenceScore, 0) /
            listings.length
          ).toFixed(3),
        )
      : 0;

  return {
    market: options.market,
    label: options.label,
    query: options.queryPlan.normalized || options.query,
    status,
    listings,
    stats: {
      receivedCount: options.rawItems.length,
      normalizedCount: listings.length,
      skippedCount: options.rawItems.length - listings.length,
      filteredOutCount,
      invalidCount,
      activeCount: listings.filter((listing) => listing.listingType === "active").length,
      soldCount: listings.filter((listing) => listing.listingType === "sold").length,
    },
    warnings,
    confidenceScore,
    error: buildNormalizationError(status, warnings),
  };
}

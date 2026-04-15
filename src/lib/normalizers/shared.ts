import {
  CurrencyCode,
  DropReasonSummary,
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
  salvaged?: boolean;
  salvageNotes?: string[];
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

function compactComparableText(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
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

function pushDropReason(
  target: Map<string, { count: number; examples: string[] }>,
  reason: string,
  example?: string,
) {
  const entry = target.get(reason) ?? { count: 0, examples: [] };
  entry.count += 1;

  if (example && entry.examples.length < 3 && !entry.examples.includes(example)) {
    entry.examples.push(example);
  }

  target.set(reason, entry);
}

function toDropReasonSummary(
  reasons: Map<string, { count: number; examples: string[] }>,
): DropReasonSummary[] {
  return [...reasons.entries()]
    .map(([reason, value]) => ({
      reason,
      count: value.count,
      examples: value.examples,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.reason.localeCompare(right.reason);
    });
}

function finalizeListing(
  market: MarketId,
  queryPlan: SearchQueryPlan,
  draft: NormalizedListingDraft,
  index: number,
): { listing: MarketListing | null; dropReason?: string; salvageNotes: string[] } {
  const title = safeString(draft.title);
  const price = typeof draft.price === "number" && Number.isFinite(draft.price) ? draft.price : null;
  const currency = draft.currency;
  const itemUrl = safeString(draft.itemUrl);
  const imageUrl = safeString(draft.imageUrl);
  const salvageNotes = draft.salvageNotes?.filter(Boolean) ?? [];

  if (!title) {
    return { listing: null, dropReason: "missing_title", salvageNotes };
  }

  if (!price) {
    return { listing: null, dropReason: "missing_price", salvageNotes };
  }

  if (!currency) {
    return { listing: null, dropReason: "missing_currency", salvageNotes };
  }

  if (!itemUrl) {
    return { listing: null, dropReason: "missing_item_url", salvageNotes };
  }

  if (!isValidHttpUrl(itemUrl)) {
    return { listing: null, dropReason: "invalid_item_url", salvageNotes };
  }

  if (containsNoiseTerm(title, queryPlan.presetId)) {
    return { listing: null, dropReason: "noise_listing", salvageNotes };
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
  listing.relevanceScore = computeRelevanceScore(
    queryPlan.normalized || queryPlan.original,
    listing,
    queryPlan.presetId,
  );

  if (
    draft.collectedQuery &&
    normalizeText(draft.collectedQuery) !== normalizeText(queryPlan.normalized || queryPlan.original)
  ) {
    listing.relevanceScore = Number(
      Math.max(
        listing.relevanceScore,
        computeRelevanceScore(draft.collectedQuery, listing, queryPlan.presetId) * 0.98,
      ).toFixed(3),
    );
  }

  const compactCollectedQuery = compactComparableText(draft.collectedQuery);
  const compactListingText = compactComparableText(`${title} ${normalizedName}`);

  if (compactCollectedQuery && compactListingText.includes(compactCollectedQuery)) {
    listing.relevanceScore = Number(Math.max(listing.relevanceScore, 0.78).toFixed(3));
  }

  listing.confidenceScore = calculateListingConfidence(
    listing,
    typeof draft.rawConfidence === "number"
      ? Math.max(0, draft.rawConfidence - (draft.salvaged ? 0.08 : 0))
      : draft.rawConfidence,
  );

  return {
    listing,
    salvageNotes,
  };
}

function buildNormalizationStatus(
  rawCount: number,
  normalizedCount: number,
  invalidCount: number,
  dropReasons: DropReasonSummary[],
): ProviderExecutionStatus {
  if (rawCount === 0) {
    return "empty";
  }

  const criticalDropCount = dropReasons
    .filter((reason) => !["low_relevance", "noise_listing"].includes(reason.reason))
    .reduce((sum, reason) => sum + reason.count, 0);
  const hasNormalizationException = dropReasons.some(
    (reason) => reason.reason === "normalization_exception",
  );

  if (normalizedCount === 0) {
    return criticalDropCount > 0 || invalidCount > 0 ? "parse_error" : "empty";
  }

  if (
    hasNormalizationException ||
    invalidCount > Math.max(2, Math.floor(rawCount * 0.2)) ||
    criticalDropCount > Math.max(2, Math.floor(rawCount * 0.25))
  ) {
    return "partial";
  }

  return "success";
}

function buildNormalizationError(
  status: ProviderExecutionStatus,
  warnings: string[],
): ProviderErrorInfo | undefined {
  const meaningfulWarning =
    warnings.find((warning) => !warning.includes("low_relevance")) ?? warnings[0];

  if (status === "parse_error" || status === "parsing_failure") {
    return {
      type: "parse_error",
      message: "Collected rows could not be normalized into comparable listings.",
      retryable: false,
      details: meaningfulWarning,
    };
  }

  if (status === "partial") {
    return {
      type: "partial_result",
      message: "Some collected rows were dropped during normalization.",
      retryable: true,
      details: meaningfulWarning,
    };
  }

  return undefined;
}

export function normalizeRawItems<TRawItem>(
  options: NormalizeRawItemsOptions<TRawItem>,
): NormalizationEnvelope {
  const warnings: string[] = [];
  const listings: MarketListing[] = [];
  const dropReasons = new Map<string, { count: number; examples: string[] }>();
  let filteredOutCount = 0;
  let invalidCount = 0;
  let salvagedCount = 0;

  options.rawItems.forEach((rawItem, index) => {
    try {
      const finalized = finalizeListing(
        options.market,
        options.queryPlan,
        options.mapRawItem(rawItem, index),
        index,
      );
      const listing = finalized.listing;

      if (!listing) {
        invalidCount += 1;
        pushDropReason(
          dropReasons,
          finalized.dropReason ?? "invalid_listing",
          `index:${index}`,
        );
        return;
      }

      if (finalized.salvageNotes.length > 0) {
        salvagedCount += 1;
      }

      const primaryQuery = options.queryPlan.normalized || options.query;
      const normalizedQuery = normalizeText(primaryQuery);
      const collectedQuery = listing.collectedQuery?.trim();
      const normalizedCollectedQuery = normalizeText(collectedQuery ?? "");
      const compactPrimaryQuery = compactComparableText(primaryQuery);
      const compactCollectedQuery = compactComparableText(collectedQuery ?? "");
      const compactListingText = compactComparableText(
        `${listing.title} ${listing.normalizedName} ${listing.relatedKeywords.join(" ")}`,
      );
      const matchesPrimaryQuery =
        listing.normalizedName.includes(normalizedQuery) ||
        (compactPrimaryQuery.length > 0 && compactListingText.includes(compactPrimaryQuery)) ||
        matchesSearchQuery(
          primaryQuery,
          `${listing.title} ${listing.normalizedName}`,
          options.queryPlan.presetId,
        );
      const matchesCollectedQuery =
        Boolean(collectedQuery) &&
        (listing.normalizedName.includes(normalizedCollectedQuery) ||
          (compactCollectedQuery.length > 0 &&
            compactListingText.includes(compactCollectedQuery)) ||
          matchesSearchQuery(
            collectedQuery as string,
            `${listing.title} ${listing.normalizedName}`,
            options.queryPlan.presetId,
          ));
      const allowVariantRescue =
        Boolean(
          (listing.queryVariantKey && listing.queryVariantKey !== "original") ||
            (collectedQuery &&
              normalizeText(collectedQuery) !== normalizeText(primaryQuery)) ||
            ((listing.fieldCompleteness ?? 0) >= 0.66 &&
              listing.confidenceScore >= 0.58 &&
              listing.relevanceScore >= Math.max(0.16, options.minRelevanceScore * 0.42)),
        );

      if (
        listing.relevanceScore < options.minRelevanceScore &&
        !matchesPrimaryQuery &&
        !matchesCollectedQuery &&
        !allowVariantRescue
      ) {
        filteredOutCount += 1;
        pushDropReason(
          dropReasons,
          "low_relevance",
          listing.title,
        );
        return;
      }

      listings.push(listing);
    } catch (error) {
      invalidCount += 1;
      pushDropReason(
        dropReasons,
        "normalization_exception",
        `index:${index}`,
      );
      warnings.push(
        error instanceof Error
          ? error.message
          : `Unknown normalization error at index ${index}.`,
      );
    }
  });

  const dropReasonSummary = toDropReasonSummary(dropReasons);
  const status = buildNormalizationStatus(
    options.rawItems.length,
    listings.length,
    invalidCount,
    dropReasonSummary,
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

  if (salvagedCount > 0) {
    warnings.push(
      `Salvaged ${salvagedCount} ${options.market} rows using fallback field rules.`,
    );
  }

  dropReasonSummary.slice(0, 4).forEach((reason) => {
    warnings.push(
      `Dropped ${reason.count} ${options.market} rows due to ${reason.reason}.`,
    );
  });

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
      salvagedCount,
      activeCount: listings.filter((listing) => listing.listingType === "active").length,
      soldCount: listings.filter((listing) => listing.listingType === "sold").length,
    },
    warnings,
    confidenceScore,
    dropReasons: dropReasonSummary,
    error: buildNormalizationError(status, warnings),
  };
}

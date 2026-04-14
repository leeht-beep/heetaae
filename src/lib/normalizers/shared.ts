import {
  CurrencyCode,
  ListingType,
  MarketId,
  MarketListing,
  NormalizationEnvelope,
  ProviderErrorInfo,
  ProviderExecutionStatus,
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
}

interface NormalizeRawItemsOptions<TRawItem> {
  market: MarketId;
  label: string;
  query: string;
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

function resolveListingType(
  value: ListingType | undefined,
  soldAt?: string,
): ListingType {
  if (value) {
    return value;
  }

  return soldAt ? "sold" : "active";
}

function resolveRequiredString(
  value: string | undefined,
  fallback: string,
): string {
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

function finalizeListing(
  market: MarketId,
  query: string,
  draft: NormalizedListingDraft,
  index: number,
): MarketListing | null {
  const title = safeString(draft.title);
  const price = typeof draft.price === "number" && Number.isFinite(draft.price) ? draft.price : null;
  const currency = draft.currency;
  const itemUrl = safeString(draft.itemUrl);

  if (!title || !price || !currency || !itemUrl) {
    return null;
  }

  if (containsNoiseTerm(title)) {
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
  });
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
  });
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
        }),
      ].filter(Boolean),
    ),
  );

  const listing: MarketListing = {
    id: safeString(draft.id) ?? `${market}-${index + 1}`,
    searchTerm: query,
    sourceMarket: market,
    listingType: resolveListingType(draft.listingType, soldAt),
    title,
    price,
    currency,
    imageUrl: safeString(draft.imageUrl) ?? "",
    itemUrl,
    listedAt,
    soldAt,
    size,
    brand,
    model,
    season,
    category,
    relevanceScore: 0,
    normalizedName,
    relatedKeywords: mergedKeywords,
    dateConfidence: observedListedAt || soldAt ? "observed" : "fallback",
  };

  listing.relevanceScore = computeRelevanceScore(query, listing);

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
    return warnings.length > 0 ? "parsing_failure" : "empty";
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
  if (status === "parsing_failure") {
    return {
      type: "parsing_failure",
      message: "수집 결과를 공통 listing 형식으로 변환하지 못했습니다.",
      retryable: false,
      details: warnings[0],
    };
  }

  if (status === "partial") {
    return {
      type: "partial_result",
      message: "일부 항목만 정상적으로 정규화되었습니다.",
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

  options.rawItems.forEach((rawItem, index) => {
    try {
      const listing = finalizeListing(
        options.market,
        options.query,
        options.mapRawItem(rawItem, index),
        index,
      );

      if (!listing) {
        warnings.push(`Skipped ${options.market} raw item at index ${index}.`);
        return;
      }

      const normalizedQuery = normalizeText(options.query);
      if (
        listing.relevanceScore < options.minRelevanceScore &&
        !listing.normalizedName.includes(normalizedQuery) &&
        !matchesSearchQuery(options.query, `${listing.title} ${listing.normalizedName}`)
      ) {
        warnings.push(`Filtered ${options.market} item by relevance at index ${index}.`);
        return;
      }

      listings.push(listing);
    } catch (error) {
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

  return {
    market: options.market,
    label: options.label,
    query: options.query,
    status,
    listings,
    stats: {
      receivedCount: options.rawItems.length,
      normalizedCount: listings.length,
      skippedCount: options.rawItems.length - listings.length,
      activeCount: listings.filter((listing) => listing.listingType === "active").length,
      soldCount: listings.filter((listing) => listing.listingType === "sold").length,
    },
    warnings,
    error: buildNormalizationError(status, warnings),
  };
}

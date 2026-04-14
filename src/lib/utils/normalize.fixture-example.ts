import { MarketListing } from "@/lib/types/market";
import {
  buildNormalizedName,
  computeListingSimilarity,
  computeRelevanceScore,
  extractListingSignals,
  removeNoisePhrases,
} from "@/lib/utils/normalize";

const FIXTURE_QUERY = "Supreme Box Logo Hoodie FW23 Black Large";

function createFixtureListing(
  id: string,
  overrides: Partial<MarketListing>,
): MarketListing {
  const title = overrides.title ?? "";
  const brand = overrides.brand ?? "Unknown";
  const model = overrides.model ?? "Unknown";
  const category = overrides.category ?? "fashion";
  const season = overrides.season;
  const size = overrides.size;

  return {
    id,
    searchTerm: FIXTURE_QUERY,
    sourceMarket: overrides.sourceMarket ?? "mercari",
    listingType: overrides.listingType ?? "active",
    title,
    price: overrides.price ?? 100000,
    currency: overrides.currency ?? "KRW",
    imageUrl: overrides.imageUrl ?? "https://example.com/item.jpg",
    itemUrl: overrides.itemUrl ?? `https://example.com/items/${id}`,
    listedAt: overrides.listedAt ?? "2026-04-01T00:00:00.000Z",
    soldAt: overrides.soldAt,
    size,
    brand,
    model,
    season,
    category,
    relevanceScore: overrides.relevanceScore ?? 0,
    normalizedName:
      overrides.normalizedName ??
      buildNormalizedName({
        title,
        brand,
        model,
        season,
        category,
        size,
      }),
    relatedKeywords: overrides.relatedKeywords ?? [brand, model, category].filter(Boolean),
    dateConfidence: overrides.dateConfidence ?? "observed",
    priceKrw: overrides.priceKrw,
  };
}

const baseListing = createFixtureListing("fixture-mercari", {
  sourceMarket: "mercari",
  currency: "JPY",
  price: 19800,
  title: "[미사용] Supreme Box Logo Hoodie FW23 Black L",
  brand: "Supreme",
  model: "Box Logo Hoodie",
  season: "FW23",
  category: "hoodie",
  size: "L",
});

const bunjangComparable = createFixtureListing("fixture-bunjang", {
  sourceMarket: "bunjang",
  title: "슈프림 박스로고 후드 FW23 블랙 라지",
  brand: "Supreme",
  model: "Box Logo Hoodie",
  season: "FW23",
  category: "hoodie",
  size: "L",
  price: 420000,
});

const noisyWantedPost = createFixtureListing("fixture-noise", {
  sourceMarket: "fruitsfamily",
  title: "슈프림 박스로고 후드 삽니다 문의주세요",
  brand: "Supreme",
  model: "Box Logo Hoodie",
  season: "FW23",
  category: "hoodie",
  size: "L",
  price: 350000,
});

export function runNormalizationFixtureExample() {
  const mercariRelevance = computeRelevanceScore(FIXTURE_QUERY, baseListing);
  const bunjangRelevance = computeRelevanceScore(FIXTURE_QUERY, bunjangComparable);
  const noisyRelevance = computeRelevanceScore(FIXTURE_QUERY, noisyWantedPost);

  return {
    query: FIXTURE_QUERY,
    cleanedExamples: {
      mercari: removeNoisePhrases(baseListing.title),
      bunjang: removeNoisePhrases(bunjangComparable.title),
      noisy: removeNoisePhrases(noisyWantedPost.title),
    },
    normalizedNames: {
      mercari: baseListing.normalizedName,
      bunjang: bunjangComparable.normalizedName,
      noisy: noisyWantedPost.normalizedName,
    },
    relevanceScores: {
      mercari: mercariRelevance,
      bunjang: bunjangRelevance,
      noisy: noisyRelevance,
    },
    signalSnapshots: {
      mercari: extractListingSignals(baseListing),
      bunjang: extractListingSignals(bunjangComparable),
      noisy: extractListingSignals(noisyWantedPost),
    },
    similarity: {
      mercariVsBunjang: computeListingSimilarity(baseListing, bunjangComparable),
      mercariVsNoise: computeListingSimilarity(baseListing, noisyWantedPost),
    },
  };
}

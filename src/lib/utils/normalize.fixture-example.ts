import type { MarketListing } from "@/lib/types/market";
import {
  buildNormalizedName,
  computeListingSimilarity,
  computeRelevanceScore,
  extractListingSignals,
  removeNoisePhrases,
} from "@/lib/utils/normalize";

const FIXTURE_QUERY = "Supreme Box Logo Hoodie FW23";

const baseListing: MarketListing = {
  id: "mercari-1",
  searchTerm: FIXTURE_QUERY,
  sourceMarket: "mercari",
  listingType: "active",
  title: "Supreme Box Logo Hoodie FW23 Black M",
  price: 52000,
  currency: "JPY",
  imageUrl: "https://example.com/mercari.jpg",
  itemUrl: "https://jp.mercari.com/item/m123",
  listedAt: "2026-04-10T10:00:00+09:00",
  brand: "Supreme",
  model: "Box Logo Hoodie",
  season: "FW23",
  category: "hoodie",
  relevanceScore: 0.9,
  confidenceScore: 0.88,
  normalizedName: "",
  relatedKeywords: ["supreme", "box logo", "hoodie", "fw23"],
};

const bunjangComparable: MarketListing = {
  ...baseListing,
  id: "bunjang-1",
  sourceMarket: "bunjang",
  currency: "KRW",
  price: 438000,
  imageUrl: "https://example.com/bunjang.jpg",
  itemUrl: "https://m.bunjang.co.kr/products/123",
  title: "슈프림 박스로고 후드 FW23 블랙 M",
  relatedKeywords: ["슈프림", "박스로고", "후드", "fw23"],
};

const noisyWantedPost: MarketListing = {
  ...baseListing,
  id: "noise-1",
  sourceMarket: "bunjang",
  currency: "KRW",
  price: 5000,
  imageUrl: "https://example.com/noise.jpg",
  itemUrl: "https://m.bunjang.co.kr/products/noise",
  title: "슈프림 박스로고 후드 삽니다",
  relatedKeywords: ["wanted", "buy"],
};

export function runNormalizationFixtureExample() {
  const mercariNormalizedName = buildNormalizedName({
    title: baseListing.title,
    brand: baseListing.brand,
    model: baseListing.model,
    season: baseListing.season,
    category: baseListing.category,
    size: baseListing.size,
  });

  const bunjangNormalizedName = buildNormalizedName({
    title: bunjangComparable.title,
    brand: bunjangComparable.brand,
    model: bunjangComparable.model,
    season: bunjangComparable.season,
    category: bunjangComparable.category,
    size: bunjangComparable.size,
  });

  return {
    query: FIXTURE_QUERY,
    cleanedTitles: {
      mercari: removeNoisePhrases(baseListing.title),
      bunjang: removeNoisePhrases(bunjangComparable.title),
      noisy: removeNoisePhrases(noisyWantedPost.title),
    },
    normalizedNames: {
      mercari: mercariNormalizedName,
      bunjang: bunjangNormalizedName,
    },
    signals: {
      mercari: extractListingSignals(baseListing),
      bunjang: extractListingSignals(bunjangComparable),
      noisy: extractListingSignals(noisyWantedPost),
    },
    relevance: {
      mercari: computeRelevanceScore(FIXTURE_QUERY, baseListing),
      bunjang: computeRelevanceScore(FIXTURE_QUERY, bunjangComparable),
      noisy: computeRelevanceScore(FIXTURE_QUERY, noisyWantedPost),
    },
    similarity: {
      mercariVsBunjang: computeListingSimilarity(baseListing, bunjangComparable),
      mercariVsNoise: computeListingSimilarity(baseListing, noisyWantedPost),
    },
  };
}

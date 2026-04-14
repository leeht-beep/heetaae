import { FRUITSFAMILY_MOCK_LISTINGS } from "@/lib/mock";
import { FixtureResponseMeta, FruitsfamilyRawListing } from "@/lib/fixtures/types";
import { MockMarketListing } from "@/lib/types/market";
import { matchesSearchQuery } from "@/lib/utils/normalize";

const FIXTURE_ID = "fruitsfamily-search-results-v1";

function toFruitsfamilyRawListing(listing: MockMarketListing): FruitsfamilyRawListing {
  return {
    slug: listing.id,
    titleText: listing.title,
    amount: listing.price,
    currencyCode: listing.currency,
    coverImageUrl: listing.imageUrl,
    productUrl: listing.itemUrl,
    publishedAt: listing.listedAt,
    soldOutAt: listing.soldAt,
    isSold: listing.listingType === "sold",
    labels: {
      size: listing.size,
      brand: listing.brand,
      model: listing.model,
      season: listing.season,
      category: listing.category,
    },
    tokens: listing.relatedKeywords,
  };
}

function buildSearchText(item: FruitsfamilyRawListing): string {
  return [
    item.titleText,
    item.labels?.brand,
    item.labels?.model,
    item.labels?.season,
    item.labels?.category,
    ...(item.tokens ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

export const FRUITSFAMILY_RAW_FIXTURE_ITEMS: FruitsfamilyRawListing[] = FRUITSFAMILY_MOCK_LISTINGS.map(
  toFruitsfamilyRawListing,
);

export function searchFruitsfamilyFixtureItems(
  query: string,
  limit: number,
): FruitsfamilyRawListing[] {
  return FRUITSFAMILY_RAW_FIXTURE_ITEMS.filter((item) => matchesSearchQuery(query, buildSearchText(item))).slice(
    0,
    limit,
  );
}

export function buildFruitsfamilyFixtureMeta(returnedCount: number): FixtureResponseMeta {
  return {
    fixtureId: FIXTURE_ID,
    totalAvailable: FRUITSFAMILY_RAW_FIXTURE_ITEMS.length,
    returnedCount,
  };
}

export function buildFruitsfamilyMalformedFixtureItem(): FruitsfamilyRawListing {
  return {
    slug: "fruitsfamily-malformed-fixture",
    currencyCode: "KRW",
    isSold: false,
  };
}

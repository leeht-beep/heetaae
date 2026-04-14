import { MERCARI_MOCK_LISTINGS } from "@/lib/mock";
import { matchesSearchQuery } from "@/lib/utils/normalize";
import { FixtureResponseMeta, MercariRawListing } from "@/lib/fixtures/types";
import { MockMarketListing } from "@/lib/types/market";

const FIXTURE_ID = "mercari-search-results-v1";

function toMercariRawListing(listing: MockMarketListing): MercariRawListing {
  return {
    itemId: listing.id,
    titleText: listing.title,
    priceJpy: listing.price,
    primaryImageUrl: listing.imageUrl,
    itemUrl: listing.itemUrl,
    postedAt: listing.listedAt,
    purchasedAt: listing.soldAt,
    status: listing.listingType === "sold" ? "sold_out" : "on_sale",
    attributes: {
      size: listing.size,
      brand: listing.brand,
      model: listing.model,
      season: listing.season,
      category: listing.category,
      keywords: listing.relatedKeywords,
    },
  };
}

function buildSearchText(item: MercariRawListing): string {
  return [
    item.titleText,
    item.attributes?.brand,
    item.attributes?.model,
    item.attributes?.season,
    item.attributes?.category,
    ...(item.attributes?.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

export const MERCARI_RAW_FIXTURE_ITEMS: MercariRawListing[] = MERCARI_MOCK_LISTINGS.map(
  toMercariRawListing,
);

export function searchMercariFixtureItems(query: string, limit: number): MercariRawListing[] {
  return MERCARI_RAW_FIXTURE_ITEMS.filter((item) => matchesSearchQuery(query, buildSearchText(item))).slice(
    0,
    limit,
  );
}

export function buildMercariFixtureMeta(returnedCount: number): FixtureResponseMeta {
  return {
    fixtureId: FIXTURE_ID,
    totalAvailable: MERCARI_RAW_FIXTURE_ITEMS.length,
    returnedCount,
  };
}

export function buildMercariMalformedFixtureItem(): MercariRawListing {
  return {
    itemId: "mercari-malformed-fixture",
    status: "on_sale",
  };
}

import type { BUNJANG_MOCK_LISTINGS } from "@/lib/mock";
import { FixtureResponseMeta, BunjangRawListing } from "@/lib/fixtures/types";
import { BUNJANG_MOCK_LISTINGS as BUNJANG_MOCK_LISTINGS_VALUE } from "@/lib/mock";
import { MockMarketListing } from "@/lib/types/market";
import { matchesSearchQuery } from "@/lib/utils/normalize";

const FIXTURE_ID = "bunjang-search-results-v1";

function toBunjangRawListing(listing: MockMarketListing): BunjangRawListing {
  return {
    productId: listing.id,
    subject: listing.title,
    priceKrw: listing.price,
    thumbnailUrl: listing.imageUrl,
    productUrl: listing.itemUrl,
    createdAt: listing.listedAt,
    closedAt: listing.soldAt,
    saleStatus: listing.listingType === "sold" ? "SOLD_OUT" : "SALE",
    spec: {
      sizeLabel: listing.size,
      brandName: listing.brand,
      modelName: listing.model,
      seasonName: listing.season,
      categoryName: listing.category,
    },
    searchKeywords: listing.relatedKeywords,
  };
}

function buildSearchText(item: BunjangRawListing): string {
  return [
    item.subject,
    item.spec?.brandName,
    item.spec?.modelName,
    item.spec?.seasonName,
    item.spec?.categoryName,
    ...(item.searchKeywords ?? []),
  ]
    .filter(Boolean)
    .join(" ");
}

export const BUNJANG_RAW_FIXTURE_ITEMS: BunjangRawListing[] = BUNJANG_MOCK_LISTINGS_VALUE.map(
  toBunjangRawListing,
);

export function searchBunjangFixtureItems(query: string, limit: number): BunjangRawListing[] {
  return BUNJANG_RAW_FIXTURE_ITEMS.filter((item) => matchesSearchQuery(query, buildSearchText(item))).slice(
    0,
    limit,
  );
}

export function buildBunjangFixtureMeta(returnedCount: number): FixtureResponseMeta {
  return {
    fixtureId: FIXTURE_ID,
    totalAvailable: BUNJANG_RAW_FIXTURE_ITEMS.length,
    returnedCount,
  };
}

export function buildBunjangMalformedFixtureItem(): BunjangRawListing {
  return {
    productId: "bunjang-malformed-fixture",
    saleStatus: "SALE",
  };
}


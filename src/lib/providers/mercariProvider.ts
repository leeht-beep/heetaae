import {
  buildMercariFixtureMeta,
  buildMercariMalformedFixtureItem,
  MercariRawListing,
  searchMercariFixtureItems,
} from "@/lib/fixtures";
import { MARKET_LABELS } from "@/lib/constants";
import { mercariNormalizer } from "@/lib/normalizers";
import { MarketDataSource } from "@/lib/providers/base";
import { createFixtureCollector } from "@/lib/providers/mock/fixtureCollector";
import { mercariRealCollector } from "@/lib/providers/mercari/collector";

const label = MARKET_LABELS.mercari;

const mercariMockCollector = createFixtureCollector({
  id: "mercari",
  label,
  loadFixtures: ({ sanitizedQuery, limit }) => {
    const rawItems = searchMercariFixtureItems(sanitizedQuery, limit);

    return {
      rawItems,
      meta: buildMercariFixtureMeta(rawItems.length),
    };
  },
  buildMalformedRawItem: buildMercariMalformedFixtureItem,
});

export const mercariProvider: MarketDataSource<MercariRawListing, Record<string, unknown>> = {
  id: "mercari",
  label,
  collectors: {
    mock: mercariMockCollector,
    real: mercariRealCollector,
  },
  normalizer: mercariNormalizer,
};

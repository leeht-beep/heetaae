import {
  buildBunjangFixtureMeta,
  buildBunjangMalformedFixtureItem,
  BunjangRawListing,
  searchBunjangFixtureItems,
} from "@/lib/fixtures";
import { bunjangNormalizer } from "@/lib/normalizers";
import { MARKET_LABELS } from "@/lib/constants";
import { MarketDataSource } from "@/lib/providers/base";
import { createFixtureCollector } from "@/lib/providers/mock/fixtureCollector";
import { bunjangRealCollector } from "@/lib/providers/bunjang/collector";

const label = MARKET_LABELS.bunjang;

const bunjangMockCollector = createFixtureCollector({
  id: "bunjang",
  label,
  loadFixtures: ({ sanitizedQuery, limit }) => {
    const rawItems = searchBunjangFixtureItems(sanitizedQuery, limit);

    return {
      rawItems,
      meta: buildBunjangFixtureMeta(rawItems.length),
    };
  },
  buildMalformedRawItem: buildBunjangMalformedFixtureItem,
});

export const bunjangProvider: MarketDataSource<BunjangRawListing, Record<string, unknown>> = {
  id: "bunjang",
  label,
  collectors: {
    mock: bunjangMockCollector,
    real: bunjangRealCollector,
  },
  normalizer: bunjangNormalizer,
};

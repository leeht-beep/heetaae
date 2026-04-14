import {
  buildFruitsfamilyFixtureMeta,
  buildFruitsfamilyMalformedFixtureItem,
  FruitsfamilyRawListing,
  searchFruitsfamilyFixtureItems,
} from "@/lib/fixtures";
import { fruitsfamilyNormalizer } from "@/lib/normalizers";
import { MARKET_LABELS } from "@/lib/constants";
import { MarketDataSource } from "@/lib/providers/base";
import { createFixtureCollector } from "@/lib/providers/mock/fixtureCollector";
import { fruitsfamilyRealCollector } from "@/lib/providers/fruitsfamily/collector";

const label = MARKET_LABELS.fruitsfamily;

const fruitsfamilyMockCollector = createFixtureCollector({
  id: "fruitsfamily",
  label,
  loadFixtures: ({ sanitizedQuery, limit }) => {
    const rawItems = searchFruitsfamilyFixtureItems(sanitizedQuery, limit);

    return {
      rawItems,
      meta: buildFruitsfamilyFixtureMeta(rawItems.length),
    };
  },
  buildMalformedRawItem: buildFruitsfamilyMalformedFixtureItem,
});

export const fruitsfamilyProvider: MarketDataSource<FruitsfamilyRawListing, Record<string, unknown>> = {
  id: "fruitsfamily",
  label,
  collectors: {
    mock: fruitsfamilyMockCollector,
    real: fruitsfamilyRealCollector,
  },
  normalizer: fruitsfamilyNormalizer,
};

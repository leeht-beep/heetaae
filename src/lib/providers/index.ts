import { MarketDataSource } from "@/lib/providers/base";
import { MarketId } from "@/lib/types/market";
import { bunjangProvider } from "@/lib/providers/bunjangProvider";
import { fruitsfamilyProvider } from "@/lib/providers/fruitsfamilyProvider";
import { mercariProvider } from "@/lib/providers/mercariProvider";

export const marketDataSources: Array<MarketDataSource<unknown, Record<string, unknown>>> = [
  mercariProvider,
  bunjangProvider,
  fruitsfamilyProvider,
];

export const MARKET_SOURCE_ORDER: MarketId[] = marketDataSources.map((source) => source.id);

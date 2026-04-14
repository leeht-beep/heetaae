import {
  MERCARI_EMPTY_FIXTURE_HTML,
  MERCARI_ON_SALE_FIXTURE_HTML,
  MERCARI_SOLD_FIXTURE_HTML,
} from "@/lib/providers/mercari/fixtures";
import { parseMercariSearchHtml } from "@/lib/providers/mercari/parser";

export function runMercariParserFixtureExample() {
  return {
    onSale: parseMercariSearchHtml(MERCARI_ON_SALE_FIXTURE_HTML, {
      statusHint: "on_sale",
      source: "fixture",
    }),
    sold: parseMercariSearchHtml(MERCARI_SOLD_FIXTURE_HTML, {
      statusHint: "sold_out",
      source: "fixture",
    }),
    empty: parseMercariSearchHtml(MERCARI_EMPTY_FIXTURE_HTML, {
      statusHint: "on_sale",
      source: "fixture",
    }),
  };
}

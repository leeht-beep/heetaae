import {
  FRUITSFAMILY_EMPTY_FIXTURE_HTML,
  FRUITSFAMILY_SEARCH_FIXTURE_HTML,
} from "@/lib/providers/fruitsfamily/fixtures";
import { parseFruitsfamilySearchHtml } from "@/lib/providers/fruitsfamily/parser";

export function runFruitsfamilyParserFixtureExample() {
  const successResult = parseFruitsfamilySearchHtml(FRUITSFAMILY_SEARCH_FIXTURE_HTML, {
    query: "supreme",
    source: "fixture",
  });
  const emptyResult = parseFruitsfamilySearchHtml(FRUITSFAMILY_EMPTY_FIXTURE_HTML, {
    query: "missing",
    source: "fixture",
  });

  return {
    successCount: successResult.items.length,
    soldCount: successResult.items.filter((item) => item.isSold).length,
    urlMatchCount: successResult.urlMatchCount,
    emptyResult: emptyResult.emptyResult,
  };
}

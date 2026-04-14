import {
  BUNJANG_EMPTY_FIXTURE_RESPONSE,
  BUNJANG_SEARCH_FIXTURE_RESPONSE,
} from "@/lib/providers/bunjang/fixtures";
import { parseBunjangSearchResponse } from "@/lib/providers/bunjang/parser";

export function runBunjangParserFixtureExample() {
  const successResult = parseBunjangSearchResponse(BUNJANG_SEARCH_FIXTURE_RESPONSE, {
    query: "슈프림 박스로고 후드",
    source: "fixture",
  });
  const emptyResult = parseBunjangSearchResponse(BUNJANG_EMPTY_FIXTURE_RESPONSE, {
    query: "없는 상품",
    source: "fixture",
  });

  return {
    successCount: successResult.items.length,
    soldCount: successResult.items.filter((item) => item.saleStatus === "SOLD_OUT").length,
    malformedEntries: successResult.malformedEntries,
    emptyResult: emptyResult.emptyResult,
  };
}

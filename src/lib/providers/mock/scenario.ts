import { MarketId } from "@/lib/types/market";

export type MockScenario = "timeout" | "error" | "partial" | "parsing_failure";

const SCENARIO_PATTERN = /\[(timeout|error|partial|parsefail):(mercari|bunjang|fruitsfamily|all)\]/gi;

function normalizeScenarioName(value: string): MockScenario {
  return value === "parsefail" ? "parsing_failure" : (value as Exclude<MockScenario, "parsing_failure">);
}

export function resolveMockScenario(query: string, market: MarketId): MockScenario | null {
  const matches = query.matchAll(SCENARIO_PATTERN);

  for (const match of matches) {
    const scenario = normalizeScenarioName(match[1] ?? "");
    const target = match[2] ?? "";

    if (target === "all" || target === market) {
      return scenario;
    }
  }

  return null;
}

export function stripMockScenarioTokens(query: string): string {
  return query.replace(SCENARIO_PATTERN, "").replace(/\s+/g, " ").trim();
}

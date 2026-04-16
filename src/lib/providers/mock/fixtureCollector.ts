import type {
  buildCollectorEnvelope,
  RawMarketCollector,
  ResolvedSearchProviderContext,
} from "@/lib/providers/base";
import { buildCollectorEnvelope as buildCollectorEnvelopeValue } from "@/lib/providers/base";
import { MarketId, ProviderExecutionStatus, ProviderMode } from "@/lib/types/market";
import { resolveMockScenario, stripMockScenarioTokens } from "@/lib/providers/mock/scenario";

interface FixtureCollectorLoadResult<TRawItem, TMeta extends Record<string, unknown>> {
  rawItems: TRawItem[];
  meta: TMeta;
  warnings?: string[];
}

interface FixtureCollectorOptions<TRawItem, TMeta extends Record<string, unknown>> {
  id: MarketId;
  label: string;
  loadFixtures: (
    context: ResolvedSearchProviderContext & { sanitizedQuery: string },
  ) => Promise<FixtureCollectorLoadResult<TRawItem, TMeta>> | FixtureCollectorLoadResult<TRawItem, TMeta>;
  buildMalformedRawItem?: () => TRawItem;
}

function createTimeoutError(message: string): Error {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

export function createFixtureCollector<
  TRawItem,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
>(options: FixtureCollectorOptions<TRawItem, TMeta>): RawMarketCollector<TRawItem, TMeta> {
  return {
    id: options.id,
    label: options.label,
    mode: "mock" satisfies ProviderMode,
    async collect(context) {
      const scenario = resolveMockScenario(context.query, options.id);
      const sanitizedQuery = stripMockScenarioTokens(context.query) || context.query;

      if (scenario === "timeout") {
        throw createTimeoutError(`${options.label} mock fixture timed out.`);
      }

      if (scenario === "error") {
        throw new Error(`${options.label} mock fixture failed.`);
      }

      const startedAt = Date.now();
      const fixtureResult = await options.loadFixtures({
        ...context,
        query: sanitizedQuery,
        sanitizedQuery,
      });

      let rawItems = fixtureResult.rawItems;
      const warnings = [...(fixtureResult.warnings ?? [])];
      let status: ProviderExecutionStatus = rawItems.length > 0 ? "success" : "empty";

      if (scenario === "partial" && options.buildMalformedRawItem) {
        rawItems = [...rawItems, options.buildMalformedRawItem()];
        warnings.push(`${options.label} partial fixture scenario injected one malformed row.`);
        status = "partial";
      }

      if (scenario === "parsing_failure" && options.buildMalformedRawItem) {
        rawItems = [options.buildMalformedRawItem()];
        warnings.push(`${options.label} parsing fixture scenario injected malformed rows only.`);
      }

      return buildCollectorEnvelopeValue<TRawItem, TMeta>({
        market: options.id,
        label: options.label,
        mode: "mock",
        query: sanitizedQuery,
        status,
        rawItems,
        meta: fixtureResult.meta,
        warnings,
        durationMs: Date.now() - startedAt,
      });
    },
  };
}


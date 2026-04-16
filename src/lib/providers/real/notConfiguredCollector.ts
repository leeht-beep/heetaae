import type { buildCollectorEnvelope, RawMarketCollector } from "@/lib/providers/base";
import { MarketId } from "@/lib/types/market";
import { buildCollectorEnvelope as buildCollectorEnvelopeValue } from "@/lib/providers/base";

export function createNotConfiguredCollector<
  TRawItem,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
>(options: {
  id: MarketId;
  label: string;
  meta?: TMeta;
}): RawMarketCollector<TRawItem, TMeta> {
  return {
    id: options.id,
    label: options.label,
    mode: "real",
    async collect(context) {
      return buildCollectorEnvelopeValue<TRawItem, TMeta>({
        market: options.id,
        label: options.label,
        mode: "real",
        query: context.query,
        status: "error",
        rawItems: [],
        meta: (options.meta ?? { configured: false }) as TMeta,
        warnings: ["?ㅼ젣 ?섏쭛湲곕뒗 ?꾩쭅 ?곌껐?섏? ?딆븯?듬땲??"],
        error: {
          type: "not_configured",
          message: `${options.label} ?ㅼ닔吏묎린???꾩쭅 ?곌껐?섏? ?딆븯?듬땲??`,
          retryable: false,
        },
        durationMs: 0,
      });
    },
  };
}


import { buildCollectorEnvelope, RawMarketCollector } from "@/lib/providers/base";
import { MarketId } from "@/lib/types/market";

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
      return buildCollectorEnvelope<TRawItem, TMeta>({
        market: options.id,
        label: options.label,
        mode: "real",
        query: context.query,
        status: "error",
        rawItems: [],
        meta: (options.meta ?? { configured: false }) as TMeta,
        warnings: ["실제 수집기는 아직 연결되지 않았습니다."],
        error: {
          type: "not_configured",
          message: `${options.label} 실수집기는 아직 연결되지 않았습니다.`,
          retryable: false,
        },
        durationMs: 0,
      });
    },
  };
}

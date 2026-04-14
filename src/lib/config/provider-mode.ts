import { ProviderMode } from "@/lib/types/market";

const DEFAULT_PROVIDER_MODE: ProviderMode = "real";

export function resolveProviderMode(value?: string | null): ProviderMode {
  if (value === "mock" || value === "real") {
    return value;
  }

  return DEFAULT_PROVIDER_MODE;
}

export function getConfiguredProviderMode(): ProviderMode {
  return resolveProviderMode(
    process.env.MARKET_PROVIDER_MODE ?? process.env.NEXT_PUBLIC_MARKET_PROVIDER_MODE ?? null,
  );
}

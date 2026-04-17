import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COST_SETTINGS, DEFAULT_SEARCH_TERM } from "@/lib/constants";
import { resolveProviderMode } from "@/lib/config/provider-mode";
import { searchResellOpportunities } from "@/lib/services/search-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function parseNumber(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const searchTerm = searchParams.get("q")?.trim() || DEFAULT_SEARCH_TERM;
  const requestedMode = searchParams.get("mode");
  const mode = resolveProviderMode(requestedMode);
  const providerModeSource =
    requestedMode === "mock" || requestedMode === "real" ? "route" : "default";
  const preset = searchParams.get("preset")?.trim() || undefined;
  const costs = {
    exchangeRate: parseNumber(searchParams.get("exchangeRate"), DEFAULT_COST_SETTINGS.exchangeRate),
    japanDomesticShipping: parseNumber(
      searchParams.get("japanDomesticShipping"),
      DEFAULT_COST_SETTINGS.japanDomesticShipping,
    ),
    internationalShipping: parseNumber(
      searchParams.get("internationalShipping"),
      DEFAULT_COST_SETTINGS.internationalShipping,
    ),
    extraCosts: parseNumber(searchParams.get("extraCosts"), DEFAULT_COST_SETTINGS.extraCosts),
    platformFeeRate: parseNumber(searchParams.get("platformFeeRate"), DEFAULT_COST_SETTINGS.platformFeeRate),
    targetMarginRate: parseNumber(searchParams.get("targetMarginRate"), DEFAULT_COST_SETTINGS.targetMarginRate),
  };

  const payload = await searchResellOpportunities(searchTerm, costs, { mode, preset });
  payload.debug = {
    ...(payload.debug ?? {
      cacheHit: false,
      totalDurationMs: 0,
      queryPlan: payload.queryPlan,
      providerDebug: [],
    }),
    environment: {
      ...(payload.debug?.environment ?? {}),
      routeRuntime: runtime,
      nodeVersion: process.version,
      platform: process.platform,
      deploymentTarget: process.env.VERCEL ? "vercel" : "local",
    },
  };
  payload.marketResults = payload.marketResults.map((result) => ({
    ...result,
    debug: result.debug
      ? {
          ...result.debug,
          summary: {
            ...(result.debug.summary ?? {}),
            providerModeSource,
          },
        }
      : result.debug,
  }));
  return NextResponse.json(payload);
}

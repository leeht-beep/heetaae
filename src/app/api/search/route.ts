import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COST_SETTINGS, DEFAULT_SEARCH_TERM } from "@/lib/constants";
import { resolveProviderMode } from "@/lib/config/provider-mode";
import { searchResellOpportunities } from "@/lib/services/search-service";

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
  const mode = resolveProviderMode(searchParams.get("mode"));
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
  return NextResponse.json(payload);
}

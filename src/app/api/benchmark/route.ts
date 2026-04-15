import { NextRequest, NextResponse } from "next/server";
import { runSearchBenchmarks } from "@/lib/benchmarks/runner";
import { resolveProviderMode } from "@/lib/config/provider-mode";

export const dynamic = "force-dynamic";

function parseList(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && process.env.BENCHMARK_ALLOW_PRODUCTION !== "1") {
    return NextResponse.json(
      {
        message: "Benchmark route is only available in development by default.",
      },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const report = await runSearchBenchmarks({
    mode: resolveProviderMode(searchParams.get("mode")),
    preset: searchParams.get("preset"),
    comparePresets: parseBoolean(searchParams.get("comparePresets")),
    ids: parseList(searchParams.get("ids")),
    tags: parseList(searchParams.get("tags")) ?? ["core"],
    maxQueries: parseNumber(searchParams.get("maxQueries")),
    delayMs: parseNumber(searchParams.get("delayMs")),
    limit: parseNumber(searchParams.get("limit")),
  });

  return NextResponse.json(report);
}

#!/usr/bin/env node

function parseArgs(argv) {
  const parsed = {};

  for (const entry of argv) {
    if (!entry.startsWith("--")) {
      continue;
    }

    const [rawKey, rawValue] = entry.slice(2).split("=");
    parsed[rawKey] = rawValue ?? "true";
  }

  return parsed;
}

function formatPercent(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printProviderSummary(report) {
  printSection("Provider Summary");

  console.log(
    `selected preset: ${report.selectedPreset} | comparePresets=${report.comparePresets ? "yes" : "no"}`,
  );

  for (const market of ["mercari", "bunjang", "fruitsfamily"]) {
    const summary = report.providerSummary[market];
    console.log(
      `${market.padEnd(12)} useful ${formatPercent(summary.usefulRate)} | success ${formatPercent(summary.successRate)} | fallback ${formatPercent(summary.fallbackRate)} | top rel ${summary.averageTopRelevance.toFixed(3)} | top conf ${summary.averageTopConfidence.toFixed(3)}`,
    );

    const topVariants = summary.variantLeaderboard.slice(0, 3);
    if (topVariants.length > 0) {
      console.log(
        `  best variants: ${topVariants
          .map(
            (variant) =>
              `${variant.variantKey} (${variant.usefulCount}/${variant.usageCount}, avg normalized ${variant.averageNormalizedCount.toFixed(1)})`,
          )
          .join(" | ")}`,
      );
    }
  }
}

function printPresetComparisons(report) {
  const comparisons = report.queryReports.filter(
    (queryReport) => queryReport.presetComparison && queryReport.presetComparison.variants.length > 0,
  );

  if (comparisons.length === 0) {
    return;
  }

  printSection("Preset Comparisons");

  comparisons.forEach((queryReport) => {
    const comparison = queryReport.presetComparison;
    console.log(
      `- ${queryReport.id}: best=${comparison.bestPreset} | applied=${queryReport.appliedPresetId} (${queryReport.appliedPresetSource})`,
    );

    comparison.variants.forEach((variant) => {
      console.log(
        `  ${String(variant.selectedPreset).padEnd(18)} providers=${variant.providersWithResults} normalized=${variant.normalizedResultTotal} topRel=${variant.averageTopRelevance.toFixed(3)} topConf=${variant.averageTopConfidence.toFixed(3)} reco=${variant.recommendationScore}`,
      );
    });

    if (comparison.notes.length > 0) {
      console.log(`  notes: ${comparison.notes.join(" | ")}`);
    }
  });
}

function printWeakQueries(report) {
  printSection("Weak Queries");

  const weakQueries = report.queryReports.filter((queryReport) => queryReport.issues.length > 0);
  if (weakQueries.length === 0) {
    console.log("No major weak queries detected.");
    return;
  }

  weakQueries.forEach((queryReport) => {
    console.log(`- ${queryReport.id}: ${queryReport.query}`);
    console.log(`  issues: ${queryReport.issues.join(" | ")}`);

    for (const market of ["mercari", "bunjang", "fruitsfamily"]) {
      const provider = queryReport.providers[market];
      console.log(
        `  ${market.padEnd(12)} status=${provider.status} normalized=${provider.normalizedCount} topRel=${provider.topRelevance.toFixed(3)} topConf=${provider.topConfidence.toFixed(3)} fallback=${provider.fallbackUsed ? "yes" : "no"}`,
      );
    }
  });
}

function printTuningPriorities(report) {
  printSection("Tuning Priorities");
  report.tuningPriorities.forEach((priority, index) => {
    console.log(`${index + 1}. ${priority}`);
  });
}

function printRegression(report) {
  printSection("Regression Guard");

  if (report.regression.regressions.length === 0 && report.regression.warnings.length === 0) {
    console.log("No regression warnings.");
    return;
  }

  report.regression.regressions.forEach((entry) => {
    console.log(`FAIL: ${entry}`);
  });
  report.regression.warnings.forEach((entry) => {
    console.log(`WARN: ${entry}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.url ?? process.env.BENCHMARK_BASE_URL ?? "http://localhost:3000";
  const requestUrl = new URL("/api/benchmark", baseUrl);

  if (args.mode) {
    requestUrl.searchParams.set("mode", args.mode);
  }

  if (args.tags) {
    requestUrl.searchParams.set("tags", args.tags);
  }

  if (args.preset) {
    requestUrl.searchParams.set("preset", args.preset);
  }

  if (args.ids) {
    requestUrl.searchParams.set("ids", args.ids);
  }

  if (args.maxQueries) {
    requestUrl.searchParams.set("maxQueries", args.maxQueries);
  }

  if (args.delayMs) {
    requestUrl.searchParams.set("delayMs", args.delayMs);
  }

  if (args.limit) {
    requestUrl.searchParams.set("limit", args.limit);
  }

  if (args.comparePresets) {
    requestUrl.searchParams.set("comparePresets", args.comparePresets);
  }

  const response = await fetch(requestUrl);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Benchmark request failed: ${response.status} ${body}`);
  }

  const report = await response.json();

  if (args.json === "true") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Benchmark run: ${report.queryCount} queries | mode=${report.mode} | preset=${report.selectedPreset} | tags=${(report.selectedTags ?? []).join(",") || "none"}`,
    );
    printProviderSummary(report);
    printPresetComparisons(report);
    printWeakQueries(report);
    printTuningPriorities(report);
    printRegression(report);
  }

  if (args.assert === "true" && report.regression.regressions.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import {
  runMercariSmokePreview,
  runMercariStandalonePreview,
} from "@/lib/providers/mercari/collector";

function parseArgs() {
  const args = process.argv.slice(2);
  const positional: string[] = [];
  let limit = 6;
  let timeoutMs = 18_000;
  let statusHint: "on_sale" | "sold_out" = "on_sale";

  args.forEach((arg) => {
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      return;
    }

    if (arg.startsWith("--timeout=")) {
      const parsed = Number(arg.slice("--timeout=".length));
      if (Number.isFinite(parsed) && parsed > 0) {
        timeoutMs = parsed;
      }
      return;
    }

    if (arg.startsWith("--status=")) {
      const parsed = arg.slice("--status=".length).trim();
      if (parsed === "on_sale" || parsed === "sold_out") {
        statusHint = parsed;
      }
      return;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  });

  return {
    query: positional.join(" ").trim() || "Supreme Box Logo Hoodie 24FW",
    limit,
    timeoutMs,
    statusHint,
  };
}

async function main() {
  const { query, limit, timeoutMs, statusHint } = parseArgs();
  const result =
    statusHint === "on_sale"
      ? await runMercariSmokePreview(query, {
          limit,
          timeoutMs,
        })
      : await runMercariStandalonePreview(query, {
          limit,
          timeoutMs,
          statusHint,
        });

  console.log(
    JSON.stringify(
      {
        query,
        status: result.status,
        rawCount: result.items.length,
        warningCount: result.warnings.length,
        warnings: result.warnings,
        renderer: result.renderer,
        items: result.items,
        variant: {
          key: result.variant.key,
          query: result.variant.query,
          label: result.variant.label,
        },
        diagnostics: result.diagnostics,
        apiRequest: result.diagnostics.apiRequest,
        requestedUrls: result.requestedUrls,
        samples: result.items.slice(0, 5).map((item) => ({
          itemId: item.itemId,
          titleText: item.titleText,
          priceJpy: item.priceJpy,
          status: item.status,
          itemUrl: item.itemUrl,
          imageUrl: item.primaryImageUrl,
          matchedQuery: item.matchedQuery,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

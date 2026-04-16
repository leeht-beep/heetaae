import { runMercariSmokePreview } from "@/lib/providers/mercari/collector";

const query = process.argv.slice(2).join(" ").trim() || "Supreme Box Logo Hoodie 24FW";

async function main() {
  const result = await runMercariSmokePreview(query, {
    limit: 6,
    timeoutMs: 18_000,
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
        variant: {
          key: result.variant.key,
          query: result.variant.query,
          label: result.variant.label,
        },
        diagnostics: result.diagnostics,
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

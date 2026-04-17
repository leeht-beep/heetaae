import { runMercariStandalonePreview } from "@/lib/providers/mercari/collector";

function parseArg(prefix: string): string | undefined {
  return process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
}

const query = process.argv[2]?.trim() || "Supreme Box Logo Hoodie 24FW";
const statusHint = parseArg("--status=") === "sold_out" ? "sold_out" : "on_sale";
const limit = Number(parseArg("--limit=") ?? 24);
const timeoutMs = Number(parseArg("--timeout=") ?? 18_000);

async function main() {
  process.env.MERCARI_WORKER_MODE = "1";
  const result = await runMercariStandalonePreview(query, {
    statusHint,
    limit: Number.isFinite(limit) ? limit : 24,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 18_000,
  });

  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

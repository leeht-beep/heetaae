# Market Resell Web MVP

Responsive Next.js web MVP for cross-market resale analysis across Mercari Japan, Bunjang, and FruitsFamily.

The UI stays stable while the search pipeline is designed to evolve from mock mode to production collectors:

`query preprocessing -> provider fetch -> parser -> normalizer -> ranking/filtering -> aggregation`

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify

```bash
npm run typecheck
npm run build
```

## Current Scope

- Integrated search UI with tabs for recommendation, all, active, sold, and per-market views
- Real collectors for Mercari, Bunjang, and FruitsFamily
- Cost-based resale projection and recommendation scoring
- Search debug payload with provider status, confidence, fallback usage, and query variants
- Benchmark runner, alias dictionary, category presets, and regression guard

## Search Pipeline

Core files:

- `src/lib/utils/query.ts`
- `src/lib/utils/normalize.ts`
- `src/lib/normalizers/shared.ts`
- `src/lib/services/search-service.ts`
- `src/lib/utils/calculations.ts`

## Provider Architecture

Shared contracts:

- `RawMarketCollector`: fetches raw provider responses
- `MarketNormalizer`: converts raw rows into normalized listings
- `MarketDataSource`: binds collectors and normalizer
- `runMarketDataSource`: applies timeout, error handling, normalization, and summary building

Core files:

- `src/lib/providers/base.ts`
- `src/lib/types/market.ts`

## Mercari Reliability Notes

Mercari real collection now uses a session-aware collector in:

- `src/lib/providers/mercari/collector.ts`
- `src/lib/providers/mercari/config.ts`
- `src/lib/providers/mercari/parser.ts`

What changed:

- Stronger blocked detection based on challenge markers plus missing item signals
- Mercari now defaults to a Playwright-based renderer using the local Chrome/Edge binary for real searches
- Playwright collection now extracts item cards from live DOM first, then falls back to HTML parsing only when needed
- Mercari query variants are ordered for stability first: original query, brand/model variants, then localized Japanese fallbacks
- Sold-out scraping is skipped when the active search already consumed most of the provider budget, so active results return reliably instead of timing out
- Session metadata and fingerprint rotation remain available for fallback and debug
- Debug summary includes blocked reasons, requested URLs, session ID, fingerprint ID, cooldown, warmup usage, and browser fallback usage

Useful environment variables:

- `MERCARI_BROWSER_RENDERER=playwright|chrome|auto`
- `MERCARI_SESSION_ROOT_DIR=/custom/path`
- `MERCARI_CHROME_PATH=/path/to/chrome`

Notes:

- The default renderer is `playwright`, backed by the `playwright-core` dependency in `package.json`.
- `auto` can still be used for experimentation, but stable local collection currently prefers Playwright first.
- Persistent session directories live under the configured Mercari session root.

## Bunjang Reliability Notes

Bunjang parser and normalizer now try to salvage more rows before dropping them:

- `src/lib/providers/bunjang/parser.ts`
- `src/lib/providers/bunjang/collector.ts`
- `src/lib/normalizers/bunjangNormalizer.ts`

What changed:

- Parser extracts fallback URL, image, created date, closed date, category, and location more defensively
- Salvaged rows are preserved with `salvaged` and `salvageNotes`
- Drop reason summary is collected and exposed in provider debug payload
- Collector confidence is penalized by malformed and salvaged rows instead of failing the whole provider too early
- Normalization status no longer becomes `partial` just because low-relevance rows were filtered out

## Debug Payload

Provider debug info now includes practical tuning data:

- attempted query variants
- requested URLs
- raw / normalized / filtered counts
- invalid count
- salvaged count
- drop reason summary
- blocked reasons
- fingerprint and session metadata
- fallback and warmup usage

Search debug is visible in development mode on the main page.

## Benchmark and Tuning

Benchmark files:

- `src/lib/benchmarks/dataset.ts`
- `src/lib/benchmarks/runner.ts`
- `src/lib/benchmarks/baseline.ts`
- `src/lib/search/alias-dictionary.ts`
- `src/lib/search/presets.ts`

Run examples:

```bash
npm run benchmark
npm run benchmark -- --tags=core
npm run benchmark -- --comparePresets=true --tags=core
npm run benchmark:assert -- --tags=core
```

API route:

- `GET /api/benchmark`

Useful query parameters:

- `mode`
- `tags`
- `ids`
- `maxQueries`
- `delayMs`
- `limit`
- `preset`
- `comparePresets`

## Provider Mode

Config file:

- `src/lib/config/provider-mode.ts`

Supported modes:

- `real`
- `mock`

You can switch modes with:

- default configuration
- `mode=mock` or `mode=real` on API requests
- `MARKET_PROVIDER_MODE=mock`

## Fixtures

Provider fixtures and parser examples:

- `src/lib/providers/mercari/fixtures.ts`
- `src/lib/providers/mercari/parser.fixture-example.ts`
- `src/lib/providers/bunjang/fixtures.ts`
- `src/lib/providers/bunjang/parser.fixture-example.ts`
- `src/lib/providers/fruitsfamily/fixtures.ts`
- `src/lib/providers/fruitsfamily/parser.fixture-example.ts`

Normalization example:

- `src/lib/utils/normalize.fixture-example.ts`

## Notes

- Market HTML and JSON formats can change without notice, so parser-level maintenance is expected.
- If a provider returns `blocked`, `parse_error`, or `partial`, use the debug payload first before changing ranking logic.
- The project is structured so collector fixes stay isolated from the UI.

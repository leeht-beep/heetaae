import { FruitsfamilyRawListing } from "@/lib/fixtures/types";
import { tokenize } from "@/lib/utils/normalize";
import {
  FRUITSFAMILY_BASE_URL,
  FRUITSFAMILY_SEARCH_PATH_PREFIX,
} from "@/lib/providers/fruitsfamily/config";

export type FruitsfamilyParserSource = "apollo_state" | "fixture";

export interface FruitsfamilyParseResult {
  items: FruitsfamilyRawListing[];
  totalRefs: number;
  resolvedRefs: number;
  malformedEntries: number;
  ignoredEntries: number;
  urlMatchCount: number;
  warnings: string[];
  emptyResult: boolean;
  usedFallbackCollection: boolean;
}

interface ParseFruitsfamilySearchHtmlOptions {
  query: string;
  source: FruitsfamilyParserSource;
}

type ApolloStateRecord = Record<string, unknown>;

interface FruitsfamilyApolloProductRecord {
  __typename?: string;
  id?: string | number;
  title?: string;
  brand?: string;
  status?: string;
  external_url?: string | null;
  resizedSmallImages?: unknown;
  view_count?: number;
  createdAt?: string;
  updatedAt?: string;
  soldAt?: string;
  category?: string;
  description?: string;
  price?: string | number;
  is_visible?: boolean;
  size?: string;
  condition?: string;
}

const APOLLO_STATE_PATTERN =
  /<script[^>]+id="__APOLLO_STATE__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i;
const PRODUCT_PATH_PATTERN = /\/product\/([0-9a-z]+)\/([^"'\\s<]+)/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.-]/g, "");
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseApolloStateFromHtml(html: string): ApolloStateRecord | null {
  const scriptContent = html.match(APOLLO_STATE_PATTERN)?.[1];

  if (!scriptContent) {
    return null;
  }

  try {
    const parsed = JSON.parse(scriptContent) as unknown;
    return isRecord(parsed) ? (parsed as ApolloStateRecord) : null;
  } catch {
    return null;
  }
}

function getSearchResultRefs(
  state: ApolloStateRecord,
  query: string,
): { refs: string[]; usedFallbackCollection: boolean } {
  const root = isRecord(state.ROOT_QUERY) ? state.ROOT_QUERY : null;

  if (root) {
    const normalizedQuery = JSON.stringify(query).slice(1, -1);
    const matchingKey =
      Object.keys(root).find(
        (key) => key.startsWith("searchProducts(") && key.includes(`"query":"${normalizedQuery}"`),
      ) ??
      Object.keys(root).find((key) => key.startsWith("searchProducts("));

    if (matchingKey && Array.isArray(root[matchingKey])) {
      const refs = (root[matchingKey] as unknown[])
        .map((entry) => (isRecord(entry) ? toTrimmedString(entry.__ref) : undefined))
        .filter((value): value is string => Boolean(value));

      return {
        refs,
        usedFallbackCollection: false,
      };
    }
  }

  return {
    refs: Object.keys(state).filter((key) => /^Product(?:NotMine|Mine):/i.test(key)),
    usedFallbackCollection: true,
  };
}

function extractProductUrlMap(html: string): Map<string, string> {
  const urlMap = new Map<string, string>();

  for (const match of html.matchAll(PRODUCT_PATH_PATTERN)) {
    const slug = match[1];
    const path = match[0];

    if (!slug) {
      continue;
    }

    const numericId = Number.parseInt(slug, 36);

    if (!Number.isFinite(numericId)) {
      continue;
    }

    urlMap.set(String(numericId), new URL(path, FRUITSFAMILY_BASE_URL).toString());
  }

  return urlMap;
}

function buildProductUrlFromId(
  productId: string,
  title: string,
): string {
  const numericId = Number.parseInt(productId, 10);

  if (!Number.isFinite(numericId)) {
    return new URL(`/product/${productId}`, FRUITSFAMILY_BASE_URL).toString();
  }

  const base36Id = numericId.toString(36);
  const encodedTitle = encodeURIComponent(title.trim() || productId);

  return new URL(`/product/${base36Id}/${encodedTitle}`, FRUITSFAMILY_BASE_URL).toString();
}

function normalizeStatus(status: string | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  const isSold = ["sold", "sold_out", "soldout", "completed", "archived"].includes(normalized);

  return {
    statusLabel: normalized || "selling",
    isSold,
  };
}

function extractDescriptionTokens(description: string | undefined): string[] {
  if (!description) {
    return [];
  }

  const hashtagMatches = [...description.matchAll(/#([^\s#]+)/g)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set([...hashtagMatches, ...tokenize(description).slice(0, 8)]));
}

function buildListingTokens(
  query: string,
  title: string,
  brand?: string,
  category?: string,
  size?: string,
  description?: string,
  condition?: string,
): string[] {
  return Array.from(
    new Set([
      ...tokenize(query).slice(0, 6),
      ...tokenize(title).slice(0, 8),
      ...(brand ? tokenize(brand).slice(0, 3) : []),
      ...(category ? tokenize(category).slice(0, 3) : []),
      ...(size ? [size] : []),
      ...(condition ? tokenize(condition).slice(0, 2) : []),
      ...extractDescriptionTokens(description),
    ]),
  );
}

function toIsoDate(value: unknown): string | undefined {
  const text = toTrimmedString(value);

  if (!text) {
    return undefined;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toApolloProductRecord(value: unknown): FruitsfamilyApolloProductRecord | null {
  return isRecord(value) ? (value as FruitsfamilyApolloProductRecord) : null;
}

export function buildFruitsfamilySearchUrl(query: string): string {
  return new URL(
    `${FRUITSFAMILY_SEARCH_PATH_PREFIX}${encodeURIComponent(query)}`,
    FRUITSFAMILY_BASE_URL,
  ).toString();
}

export function parseFruitsfamilySearchHtml(
  html: string,
  options: ParseFruitsfamilySearchHtmlOptions,
): FruitsfamilyParseResult {
  const state = parseApolloStateFromHtml(html);

  if (!state) {
    return {
      items: [],
      totalRefs: 0,
      resolvedRefs: 0,
      malformedEntries: 1,
      ignoredEntries: 0,
      urlMatchCount: 0,
      warnings: ["FruitsFamily search page did not include a parseable Apollo state payload."],
      emptyResult: false,
      usedFallbackCollection: false,
    };
  }

  const urlMap = extractProductUrlMap(html);
  const { refs, usedFallbackCollection } = getSearchResultRefs(state, options.query);
  const items: FruitsfamilyRawListing[] = [];
  const warnings: string[] = [];
  let resolvedRefs = 0;
  let malformedEntries = 0;
  let ignoredEntries = 0;

  refs.forEach((ref, index) => {
    const product = toApolloProductRecord(state[ref]);

    if (!product) {
      malformedEntries += 1;
      warnings.push(`FruitsFamily Apollo reference could not be resolved: ${ref}`);
      return;
    }

    const typename = toTrimmedString(product.__typename) ?? "";
    if (!typename.startsWith("Product")) {
      ignoredEntries += 1;
      return;
    }

    resolvedRefs += 1;

    const productId = toTrimmedString(product.id);
    const title = toTrimmedString(product.title);
    const price = toNumber(product.price);
    const imageUrl = Array.isArray(product.resizedSmallImages)
      ? toTrimmedString(product.resizedSmallImages[0])
      : undefined;

    if (!productId || !title || !price || !imageUrl) {
      malformedEntries += 1;
      warnings.push(`FruitsFamily product at index ${index} is missing required fields.`);
      return;
    }

    if (product.is_visible === false && product.status === "selling") {
      ignoredEntries += 1;
      return;
    }

    const normalizedStatus = normalizeStatus(toTrimmedString(product.status));
    const brand = toTrimmedString(product.brand);
    const category = toTrimmedString(product.category);
    const size = toTrimmedString(product.size);
    const description = toTrimmedString(product.description);
    const condition = toTrimmedString(product.condition);
    const soldOutAt =
      toIsoDate(product.soldAt) ??
      (normalizedStatus.isSold ? toIsoDate(product.updatedAt) : undefined);

    items.push({
      slug: productId,
      titleText: title,
      amount: price,
      currencyCode: "KRW",
      coverImageUrl: imageUrl,
      productUrl: urlMap.get(productId) ?? buildProductUrlFromId(productId, title),
      publishedAt: toIsoDate(product.createdAt),
      soldOutAt,
      isSold: normalizedStatus.isSold,
      parserSource: options.source,
      descriptionText: description,
      conditionLabel: condition,
      statusLabel: normalizedStatus.statusLabel,
      labels: {
        brand,
        size,
        category,
      },
      tokens: buildListingTokens(
        options.query,
        title,
        brand,
        category,
        size,
        description,
        condition,
      ),
    });
  });

  return {
    items,
    totalRefs: refs.length,
    resolvedRefs,
    malformedEntries,
    ignoredEntries,
    urlMatchCount: urlMap.size,
    warnings,
    emptyResult: refs.length === 0,
    usedFallbackCollection,
  };
}

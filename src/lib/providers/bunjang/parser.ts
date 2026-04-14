import { BunjangRawListing } from "@/lib/fixtures/types";
import { tokenize } from "@/lib/utils/normalize";
import {
  BUNJANG_API_BASE_URL,
  BUNJANG_IMAGE_RESOLUTION,
  BUNJANG_SEARCH_API_PATH,
  BUNJANG_WEB_BASE_URL,
} from "@/lib/providers/bunjang/config";

export type BunjangParserSource = "api" | "fixture";

export interface BunjangSearchCategoryNode {
  id?: string | number;
  title?: string;
  categories?: BunjangSearchCategoryNode[];
}

export interface BunjangSearchRecord {
  pid?: string | number;
  name?: string;
  price?: string | number;
  product_image?: string;
  status?: string | number;
  ad?: boolean;
  type?: string;
  update_time?: string | number;
  category_id?: string | number;
  location?: string;
}

export interface BunjangSearchResponse {
  result?: string;
  no_result?: boolean;
  no_result_message?: string | null;
  list?: unknown[];
  categories?: BunjangSearchCategoryNode[];
  recommended_categories?: BunjangSearchCategoryNode[];
  associate_keywords?: Array<{ name?: string }>;
  num_found?: number;
}

export interface BunjangParseResult {
  items: BunjangRawListing[];
  totalEntries: number;
  productEntries: number;
  adEntries: number;
  ignoredEntries: number;
  malformedEntries: number;
  warnings: string[];
  emptyResult: boolean;
}

interface ParseBunjangSearchResponseOptions {
  query: string;
  source: BunjangParserSource;
}

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

function toIsoFromEpoch(value: unknown): string | undefined {
  const numeric = toNumber(value);

  if (!numeric) {
    return undefined;
  }

  const epochMs = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(epochMs);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function buildBunjangProductUrl(productId: string): string {
  return new URL(`/products/${productId}`, BUNJANG_WEB_BASE_URL).toString();
}

function resolveBunjangImageUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.includes("{res}")
    ? value.replace("{res}", BUNJANG_IMAGE_RESOLUTION)
    : value;
}

function normalizeSaleStatus(status: unknown): "SALE" | "SOLD_OUT" {
  const normalized = toTrimmedString(status)?.toUpperCase();

  if (!normalized || normalized === "0" || normalized === "SALE" || normalized === "ACTIVE") {
    return "SALE";
  }

  return "SOLD_OUT";
}

function appendCategoryMap(
  nodes: unknown,
  map: Map<string, string>,
) {
  if (!Array.isArray(nodes)) {
    return;
  }

  nodes.forEach((node) => {
    if (!isRecord(node)) {
      return;
    }

    const id = toTrimmedString(node.id);
    const title = toTrimmedString(node.title);

    if (id && title && !map.has(id)) {
      map.set(id, title);
    }

    appendCategoryMap(node.categories, map);
  });
}

function buildKeywordList(
  query: string,
  title: string,
  categoryName?: string,
  associateKeywords?: string[],
): string[] {
  return Array.from(
    new Set([
      ...tokenize(query).slice(0, 6),
      ...tokenize(title).slice(0, 8),
      ...(categoryName ? tokenize(categoryName).slice(0, 3) : []),
      ...(associateKeywords ?? []).slice(0, 6),
    ]),
  );
}

function isEmptyResultResponse(response: Record<string, unknown>, totalEntries: number): boolean {
  if (response.no_result === true) {
    return true;
  }

  if (totalEntries > 0) {
    return false;
  }

  const totalFound = toNumber(response.num_found);
  return totalFound === 0;
}

export function parseBunjangSearchResponse(
  payload: unknown,
  options: ParseBunjangSearchResponseOptions,
): BunjangParseResult {
  if (!isRecord(payload)) {
    return {
      items: [],
      totalEntries: 0,
      productEntries: 0,
      adEntries: 0,
      ignoredEntries: 0,
      malformedEntries: 1,
      warnings: ["Bunjang search response is not a JSON object."],
      emptyResult: false,
    };
  }

  const list = Array.isArray(payload.list) ? payload.list : [];
  const categoryMap = new Map<string, string>();
  appendCategoryMap(payload.categories, categoryMap);
  appendCategoryMap(payload.recommended_categories, categoryMap);

  const associateKeywords = Array.isArray(payload.associate_keywords)
    ? payload.associate_keywords
        .map((keyword) => (isRecord(keyword) ? toTrimmedString(keyword.name) : undefined))
        .filter((keyword): keyword is string => Boolean(keyword))
    : [];

  const items: BunjangRawListing[] = [];
  const warnings: string[] = [];
  let productEntries = 0;
  let adEntries = 0;
  let ignoredEntries = 0;
  let malformedEntries = 0;

  list.forEach((entry, index) => {
    if (!isRecord(entry)) {
      malformedEntries += 1;
      warnings.push(`Bunjang search entry at index ${index} is not an object.`);
      return;
    }

    const type = toTrimmedString(entry.type)?.toUpperCase() ?? "PRODUCT";
    if (type !== "PRODUCT") {
      ignoredEntries += 1;
      if (type.includes("AD")) {
        adEntries += 1;
      }
      return;
    }

    if (entry.ad === true) {
      ignoredEntries += 1;
      adEntries += 1;
      return;
    }

    productEntries += 1;

    const productId = toTrimmedString(entry.pid);
    const subject = toTrimmedString(entry.name);
    const priceKrw = toNumber(entry.price);
    const thumbnailUrl = resolveBunjangImageUrl(toTrimmedString(entry.product_image));
    const categoryId = toTrimmedString(entry.category_id);
    const categoryName = categoryId ? categoryMap.get(categoryId) : undefined;
    const createdAt = toIsoFromEpoch(entry.update_time);
    const saleStatus = normalizeSaleStatus(entry.status);

    if (!productId || !subject || !priceKrw || !thumbnailUrl) {
      malformedEntries += 1;
      warnings.push(`Bunjang product entry at index ${index} is missing required fields.`);
      return;
    }

    items.push({
      productId,
      subject,
      priceKrw,
      thumbnailUrl,
      productUrl: buildBunjangProductUrl(productId),
      createdAt,
      saleStatus,
      parserSource: options.source,
      categoryId,
      locationName: toTrimmedString(entry.location),
      spec: {
        categoryName,
      },
      searchKeywords: buildKeywordList(options.query, subject, categoryName, associateKeywords),
    });
  });

  return {
    items,
    totalEntries: list.length,
    productEntries,
    adEntries,
    ignoredEntries,
    malformedEntries,
    warnings,
    emptyResult: isEmptyResultResponse(payload, list.length),
  };
}

export function parseBunjangSearchResponseText(
  rawText: string,
  options: ParseBunjangSearchResponseOptions,
): BunjangParseResult {
  try {
    return parseBunjangSearchResponse(JSON.parse(rawText) as unknown, options);
  } catch (error) {
    return {
      items: [],
      totalEntries: 0,
      productEntries: 0,
      adEntries: 0,
      ignoredEntries: 0,
      malformedEntries: 1,
      warnings: [
        error instanceof Error
          ? `Failed to parse Bunjang response JSON: ${error.message}`
          : "Failed to parse Bunjang response JSON.",
      ],
      emptyResult: false,
    };
  }
}

export function buildBunjangSearchApiUrl(query: string, requestedCount: number): string {
  const url = new URL(BUNJANG_SEARCH_API_PATH, BUNJANG_API_BASE_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("n", String(requestedCount));
  url.searchParams.set("stat_device", "w");
  url.searchParams.set("version", "5");
  url.searchParams.set("req_ref", "search");
  url.searchParams.set("stat_category_required", "1");

  return url.toString();
}

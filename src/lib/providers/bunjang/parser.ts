import { BunjangRawListing } from "@/lib/fixtures/types";
import { DropReasonSummary } from "@/lib/types/market";
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
  [key: string]: unknown;
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
  salvagedEntries: number;
  dropReasons: DropReasonSummary[];
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

function pickString(entry: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toTrimmedString(entry[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickNumber(entry: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(entry[key]);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function pickStringFromNestedArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }

    if (!isRecord(item)) {
      continue;
    }

    const candidate =
      pickString(item, [
        "url",
        "image",
        "image_url",
        "img_url",
        "thumbnail",
        "thumbnail_url",
      ]) ?? pickStringFromNestedArray(item.images);

    if (candidate) {
      return candidate;
    }
  }

  return undefined;
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

function normalizeSaleStatus(
  status: unknown,
  entry: Record<string, unknown>,
): "SALE" | "SOLD_OUT" {
  const normalized = toTrimmedString(status)?.toUpperCase();

  if (entry.is_soldout === true || entry.is_sold_out === true || entry.sold_out === true) {
    return "SOLD_OUT";
  }

  if (entry.closed_at || entry.sold_at || entry.completed_at) {
    return "SOLD_OUT";
  }

  if (
    normalized &&
    ["1", "2", "SOLD", "SOLDOUT", "SOLD_OUT", "COMPLETE", "COMPLETED"].includes(normalized)
  ) {
    return "SOLD_OUT";
  }

  return "SALE";
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

function pushDropReason(
  target: Map<string, { count: number; examples: string[] }>,
  reason: string,
  example?: string,
) {
  const entry = target.get(reason) ?? { count: 0, examples: [] };
  entry.count += 1;

  if (example && entry.examples.length < 3 && !entry.examples.includes(example)) {
    entry.examples.push(example);
  }

  target.set(reason, entry);
}

function toDropReasonSummary(
  reasons: Map<string, { count: number; examples: string[] }>,
): DropReasonSummary[] {
  return [...reasons.entries()]
    .map(([reason, value]) => ({
      reason,
      count: value.count,
      examples: value.examples,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.reason.localeCompare(right.reason);
    });
}

function resolveProductId(entry: Record<string, unknown>): string | undefined {
  return (
    pickString(entry, ["pid", "id", "product_id", "productId", "seq"]) ??
    pickString(entry, ["product_url", "productUrl", "webUrl", "appUrl"])?.match(/products\/(\d+)/i)?.[1]
  );
}

function resolveSubject(entry: Record<string, unknown>): string | undefined {
  return pickString(entry, [
    "name",
    "subject",
    "title",
    "product_name",
    "productName",
    "display_name",
  ]);
}

function resolvePrice(entry: Record<string, unknown>): number | null {
  return pickNumber(entry, [
    "price",
    "priceKrw",
    "price_krw",
    "sale_price",
    "salePrice",
    "selling_price",
    "trade_price",
  ]);
}

function resolveThumbnail(entry: Record<string, unknown>): string | undefined {
  return resolveBunjangImageUrl(
    pickString(entry, [
      "product_image",
      "thumbnail",
      "thumbnail_url",
      "image",
      "image_url",
      "imageUrl",
      "img_url",
      "imgUrl",
      "photo_url",
    ]) ??
      pickStringFromNestedArray(entry.product_images) ??
      pickStringFromNestedArray(entry.images),
  );
}

function resolveProductUrl(
  entry: Record<string, unknown>,
  productId: string | undefined,
): string | undefined {
  const direct =
    pickString(entry, ["product_url", "productUrl", "webUrl", "share_url", "shareUrl"]) ??
    (productId ? buildBunjangProductUrl(productId) : undefined);

  return direct?.startsWith("http")
    ? direct
    : productId
      ? buildBunjangProductUrl(productId)
      : undefined;
}

function resolveCreatedAt(entry: Record<string, unknown>): string | undefined {
  return (
    toIsoFromEpoch(entry.update_time) ??
    toIsoFromEpoch(entry.created_at) ??
    toIsoFromEpoch(entry.createdAt) ??
    toIsoFromEpoch(entry.updated_at) ??
    toIsoFromEpoch(entry.registered_at) ??
    toIsoFromEpoch(entry.reg_date)
  );
}

function resolveClosedAt(entry: Record<string, unknown>): string | undefined {
  return (
    toIsoFromEpoch(entry.closed_at) ??
    toIsoFromEpoch(entry.closedAt) ??
    toIsoFromEpoch(entry.sold_at) ??
    toIsoFromEpoch(entry.completed_at)
  );
}

function resolveCategoryId(entry: Record<string, unknown>): string | undefined {
  return pickString(entry, ["category_id", "categoryId", "cate_id", "cateId"]);
}

function resolveLocation(entry: Record<string, unknown>): string | undefined {
  return pickString(entry, ["location", "location_name", "region_name", "locationName"]);
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
      salvagedEntries: 0,
      dropReasons: [{ reason: "invalid_payload", count: 1 }],
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
  const dropReasons = new Map<string, { count: number; examples: string[] }>();
  let productEntries = 0;
  let adEntries = 0;
  let ignoredEntries = 0;
  let malformedEntries = 0;
  let salvagedEntries = 0;

  list.forEach((entry, index) => {
    if (!isRecord(entry)) {
      malformedEntries += 1;
      pushDropReason(dropReasons, "invalid_entry", `index:${index}`);
      return;
    }

    const type = pickString(entry, ["type", "item_type"])?.toUpperCase() ?? "PRODUCT";

    if (entry.ad === true) {
      ignoredEntries += 1;
      adEntries += 1;
      pushDropReason(dropReasons, "ad_entry");
      return;
    }

    if (type !== "PRODUCT" && !type.includes("PRODUCT")) {
      ignoredEntries += 1;
      if (type.includes("AD")) {
        adEntries += 1;
        pushDropReason(dropReasons, "ad_entry");
      } else {
        pushDropReason(dropReasons, "non_product_entry", type);
      }
      return;
    }

    productEntries += 1;

    const productId = resolveProductId(entry);
    const subject = resolveSubject(entry);
    const priceKrw = resolvePrice(entry);
    const thumbnailUrl = resolveThumbnail(entry);
    const productUrl = resolveProductUrl(entry, productId);
    const categoryId = resolveCategoryId(entry);
    const categoryName = categoryId ? categoryMap.get(categoryId) : undefined;
    const createdAt = resolveCreatedAt(entry);
    const closedAt = resolveClosedAt(entry);
    const saleStatus = normalizeSaleStatus(entry.status ?? entry.sale_status, entry);
    const salvageNotes: string[] = [];

    if (!productId) {
      malformedEntries += 1;
      pushDropReason(dropReasons, "missing_product_id", `index:${index}`);
      return;
    }

    if (!subject) {
      malformedEntries += 1;
      pushDropReason(dropReasons, "missing_title", productId);
      return;
    }

    if (!priceKrw) {
      malformedEntries += 1;
      pushDropReason(dropReasons, "missing_price", subject);
      return;
    }

    if (!thumbnailUrl) {
      salvagedEntries += 1;
      salvageNotes.push("missing_thumbnail");
    }

    if (!productUrl) {
      salvagedEntries += 1;
      salvageNotes.push("missing_product_url");
    }

    items.push({
      productId,
      subject,
      priceKrw,
      thumbnailUrl,
      productUrl: productUrl ?? buildBunjangProductUrl(productId),
      createdAt,
      closedAt,
      saleStatus,
      parserSource: options.source,
      salvaged: salvageNotes.length > 0,
      salvageNotes,
      parserWarnings: salvageNotes.length > 0 ? [...salvageNotes] : undefined,
      categoryId,
      locationName: resolveLocation(entry),
      spec: {
        categoryName,
      },
      searchKeywords: buildKeywordList(options.query, subject, categoryName, associateKeywords),
    });
  });

  const dropReasonSummary = toDropReasonSummary(dropReasons);

  if (salvagedEntries > 0) {
    warnings.push(`Salvaged ${salvagedEntries} Bunjang rows with fallback field rules.`);
  }

  dropReasonSummary.slice(0, 4).forEach((reason) => {
    warnings.push(`Dropped ${reason.count} rows due to ${reason.reason}.`);
  });

  return {
    items,
    totalEntries: list.length,
    productEntries,
    adEntries,
    ignoredEntries,
    malformedEntries,
    salvagedEntries,
    dropReasons: dropReasonSummary,
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
      salvagedEntries: 0,
      dropReasons: [{ reason: "invalid_json", count: 1 }],
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

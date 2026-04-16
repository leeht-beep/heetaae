import type { MercariRawListing } from "@/lib/fixtures/types";
import { MERCARI_BASE_URL } from "@/lib/providers/mercari/config";

export type MercariSearchStatus = "on_sale" | "sold_out";

export interface MercariParseResult {
  items: MercariRawListing[];
  totalCells: number;
  ignoredCells: number;
  warnings: string[];
  foundItemGrid: boolean;
  emptyResult: boolean;
}

export interface MercariDomCardSnapshot {
  href?: string;
  titleText?: string;
  priceText?: string;
  imageUrl?: string;
  soldBadgeText?: string;
  textContent?: string;
}

interface MercariSearchApiPhoto {
  uri?: string;
}

interface MercariSearchApiBrand {
  name?: string;
}

interface MercariSearchApiSize {
  name?: string;
}

interface MercariSearchApiItem {
  id?: string;
  status?: string;
  name?: string;
  price?: string | number;
  created?: string | number;
  updated?: string | number;
  thumbnails?: string[];
  photos?: MercariSearchApiPhoto[];
  itemType?: string;
  itemBrand?: MercariSearchApiBrand | null;
  itemSize?: MercariSearchApiSize | null;
  itemSizes?: MercariSearchApiSize[];
  categoryId?: string | number;
}

interface MercariSearchApiResponse {
  meta?: {
    numFound?: string | number;
  };
  items?: MercariSearchApiItem[];
}

interface ParseMercariSearchHtmlOptions {
  statusHint: MercariSearchStatus;
  source: "http" | "rendered_dom" | "playwright" | "fixture";
  includeShops?: boolean;
}

interface ParseMercariDomCardsOptions extends ParseMercariSearchHtmlOptions {
  foundItemGrid?: boolean;
  emptyResult?: boolean;
  warnings?: string[];
}

interface ParseMercariSearchApiOptions extends ParseMercariSearchHtmlOptions {
  apiUrl?: string;
}

const ITEM_LINK_PATTERN = /<a[^>]+href="([^"]*\/item\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const IMAGE_ALT_PATTERN = /<img[^>]+alt="([^"]*)"/i;
const IMAGE_SRC_PATTERN = /<img[^>]+(?:src|data-src)="([^"]+)"/i;
const IMAGE_SRCSET_PATTERN = /<img[^>]+srcset="([^"]+)"/i;
const PRICE_WITH_SYMBOL_PATTERN = /(?:¥|&yen;)\s*([\d,]+)/i;
const PRICE_FALLBACK_PATTERN = /\b([\d,]{3,})\b/;
const EMPTY_RESULT_PATTERN = /(出品された商品がありません|no results)/i;
const SOLD_BADGE_PATTERN = /(売り切れ|sold)/i;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&yen;/gi, "¥");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function extractVisibleText(html: string): string {
  return normalizeWhitespace(stripHtml(html));
}

function cleanTitle(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\s*(?:売り切れ|sold)\s*/giu, " ")
    .replace(/\s+(?:¥|&yen;)\s*[\d,]+.*$/iu, "")
    .trim();
}

function toAbsoluteMercariUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, MERCARI_BASE_URL).toString();
  } catch {
    return `${MERCARI_BASE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  }
}

function normalizeImageUrl(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = decodeHtmlEntities(value).trim();

  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes(",")) {
    const firstSource = trimmed
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .find(Boolean);

    return normalizeImageUrl(firstSource);
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  try {
    return new URL(trimmed, MERCARI_BASE_URL).toString();
  } catch {
    return trimmed;
  }
}

function fallbackImageUrlFromItemId(itemId?: string): string | undefined {
  if (!itemId) {
    return undefined;
  }

  return `https://static.mercdn.net/thumb/item/webp/${itemId}_1.jpg`;
}

function extractImageUrl(fragmentHtml: string): string | undefined {
  const direct = fragmentHtml.match(IMAGE_SRC_PATTERN)?.[1];

  if (direct) {
    return normalizeImageUrl(direct);
  }

  const srcSet = fragmentHtml.match(IMAGE_SRCSET_PATTERN)?.[1];
  return normalizeImageUrl(srcSet);
}

function parsePriceYenFromText(value?: string): number | null {
  const normalizedText = normalizeWhitespace(value ?? "");
  const priceMatch =
    normalizedText.match(PRICE_WITH_SYMBOL_PATTERN)?.[1] ??
    normalizedText.match(PRICE_FALLBACK_PATTERN)?.[1];
  const digits = (priceMatch ?? "").replace(/[^\d]/g, "");

  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUnixTimestamp(value?: string | number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const digits = String(value).replace(/[^\d]/g, "");

  if (!digits) {
    return undefined;
  }

  const parsed = Number(digits);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  const milliseconds = digits.length > 10 ? parsed : parsed * 1000;
  const iso = new Date(milliseconds).toISOString();

  return iso === "Invalid Date" ? undefined : iso;
}

function resolveApiListingUrl(item: MercariSearchApiItem): string | undefined {
  const itemId = item.id?.trim();

  if (!itemId) {
    return undefined;
  }

  if ((item.itemType ?? "").toUpperCase() === "ITEM_TYPE_BEYOND") {
    return toAbsoluteMercariUrl(`/shops/product/${itemId}`);
  }

  return toAbsoluteMercariUrl(`/item/${itemId}`);
}

function resolveApiListingType(statusHint: MercariSearchStatus, status?: string) {
  if ((status ?? "").toUpperCase() === "ITEM_STATUS_SOLD_OUT") {
    return "sold_out" as const;
  }

  return resolveListingType(statusHint, status);
}

function resolveListingType(
  statusHint: MercariSearchStatus,
  textContent?: string,
  soldBadgeText?: string,
) {
  if (statusHint === "sold_out") {
    return "sold_out" as const;
  }

  if (SOLD_BADGE_PATTERN.test(`${textContent ?? ""} ${soldBadgeText ?? ""}`)) {
    return "sold_out" as const;
  }

  return "on_sale" as const;
}

function buildMercariListingFromParts(
  parts: {
    href?: string;
    titleText?: string;
    priceText?: string;
    imageUrl?: string;
    textContent?: string;
    soldBadgeText?: string;
  },
  options: ParseMercariSearchHtmlOptions,
): { listing?: MercariRawListing; ignored?: string } {
  const href = parts.href?.trim();

  if (!href) {
    return { ignored: "Mercari fragment is missing item URL." };
  }

  if (!options.includeShops && href.startsWith("/shops/")) {
    return { ignored: `Ignored mercari shops listing: ${href}` };
  }

  const itemId = href.match(/\/item\/([^/?"]+)/i)?.[1];
  const mergedText = normalizeWhitespace(`${parts.titleText ?? ""} ${parts.textContent ?? ""}`);
  const titleText = cleanTitle(parts.titleText ?? mergedText);
  const priceJpy = parsePriceYenFromText(parts.priceText ?? mergedText);
  const imageUrl = normalizeImageUrl(parts.imageUrl) ?? fallbackImageUrlFromItemId(itemId);

  if (!itemId || !titleText || !priceJpy || !imageUrl) {
    return {
      ignored: `Mercari fragment is missing required fields for ${href}.`,
    };
  }

  return {
    listing: {
      itemId,
      titleText,
      priceJpy,
      primaryImageUrl: imageUrl,
      itemUrl: toAbsoluteMercariUrl(href),
      status: resolveListingType(options.statusHint, mergedText, parts.soldBadgeText),
      itemType: "ITEM_TYPE_MERCARI",
      parserSource: options.source,
    },
  };
}

function buildListingFromHtmlFragment(
  fragmentHtml: string,
  href: string,
  options: ParseMercariSearchHtmlOptions,
) {
  const textContent = extractVisibleText(fragmentHtml);
  const imageAlt = fragmentHtml.match(IMAGE_ALT_PATTERN)?.[1];
  const thumbnailName =
    fragmentHtml.match(/data-testid="thumbnail-item-name"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];

  return buildMercariListingFromParts(
    {
      href,
      titleText: cleanTitle(normalizeWhitespace(thumbnailName ?? imageAlt ?? textContent)),
      priceText: textContent,
      imageUrl: extractImageUrl(fragmentHtml),
      soldBadgeText:
        fragmentHtml.match(/data-testid="thumbnail-sticker"[^>]+aria-label="([^"]+)"/i)?.[1] ??
        undefined,
      textContent,
    },
    options,
  );
}

export function parseMercariDomCards(
  cards: MercariDomCardSnapshot[],
  options: ParseMercariDomCardsOptions,
): MercariParseResult {
  const warnings = [...(options.warnings ?? [])];
  const items: MercariRawListing[] = [];
  const seenIds = new Set<string>();
  let ignoredCells = 0;

  cards.forEach((card) => {
    const parsed = buildMercariListingFromParts(card, options);

    if (parsed.listing?.itemId && !seenIds.has(parsed.listing.itemId)) {
      seenIds.add(parsed.listing.itemId);
      items.push(parsed.listing);
      return;
    }

    ignoredCells += 1;

    if (parsed.ignored) {
      warnings.push(parsed.ignored);
    }
  });

  return {
    items,
    totalCells: cards.length,
    ignoredCells,
    warnings,
    foundItemGrid: options.foundItemGrid ?? cards.length > 0,
    emptyResult: options.emptyResult ?? false,
  };
}

export function parseMercariSearchApiResponse(
  payload: unknown,
  options: ParseMercariSearchApiOptions,
): MercariParseResult {
  const warnings: string[] = [];
  const items: MercariRawListing[] = [];
  const seenIds = new Set<string>();
  const response = (payload ?? {}) as MercariSearchApiResponse;
  const apiItems = Array.isArray(response.items) ? response.items : [];
  let ignoredCells = 0;

  apiItems.forEach((item) => {
    const itemId = item.id?.trim();
    const titleText = cleanTitle(item.name ?? "");
    const priceJpy = parsePriceYenFromText(String(item.price ?? ""));
    const imageUrl =
      normalizeImageUrl(item.photos?.[0]?.uri) ??
      normalizeImageUrl(item.thumbnails?.[0]) ??
      fallbackImageUrlFromItemId(itemId);
    const itemUrl = resolveApiListingUrl(item);

    if (!itemId || !titleText || !priceJpy || !imageUrl || !itemUrl) {
      ignoredCells += 1;
      warnings.push(
        `Mercari API item could not be normalized${itemId ? ` (${itemId})` : ""}.`,
      );
      return;
    }

    if (seenIds.has(itemId)) {
      ignoredCells += 1;
      return;
    }

    seenIds.add(itemId);
    items.push({
      itemId,
      titleText,
      priceJpy,
      primaryImageUrl: imageUrl,
      itemUrl,
      postedAt: parseUnixTimestamp(item.created),
      purchasedAt:
        resolveApiListingType(options.statusHint, item.status) === "sold_out"
          ? parseUnixTimestamp(item.updated)
          : undefined,
      status: resolveApiListingType(options.statusHint, item.status),
      itemType: item.itemType ?? "ITEM_TYPE_MERCARI",
      parserSource: options.source,
      attributes: {
        brand: cleanTitle(item.itemBrand?.name ?? ""),
        size: cleanTitle(
          item.itemSize?.name ??
            item.itemSizes?.find((entry) => entry?.name?.trim())?.name ??
            "",
        ),
        category: item.categoryId ? String(item.categoryId) : undefined,
      },
    });
  });

  const metaCount = Number(response.meta?.numFound ?? apiItems.length);
  const emptyResult = metaCount === 0 || apiItems.length === 0;

  if (!Array.isArray(response.items)) {
    warnings.push("Mercari search API payload was missing an items array.");
  }

  if (apiItems.length > 0 && items.length === 0) {
    warnings.push("Mercari search API returned items, but none could be normalized.");
  }

  return {
    items,
    totalCells: apiItems.length,
    ignoredCells,
    warnings,
    foundItemGrid: apiItems.length > 0,
    emptyResult,
  };
}

export function parseMercariSearchHtml(
  html: string,
  options: ParseMercariSearchHtmlOptions,
): MercariParseResult {
  const warnings: string[] = [];
  const items: MercariRawListing[] = [];
  const seenIds = new Set<string>();
  const emptyResult = EMPTY_RESULT_PATTERN.test(html);
  const foundItemGrid =
    /data-testid="thumbnail-link"/i.test(html) ||
    /href="[^"]*\/item\//i.test(html) ||
    /id="item-grid"/i.test(html);
  let totalCells = 0;
  let ignoredCells = 0;

  for (const match of html.matchAll(ITEM_LINK_PATTERN)) {
    totalCells += 1;
    const href = match[1];
    const fragmentHtml = match[0];
    const parsed = buildListingFromHtmlFragment(fragmentHtml, href, options);

    if (parsed.listing?.itemId && !seenIds.has(parsed.listing.itemId)) {
      seenIds.add(parsed.listing.itemId);
      items.push(parsed.listing);
      continue;
    }

    ignoredCells += 1;

    if (parsed.ignored) {
      warnings.push(parsed.ignored);
    }
  }

  if (foundItemGrid && totalCells > 0 && items.length === 0 && !emptyResult) {
    warnings.push("Mercari HTML contained item links, but no listings could be parsed.");
  }

  if (!foundItemGrid && !emptyResult) {
    warnings.push("Mercari HTML changed and search results could not be parsed.");
  }

  return {
    items,
    totalCells,
    ignoredCells,
    warnings,
    foundItemGrid,
    emptyResult,
  };
}

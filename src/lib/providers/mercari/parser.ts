import { MercariRawListing } from "@/lib/fixtures/types";
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

const ITEM_GRID_PATTERN =
  /<div[^>]+id="item-grid"[^>]*>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i;
const ITEM_CELL_PATTERN = /<li[^>]+data-testid="item-cell"[\s\S]*?<\/li>/gi;
const GENERIC_ITEM_LINK_PATTERN =
  /<a[^>]+href="([^"]*\/item\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const ITEM_IMAGE_ALT_PATTERN = /<img[^>]+alt="([^"]*)"/i;
const ITEM_IMAGE_SRC_PATTERN = /<img[^>]+(?:src|data-src)="([^"]+)"/i;
const ITEM_IMAGE_SRCSET_PATTERN = /<img[^>]+srcset="([^"]+)"/i;
const PRICE_WITH_SYMBOL_PATTERN = /(?:¥|￥|&yen;)\s*([\d,]+)/i;
const PRICE_FALLBACK_PATTERN = /\b([\d,]{3,})\b/;
const EMPTY_RESULT_PATTERN =
  /(no results|検索結果はありません|該当する商品が見つかりませんでした|見つかりませんでした)/i;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function normalizeWhitespace(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function extractVisibleText(html: string): string {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<template[\s\S]*?<\/template>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function cleanTitle(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^\s*(?:Mercari|メルカリ)\s+/i, "")
    .replace(/\s+(?:¥|￥|&yen;)\s*[\d,]+.*$/i, "")
    .trim();
}

function toAbsoluteMercariUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, MERCARI_BASE_URL).toString();
  } catch {
    return `${MERCARI_BASE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  }
}

function extractImageUrl(cellHtml: string): string | undefined {
  const direct = cellHtml.match(ITEM_IMAGE_SRC_PATTERN)?.[1];

  if (direct) {
    return direct;
  }

  const srcSet = cellHtml.match(ITEM_IMAGE_SRCSET_PATTERN)?.[1];
  if (!srcSet) {
    return undefined;
  }

  return srcSet
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean)[0];
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
    const firstSrc = trimmed
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .find(Boolean);

    return normalizeImageUrl(firstSrc);
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

function parsePriceYenFromText(value?: string): number | null {
  const normalizedText = normalizeWhitespace(value ?? "");
  const priceMatch =
    normalizedText.match(PRICE_WITH_SYMBOL_PATTERN)?.[1] ??
    normalizedText.match(PRICE_FALLBACK_PATTERN)?.[1];
  const normalized = (priceMatch ?? "").replace(/[^\d]/g, "");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveListingType(
  statusHint: MercariSearchStatus,
  textContent?: string,
  soldBadgeText?: string,
) {
  if (statusHint === "sold_out") {
    return "sold_out" as const;
  }

  const mergedText = `${textContent ?? ""} ${soldBadgeText ?? ""}`;

  if (/sold|売り切れ|thumbnail-sticker/i.test(mergedText)) {
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
    return { ignored: "Mercari item fragment is missing an item URL." };
  }

  if (!options.includeShops && href.startsWith("/shops/")) {
    return { ignored: `Ignored mercari shops listing: ${href}` };
  }

  const itemId = href.match(/\/item\/([^/?"]+)/i)?.[1];
  const titleText = cleanTitle(parts.titleText ?? parts.textContent ?? "");
  const priceJpy = parsePriceYenFromText(parts.priceText ?? parts.textContent);
  const imageUrl = normalizeImageUrl(parts.imageUrl);

  if (!itemId || !titleText || !priceJpy || !imageUrl) {
    return {
      ignored: `Mercari item fragment is missing required fields for ${href}.`,
    };
  }

  return {
    listing: {
      itemId,
      titleText,
      priceJpy,
      primaryImageUrl: imageUrl,
      itemUrl: toAbsoluteMercariUrl(href),
      status: resolveListingType(options.statusHint, parts.textContent, parts.soldBadgeText),
      itemType: "ITEM_TYPE_MERCARI",
      parserSource: options.source,
    },
  };
}

function buildListingFromFragment(
  cellHtml: string,
  options: ParseMercariSearchHtmlOptions,
): { listing?: MercariRawListing; ignored?: string } {
  const href = cellHtml.match(/href="([^"]*\/item\/[^"]+)"/i)?.[1];

  return buildMercariListingFromParts(
    {
      href,
      titleText:
        cellHtml.match(ITEM_IMAGE_ALT_PATTERN)?.[1] ??
        cellHtml.match(/aria-label="([^"]+)"/i)?.[1] ??
        extractVisibleText(cellHtml),
      priceText: extractVisibleText(cellHtml),
      imageUrl: extractImageUrl(cellHtml),
      textContent: extractVisibleText(cellHtml),
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

export function parseMercariSearchHtml(
  html: string,
  options: ParseMercariSearchHtmlOptions,
): MercariParseResult {
  const warnings: string[] = [];
  const items: MercariRawListing[] = [];
  const seenIds = new Set<string>();
  const gridMatch = html.match(ITEM_GRID_PATTERN);
  const scopedHtml = gridMatch?.[1] ?? html;
  const directCells = [...scopedHtml.matchAll(ITEM_CELL_PATTERN)].map((match) => match[0]);
  const fallbackCells =
    directCells.length > 0
      ? directCells
      : [...scopedHtml.matchAll(GENERIC_ITEM_LINK_PATTERN)].map((match) => match[0]);
  const visibleText = extractVisibleText(html);
  const emptyResult = fallbackCells.length === 0 && EMPTY_RESULT_PATTERN.test(visibleText);
  let ignoredCells = 0;

  fallbackCells.forEach((cellHtml) => {
    const parsed = buildListingFromFragment(cellHtml, options);

    if (parsed.listing && parsed.listing.itemId && !seenIds.has(parsed.listing.itemId)) {
      seenIds.add(parsed.listing.itemId);
      items.push(parsed.listing);
      return;
    }

    ignoredCells += 1;

    if (parsed.ignored) {
      warnings.push(parsed.ignored);
    }
  });

  if (fallbackCells.length === 0 && !emptyResult) {
    warnings.push("Mercari item grid was not found in the collected HTML.");
  }

  return {
    items,
    totalCells: fallbackCells.length,
    ignoredCells,
    warnings,
    foundItemGrid: Boolean(gridMatch),
    emptyResult,
  };
}

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

interface ParseMercariSearchHtmlOptions {
  statusHint: MercariSearchStatus;
  source: "http" | "rendered_dom" | "fixture";
  includeShops?: boolean;
}

const ITEM_GRID_PATTERN =
  /<div[^>]+id="item-grid"[^>]+data-testid="search-item-grid"[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i;
const ITEM_CELL_PATTERN = /<li[^>]+data-testid="item-cell"[\s\S]*?<\/li>/gi;
const ITEM_LINK_PATTERN = /<a[^>]+href="([^"]+)"[^>]+data-testid="thumbnail-link"/i;
const ITEM_CONTAINER_PATTERN =
  /<div[^>]+class="[^"]*merItemThumbnail[^"]*"[^>]+aria-label="([^"]*)"[^>]+id="([^"]+)"[^>]+itemtype="([^"]+)"/i;
const ITEM_IMAGE_LABEL_PATTERN =
  /<div[^>]+class="[^"]*imageContainer[^"]*"[^>]+aria-label="([^"]+)"/i;
const ITEM_IMAGE_ALT_PATTERN = /<img[^>]+alt="([^"]*)"/i;
const ITEM_IMAGE_SRC_PATTERN = /<img[^>]+src="([^"]+)"/i;
const ITEM_PRICE_PATTERN = /<span class="number__[^"]*">([\d,]+)<\/span>/i;
const EMPTY_RESULT_PATTERNS = [
  /検索結果はありません/u,
  /該当する商品がありません/u,
];

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
    .replace(/(?:の)?サムネイル$/u, "")
    .replace(/の画像$/u, "")
    .replace(/\s+(売り切れ|販売中|公開停止中)\s+\d[\d,]*円?$/u, "")
    .replace(/\s+\d[\d,]*円?$/u, "")
    .trim();
}

function toAbsoluteMercariUrl(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl, MERCARI_BASE_URL).toString();
  } catch {
    return `${MERCARI_BASE_URL}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  }
}

function parsePriceYen(cellHtml: string, ariaLabel: string | undefined): number | null {
  const priceMatch = cellHtml.match(ITEM_PRICE_PATTERN)?.[1];
  const fallbackMatch = ariaLabel?.match(/(\d[\d,]*)円/u)?.[1];
  const normalized = (priceMatch ?? fallbackMatch ?? "").replace(/[^\d]/g, "");

  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveListingType(cellHtml: string, statusHint: MercariSearchStatus, ariaLabel?: string) {
  if (statusHint === "sold_out") {
    return "sold_out" as const;
  }

  if (/data-testid="thumbnail-sticker"/i.test(cellHtml)) {
    return "sold_out" as const;
  }

  if (ariaLabel && /売り切れ|公開停止/u.test(ariaLabel)) {
    return "sold_out" as const;
  }

  return "on_sale" as const;
}

function buildListingFromCell(
  cellHtml: string,
  options: ParseMercariSearchHtmlOptions,
): { listing?: MercariRawListing; ignored?: string } {
  const href = cellHtml.match(ITEM_LINK_PATTERN)?.[1];
  const thumbnailMatch = cellHtml.match(ITEM_CONTAINER_PATTERN);
  const outerAriaLabel = thumbnailMatch?.[1];
  const itemId = thumbnailMatch?.[2];
  const itemType = thumbnailMatch?.[3];

  if (!href || !thumbnailMatch) {
    return { ignored: "Mercari item cell is missing href or thumbnail metadata." };
  }

  if (!options.includeShops && (itemType !== "ITEM_TYPE_MERCARI" || href.startsWith("/shops/"))) {
    return { ignored: `Ignored non-mercari listing: ${href}` };
  }

  const titleCandidate =
    cellHtml.match(ITEM_IMAGE_LABEL_PATTERN)?.[1] ??
    cellHtml.match(ITEM_IMAGE_ALT_PATTERN)?.[1] ??
    outerAriaLabel ??
    "";
  const titleText = cleanTitle(titleCandidate);
  const priceJpy = parsePriceYen(cellHtml, outerAriaLabel);
  const imageUrl = cellHtml.match(ITEM_IMAGE_SRC_PATTERN)?.[1];

  if (!itemId || !titleText || !priceJpy || !imageUrl) {
    return { ignored: `Mercari item cell is missing required fields for ${href}.` };
  }

  return {
    listing: {
      itemId,
      titleText,
      priceJpy,
      primaryImageUrl: imageUrl,
      itemUrl: toAbsoluteMercariUrl(href),
      status: resolveListingType(cellHtml, options.statusHint, outerAriaLabel),
      itemType,
      parserSource: options.source,
    },
  };
}

export function parseMercariSearchHtml(
  html: string,
  options: ParseMercariSearchHtmlOptions,
): MercariParseResult {
  const gridMatch = html.match(ITEM_GRID_PATTERN);
  const itemHtml = gridMatch?.[1] ?? html;
  const cells = [...itemHtml.matchAll(ITEM_CELL_PATTERN)].map((match) => match[0]);
  const visibleText = extractVisibleText(html);
  const emptyResult =
    cells.length === 0 && EMPTY_RESULT_PATTERNS.some((pattern) => pattern.test(visibleText));
  const warnings: string[] = [];
  const items: MercariRawListing[] = [];
  let ignoredCells = 0;

  cells.forEach((cellHtml) => {
    const parsed = buildListingFromCell(cellHtml, options);

    if (parsed.listing) {
      items.push(parsed.listing);
      return;
    }

    ignoredCells += 1;

    if (parsed.ignored) {
      warnings.push(parsed.ignored);
    }
  });

  if (cells.length === 0 && !emptyResult) {
    warnings.push("Mercari item grid was not found in the collected HTML.");
  }

  return {
    items,
    totalCells: cells.length,
    ignoredCells,
    warnings,
    foundItemGrid: Boolean(gridMatch),
    emptyResult,
  };
}

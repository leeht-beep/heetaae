import type { CurrencyCode } from "@/lib/types/market";

export interface FixtureResponseMeta extends Record<string, unknown> {
  fixtureId: string;
  totalAvailable: number;
  returnedCount: number;
  note?: string;
}

export interface MercariRawListing {
  itemId?: string;
  titleText?: string;
  priceJpy?: number | null;
  primaryImageUrl?: string;
  itemUrl?: string;
  postedAt?: string;
  purchasedAt?: string;
  status?: "on_sale" | "sold_out";
  itemType?: "ITEM_TYPE_MERCARI" | "ITEM_TYPE_BEYOND" | string;
  parserSource?: "http" | "rendered_dom" | "playwright" | "fixture";
  matchedQuery?: string;
  queryVariantKey?: string;
  queryVariantLabel?: string;
  rawConfidence?: number;
  attributes?: {
    size?: string;
    brand?: string;
    model?: string;
    season?: string;
    category?: string;
    keywords?: string[];
  };
}

export interface BunjangRawListing {
  productId?: string;
  subject?: string;
  priceKrw?: number | null;
  thumbnailUrl?: string;
  productUrl?: string;
  createdAt?: string;
  closedAt?: string;
  saleStatus?: "SALE" | "SOLD_OUT";
  parserSource?: "api" | "fixture";
  matchedQuery?: string;
  queryVariantKey?: string;
  queryVariantLabel?: string;
  rawConfidence?: number;
  salvaged?: boolean;
  salvageNotes?: string[];
  parserWarnings?: string[];
  categoryId?: string;
  locationName?: string;
  spec?: {
    sizeLabel?: string;
    brandName?: string;
    modelName?: string;
    seasonName?: string;
    categoryName?: string;
  };
  searchKeywords?: string[];
}

export interface FruitsfamilyRawListing {
  slug?: string;
  titleText?: string;
  amount?: number | null;
  currencyCode?: CurrencyCode;
  coverImageUrl?: string;
  productUrl?: string;
  publishedAt?: string;
  soldOutAt?: string;
  isSold?: boolean;
  parserSource?: "apollo_state" | "fixture";
  matchedQuery?: string;
  queryVariantKey?: string;
  queryVariantLabel?: string;
  rawConfidence?: number;
  descriptionText?: string;
  conditionLabel?: string;
  statusLabel?: string;
  labels?: {
    size?: string;
    brand?: string;
    model?: string;
    season?: string;
    category?: string;
  };
  tokens?: string[];
}

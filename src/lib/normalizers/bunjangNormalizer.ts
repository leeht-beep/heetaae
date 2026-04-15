import { BunjangRawListing } from "@/lib/fixtures/types";
import { normalizeRawItems } from "@/lib/normalizers/shared";
import { MarketNormalizer } from "@/lib/providers/base";
import { normalizeText, tokenize } from "@/lib/utils/normalize";

const KNOWN_BRANDS = [
  "The North Face",
  "New Balance",
  "Chrome Hearts",
  "Comme des Garcons",
  "Arc'teryx",
  "Stone Island",
  "Human Made",
  "Undercover",
  "Supreme",
  "Stussy",
  "Palace",
  "Salomon",
  "Patagonia",
  "Moncler",
  "Balenciaga",
  "Carhartt",
  "Adidas",
  "Converse",
  "Needles",
  "Visvim",
  "Kapital",
  "Asics",
  "Nike",
  "Bape",
  "Vans",
  "아크테릭스",
  "슈프림",
  "스투시",
  "팔라스",
  "파타고니아",
  "살로몬",
  "나이키",
  "아디다스",
].sort((left, right) => right.length - left.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveTitle(rawItem: BunjangRawListing): string {
  const directTitle = rawItem.subject?.trim();

  if (directTitle) {
    return directTitle;
  }

  const fallback = [
    rawItem.spec?.brandName,
    rawItem.spec?.modelName,
    rawItem.spec?.categoryName,
    rawItem.matchedQuery,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim();

  return fallback;
}

function inferBrand(title: string, query: string, providedBrand?: string): string {
  if (providedBrand?.trim()) {
    return providedBrand.trim();
  }

  const normalizedTitle = normalizeText(title);
  const normalizedQuery = normalizeText(query);
  const matchedBrand = KNOWN_BRANDS.find((brand) => {
    const normalizedBrand = normalizeText(brand);
    return normalizedTitle.includes(normalizedBrand) || normalizedQuery.includes(normalizedBrand);
  });

  if (matchedBrand) {
    return matchedBrand;
  }

  return title.trim().split(/\s+/).filter(Boolean)[0] ?? "Unknown";
}

function inferModel(title: string, brand: string, providedModel?: string): string {
  if (providedModel?.trim()) {
    return providedModel.trim();
  }

  const withoutBrand = title
    .replace(new RegExp(`^${escapeRegExp(brand)}\\s*`, "i"), "")
    .trim();

  return (withoutBrand || title).slice(0, 90);
}

function inferSeason(title: string, query: string, providedSeason?: string): string | undefined {
  if (providedSeason?.trim()) {
    return providedSeason.trim();
  }

  const haystack = `${title} ${query}`;
  const seasonMatch = haystack.match(
    /\b(?:fw|ss|aw|fa|spring|summer|fall|winter)\s?\d{2,4}\b/i,
  );

  if (seasonMatch) {
    return seasonMatch[0].replace(/\s+/g, "").toUpperCase();
  }

  return haystack.match(/\b20\d{2}\b/)?.[0];
}

function inferCategory(title: string, providedCategory?: string): string {
  if (providedCategory?.trim()) {
    return providedCategory.trim();
  }

  const normalizedTitle = normalizeText(title);

  if (/후드|후디|hoodie|hooded|sweatshirt/.test(normalizedTitle)) {
    return "hoodie";
  }

  if (/자켓|재킷|패딩|점퍼|바람막이|jacket|jumper|parka|shell/.test(normalizedTitle)) {
    return "jacket";
  }

  if (/셔츠|티셔츠|반팔|긴팔|tee|t shirt|shirt/.test(normalizedTitle)) {
    return "shirt";
  }

  if (/모자|캡|비니|cap|hat|beanie/.test(normalizedTitle)) {
    return "headwear";
  }

  if (/신발|운동화|스니커즈|shoe|sneaker|runner/.test(normalizedTitle)) {
    return "sneakers";
  }

  if (/가방|백팩|토트|bag|backpack|tote/.test(normalizedTitle)) {
    return "bag";
  }

  return "fashion";
}

function inferSize(title: string, providedSize?: string): string | undefined {
  if (providedSize?.trim()) {
    return providedSize.trim();
  }

  const alphaSizeMatch = title.match(/\b(?:XXXL|XXL|XL|L|M|S|XS|OS)\b/i);

  if (alphaSizeMatch) {
    return alphaSizeMatch[0].toUpperCase();
  }

  return title.match(/\b\d{2,3}(?:\.\d)?(?:cm)?\b/i)?.[0];
}

function buildBunjangKeywords(rawItem: BunjangRawListing, title: string): string[] {
  return Array.from(
    new Set([
      ...(rawItem.searchKeywords ?? []),
      ...(rawItem.parserWarnings ?? []),
      ...(rawItem.locationName ? tokenize(rawItem.locationName).slice(0, 2) : []),
      ...tokenize(title).slice(0, 8),
    ]),
  );
}

export const bunjangNormalizer: MarketNormalizer<BunjangRawListing> = {
  market: "bunjang",
  label: "번개장터",
  normalize(context) {
    return normalizeRawItems({
      market: context.market,
      label: context.label,
      query: context.query,
      queryPlan: context.queryPlan,
      rawItems: context.rawItems,
      minRelevanceScore: context.minRelevanceScore,
      mapRawItem: (rawItem) => {
        const title = resolveTitle(rawItem);
        const brand = inferBrand(title, context.query, rawItem.spec?.brandName);
        const model = inferModel(title, brand, rawItem.spec?.modelName);
        const season = inferSeason(title, context.query, rawItem.spec?.seasonName);
        const category = inferCategory(title, rawItem.spec?.categoryName);
        const size = inferSize(title, rawItem.spec?.sizeLabel);
        const salvageNotes = [
          ...(rawItem.salvageNotes ?? []),
          ...(rawItem.parserWarnings ?? []),
        ].filter(Boolean);

        return {
          id: rawItem.productId,
          title,
          price: rawItem.priceKrw,
          currency: "KRW",
          imageUrl: rawItem.thumbnailUrl,
          itemUrl: rawItem.productUrl,
          listedAt: rawItem.createdAt ?? rawItem.closedAt,
          soldAt: rawItem.closedAt,
          listingType: rawItem.saleStatus === "SOLD_OUT" ? "sold" : "active",
          size,
          brand,
          model,
          season,
          category,
          relatedKeywords: buildBunjangKeywords(rawItem, title),
          collectedQuery: rawItem.matchedQuery,
          queryVariantKey: rawItem.queryVariantKey,
          rawConfidence:
            rawItem.rawConfidence ??
            (rawItem.salvaged || salvageNotes.length > 0 ? 0.74 : 0.86),
          salvaged: rawItem.salvaged || salvageNotes.length > 0,
          salvageNotes,
        };
      },
    });
  },
};

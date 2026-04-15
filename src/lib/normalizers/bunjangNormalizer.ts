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
  "엄브로",
  "노스페이스",
  "슈프림",
  "스투시",
  "팔라스",
  "나이키",
  "아디다스",
].sort((left, right) => right.length - left.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  const withoutBrand = title.replace(new RegExp(`^${escapeRegExp(brand)}\\s*`, "i"), "").trim();
  return (withoutBrand || title).slice(0, 80);
}

function inferSeason(title: string, query: string, providedSeason?: string): string | undefined {
  if (providedSeason?.trim()) {
    return providedSeason.trim();
  }

  const haystack = `${title} ${query}`;
  const seasonMatch = haystack.match(/\b(?:fw|ss|aw|fa|spring|summer|fall|winter)\s?\d{2,4}\b/i);

  if (seasonMatch) {
    return seasonMatch[0].replace(/\s+/g, "").toUpperCase();
  }

  const yearMatch = haystack.match(/\b20\d{2}\b/);
  return yearMatch?.[0];
}

function inferCategory(title: string, providedCategory?: string): string {
  if (providedCategory?.trim()) {
    return providedCategory.trim();
  }

  const normalizedTitle = normalizeText(title);

  if (/후드|hoodie|hooded|후드티|후드집업/u.test(normalizedTitle)) {
    return "hoodie";
  }

  if (/자켓|재킷|점퍼|바람막이|jacket|jumper|parka|shell/u.test(normalizedTitle)) {
    return "jacket";
  }

  if (/반팔|긴팔|티셔츠|셔츠|tee|t shirt|shirt/u.test(normalizedTitle)) {
    return "shirt";
  }

  if (/모자|캡|볼캡|캠프캡|비니|cap|hat|beanie/u.test(normalizedTitle)) {
    return "headwear";
  }

  if (/운동화|신발|스니커즈|shoe|sneaker|runner/u.test(normalizedTitle)) {
    return "sneakers";
  }

  if (/가방|백팩|토트|bag|backpack|tote/u.test(normalizedTitle)) {
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

  const numericSizeMatch = title.match(/\b\d{2,3}(?:\.\d)?(?:cm)?\b/i);
  return numericSizeMatch?.[0];
}

function buildBunjangKeywords(title: string, providedKeywords?: string[]): string[] {
  return Array.from(new Set([...(providedKeywords ?? []), ...tokenize(title).slice(0, 8)]));
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
        const title = rawItem.subject ?? "";
        const brand = inferBrand(title, context.query, rawItem.spec?.brandName);
        const model = inferModel(title, brand, rawItem.spec?.modelName);
        const season = inferSeason(title, context.query, rawItem.spec?.seasonName);
        const category = inferCategory(title, rawItem.spec?.categoryName);
        const size = inferSize(title, rawItem.spec?.sizeLabel);

        return {
          id: rawItem.productId,
          title,
          price: rawItem.priceKrw,
          currency: "KRW",
          imageUrl: rawItem.thumbnailUrl,
          itemUrl: rawItem.productUrl,
          listedAt: rawItem.createdAt,
          soldAt: rawItem.closedAt,
          listingType: rawItem.saleStatus === "SOLD_OUT" ? "sold" : "active",
          size,
          brand,
          model,
          season,
          category,
          relatedKeywords: buildBunjangKeywords(title, rawItem.searchKeywords),
          collectedQuery: rawItem.matchedQuery,
          queryVariantKey: rawItem.queryVariantKey,
          rawConfidence: rawItem.rawConfidence,
        };
      },
    });
  },
};

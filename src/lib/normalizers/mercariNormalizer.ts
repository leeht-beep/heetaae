import { MercariRawListing } from "@/lib/fixtures/types";
import { normalizeRawItems } from "@/lib/normalizers/shared";
import { MarketNormalizer } from "@/lib/providers/base";
import { normalizeText, tokenize } from "@/lib/utils/normalize";

const KNOWN_BRANDS = [
  "New Balance",
  "Arc'teryx",
  "The North Face",
  "Comme des Garcons",
  "Supreme",
  "Patagonia",
  "Nike",
  "Adidas",
  "Stussy",
  "Salomon",
  "Asics",
  "Converse",
  "Vans",
  "Bape",
  "Carhartt",
  "Stone Island",
  "Moncler",
  "Balenciaga",
  "Levi's",
  "Chrome Hearts",
  "Kapital",
  "Human Made",
  "Needles",
  "Undercover",
  "Visvim",
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
  const brandMatch = KNOWN_BRANDS.find((brand) => {
    const normalizedBrand = normalizeText(brand);
    return normalizedTitle.includes(normalizedBrand) || normalizedQuery.includes(normalizedBrand);
  });

  if (brandMatch) {
    return brandMatch;
  }

  const titleWords = title.trim().split(/\s+/).filter(Boolean);

  if (titleWords.length >= 2 && titleWords[0]?.toLowerCase() === "new") {
    return titleWords.slice(0, 2).join(" ");
  }

  return titleWords[0] ?? "Unknown";
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
  const seasonMatch = haystack.match(/\b(?:fw|ss|aw|sp|fa)\s?\d{2,4}\b/i);

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

  if (/\bhoodie\b|\bhooded\b|\bsweatshirt\b/u.test(normalizedTitle)) {
    return "hoodie";
  }

  if (/\bfleece\b/u.test(normalizedTitle)) {
    return "fleece";
  }

  if (/\bshell\b|\bparka\b/u.test(normalizedTitle)) {
    return "shell jacket";
  }

  if (/\bjacket\b|\bcoat\b/u.test(normalizedTitle)) {
    return "jacket";
  }

  if (/\bsneaker\b|\bshoe\b|\btrainer\b|\brunner\b|\b990\b|\b991\b|\b992\b|\b993\b/u.test(normalizedTitle)) {
    return "sneakers";
  }

  if (/\bt[- ]?shirt\b|\btee\b|\bshirt\b/u.test(normalizedTitle)) {
    return "shirt";
  }

  if (/\bcap\b|\bhat\b|\bbeanie\b/u.test(normalizedTitle)) {
    return "headwear";
  }

  if (/\bbag\b|\bbackpack\b|\btote\b/u.test(normalizedTitle)) {
    return "bag";
  }

  return "fashion";
}

function inferSize(title: string, providedSize?: string): string | undefined {
  if (providedSize?.trim()) {
    return providedSize.trim();
  }

  const sizeMatch = title.match(/\b(?:XXXL|XXL|XL|L|M|S|XS)\b/i);

  if (sizeMatch) {
    return sizeMatch[0].toUpperCase();
  }

  const numericSizeMatch = title.match(/\b\d{2,3}(?:\.\d)?(?:cm)?\b/i);
  return numericSizeMatch?.[0];
}

function buildMercariKeywords(title: string, providedKeywords?: string[]): string[] {
  const inferredTokens = tokenize(title).slice(0, 8);
  return Array.from(new Set([...(providedKeywords ?? []), ...inferredTokens])).filter(Boolean);
}

export const mercariNormalizer: MarketNormalizer<MercariRawListing> = {
  market: "mercari",
  label: "메루카리",
  normalize(context) {
    return normalizeRawItems({
      market: context.market,
      label: context.label,
      query: context.query,
      rawItems: context.rawItems,
      minRelevanceScore: context.minRelevanceScore,
      mapRawItem: (rawItem) => {
        const title = rawItem.titleText ?? "";
        const brand = inferBrand(title, context.query, rawItem.attributes?.brand);
        const model = inferModel(title, brand, rawItem.attributes?.model);
        const season = inferSeason(title, context.query, rawItem.attributes?.season);
        const category = inferCategory(title, rawItem.attributes?.category);
        const size = inferSize(title, rawItem.attributes?.size);

        return {
          id: rawItem.itemId,
          title,
          price: rawItem.priceJpy,
          currency: "JPY",
          imageUrl: rawItem.primaryImageUrl,
          itemUrl: rawItem.itemUrl,
          listedAt: rawItem.postedAt,
          soldAt: rawItem.purchasedAt,
          listingType: rawItem.status === "sold_out" ? "sold" : "active",
          size,
          brand,
          model,
          season,
          category,
          relatedKeywords: buildMercariKeywords(title, rawItem.attributes?.keywords),
        };
      },
    });
  },
};

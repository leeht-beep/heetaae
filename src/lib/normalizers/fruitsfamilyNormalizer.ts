import { FruitsfamilyRawListing } from "@/lib/fixtures/types";
import { normalizeRawItems } from "@/lib/normalizers/shared";
import { MarketNormalizer } from "@/lib/providers/base";
import { normalizeText, tokenize } from "@/lib/utils/normalize";

const KNOWN_BRANDS = [
  "Comme des Garcons",
  "The North Face",
  "Chrome Hearts",
  "Stone Island",
  "New Balance",
  "Arc'teryx",
  "Human Made",
  "Undercover",
  "Supreme",
  "Stussy",
  "Palace",
  "Salomon",
  "Needles",
  "Patagonia",
  "Moncler",
  "Balenciaga",
  "Carhartt",
  "Converse",
  "A24",
  "47",
  "Nike",
  "Bape",
  "Asics",
  "Vans",
  "슈프림",
  "스투시",
  "팔라스",
  "노스페이스",
  "스톤아일랜드",
  "챔피온",
  "챔피언",
  "나이키",
  "니들즈",
].sort((left, right) => right.length - left.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lowerText(value: string): string {
  return value.toLowerCase().trim();
}

function stripLeadingSizeLabel(title: string): string {
  return title
    .replace(
      /^\s*(?:\[(?:XXXL|XXL|XL|L|M|S|XS|OS|FREE|ONE SIZE)\]|\((?:XXXL|XXL|XL|L|M|S|XS|OS|FREE|ONE SIZE)\)|(?:XXXL|XXL|XL|L|M|S|XS|OS|FREE|ONE SIZE)(?=\s)|(?:XXXL|XXL|XL|L|M|S|XS|OS|FREE|ONE SIZE)\))\s*/i,
      "",
    )
    .trim();
}

function inferBrand(title: string, query: string, providedBrand?: string): string {
  if (providedBrand?.trim()) {
    return providedBrand.trim();
  }

  const normalizedTitle = normalizeText(title);
  const normalizedQuery = normalizeText(query);
  const plainTitle = lowerText(title);
  const plainQuery = lowerText(query);
  const matchedBrand = KNOWN_BRANDS.find((brand) => {
    const plainBrand = lowerText(brand);
    const normalizedBrand = normalizeText(brand);
    return (
      plainTitle.includes(plainBrand) ||
      plainQuery.includes(plainBrand) ||
      normalizedTitle.includes(normalizedBrand) ||
      normalizedQuery.includes(normalizedBrand)
    );
  });

  if (matchedBrand) {
    return matchedBrand;
  }

  return stripLeadingSizeLabel(title).split(/\s+/).filter(Boolean)[0] ?? "Unknown";
}

function inferModel(
  title: string,
  brand: string,
  providedModel?: string,
): string {
  if (providedModel?.trim()) {
    return providedModel.trim();
  }

  const cleanedTitle = stripLeadingSizeLabel(title)
    .replace(/\b(?:정품|새상품|미개봉|풀구성|급처|판매)\b/giu, "")
    .replace(/\s+/g, " ")
    .trim();
  const withoutBrand = cleanedTitle.replace(
    new RegExp(`^${escapeRegExp(brand)}\\s*`, "i"),
    "",
  ).trim();

  return (withoutBrand || cleanedTitle).slice(0, 90);
}

function inferSeason(
  title: string,
  description: string | undefined,
  query: string,
  providedSeason?: string,
): string | undefined {
  if (providedSeason?.trim()) {
    return providedSeason.trim();
  }

  const haystack = `${title} ${description ?? ""} ${query}`;
  const seasonMatch = haystack.match(/\b(?:fw|ss|aw|fa)\s?\d{2,4}\b/i);

  if (seasonMatch) {
    return seasonMatch[0].replace(/\s+/g, "").toUpperCase();
  }

  const yearSeasonMatch = haystack.match(/\b\d{2}(?:ss|fw|aw)\b/i);
  if (yearSeasonMatch) {
    return yearSeasonMatch[0].toUpperCase();
  }

  const yearMatch = haystack.match(/\b20\d{2}\b/);
  return yearMatch?.[0];
}

function inferCategory(
  title: string,
  providedCategory?: string,
): string {
  const plainTitle = lowerText(title);
  const plainCategory = lowerText(providedCategory ?? "");

  if (/후드집업|zip hoodie|hooded zip/u.test(plainTitle)) {
    return "zip hoodie";
  }

  if (/후드|hoodie|hooded/u.test(plainTitle)) {
    return "hoodie";
  }

  if (/티셔츠|반팔|긴팔|t shirt|tee|shirt/u.test(plainTitle)) {
    return "shirt";
  }

  if (/셔츠|flannel|check shirt/u.test(plainTitle)) {
    return "shirt";
  }

  if (/자켓|재킷|jacket|parka|windbreaker|바람막이|데님 자켓/u.test(plainTitle)) {
    return "jacket";
  }

  if (/캡|볼캡|비니|버킷|hat|cap|beanie/u.test(plainTitle)) {
    return "headwear";
  }

  if (/백팩|가방|토트|크로스백|숄더백|bag|backpack|tote/u.test(plainTitle)) {
    return "bag";
  }

  if (/팬츠|반바지|쇼츠|shorts|pants|jeans|denim/u.test(plainTitle)) {
    return "pants";
  }

  if (/스니커즈|신발|shoe|sneaker|boot|로퍼/u.test(plainTitle)) {
    return "sneakers";
  }

  if (/카메라|포스터|러그|오브젝트|라이프|life/u.test(plainTitle)) {
    return "life";
  }

  if (/상의/.test(plainCategory)) {
    return "top";
  }

  if (/아우터/.test(plainCategory)) {
    return "outer";
  }

  if (/하의/.test(plainCategory)) {
    return "pants";
  }

  if (/모자/.test(plainCategory)) {
    return "headwear";
  }

  if (/가방/.test(plainCategory)) {
    return "bag";
  }

  if (/신발/.test(plainCategory)) {
    return "sneakers";
  }

  if (/액세서리/.test(plainCategory)) {
    return "accessory";
  }

  if (/라이프/.test(plainCategory)) {
    return "life";
  }

  return providedCategory?.trim() || "fashion";
}

function inferSize(title: string, providedSize?: string): string | undefined {
  if (providedSize?.trim()) {
    return providedSize.trim();
  }

  const sizeMatch = title.match(/\b(?:XXXL|XXL|XL|L|M|S|XS|OS|FREE|ONE SIZE)\b/i);
  if (sizeMatch) {
    return sizeMatch[0].toUpperCase();
  }

  const numericSizeMatch = title.match(/\b\d{2,3}(?:\.\d)?(?:cm)?\b/i);
  return numericSizeMatch?.[0];
}

function buildFruitsfamilyKeywords(rawItem: FruitsfamilyRawListing): string[] {
  return Array.from(
    new Set([
      ...(rawItem.tokens ?? []),
      ...tokenize(rawItem.titleText ?? "").slice(0, 8),
      ...tokenize(rawItem.descriptionText ?? "").slice(0, 6),
      ...(rawItem.labels?.brand ? tokenize(rawItem.labels.brand).slice(0, 3) : []),
      ...(rawItem.labels?.category ? tokenize(rawItem.labels.category).slice(0, 3) : []),
      ...(rawItem.statusLabel ? tokenize(rawItem.statusLabel).slice(0, 2) : []),
      ...(rawItem.conditionLabel ? tokenize(rawItem.conditionLabel).slice(0, 2) : []),
    ]),
  );
}

export const fruitsfamilyNormalizer: MarketNormalizer<FruitsfamilyRawListing> = {
  market: "fruitsfamily",
  label: "FruitsFamily",
  normalize(context) {
    return normalizeRawItems({
      market: context.market,
      label: context.label,
      query: context.query,
      queryPlan: context.queryPlan,
      rawItems: context.rawItems,
      minRelevanceScore: context.minRelevanceScore,
      mapRawItem: (rawItem) => {
        const title = rawItem.titleText ?? "";
        const brand = inferBrand(title, context.query, rawItem.labels?.brand);
        const model = inferModel(title, brand, rawItem.labels?.model);
        const season = inferSeason(
          title,
          rawItem.descriptionText,
          context.query,
          rawItem.labels?.season,
        );
        const category = inferCategory(title, rawItem.labels?.category);
        const size = inferSize(title, rawItem.labels?.size);

        return {
          id: rawItem.slug,
          title,
          price: rawItem.amount,
          currency: rawItem.currencyCode ?? "KRW",
          imageUrl: rawItem.coverImageUrl,
          itemUrl: rawItem.productUrl,
          listedAt: rawItem.publishedAt,
          soldAt: rawItem.soldOutAt,
          listingType: rawItem.isSold ? "sold" : "active",
          size,
          brand,
          model,
          season,
          category,
          relatedKeywords: buildFruitsfamilyKeywords(rawItem),
          collectedQuery: rawItem.matchedQuery,
          queryVariantKey: rawItem.queryVariantKey,
          rawConfidence: rawItem.rawConfidence,
        };
      },
    });
  },
};

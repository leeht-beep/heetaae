import { NOISE_TERMS } from "@/lib/constants";
import { MarketListing, MockMarketListing } from "@/lib/types/market";

type ListingLike = Pick<
  MockMarketListing | MarketListing,
  | "title"
  | "brand"
  | "model"
  | "season"
  | "category"
  | "size"
  | "normalizedName"
  | "relatedKeywords"
>;

type SignalSource = Partial<ListingLike>;

export interface ListingSignals {
  cleanedTitle: string;
  brandTokens: string[];
  modelTokens: string[];
  categoryTokens: string[];
  sizeTokens: string[];
  colorTokens: string[];
  seasonTokens: string[];
  yearTokens: string[];
  titleTokens: string[];
  relatedKeywordTokens: string[];
  allTokens: string[];
  importantTokens: string[];
  normalizedNameTokens: string[];
  noiseFlags: string[];
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "the",
  "with",
  "상품",
  "판매",
  "매물",
  "출품",
  "당일",
  "국내",
  "해외",
  "배송",
  "무료배송",
  "택배",
  "택포",
  "포함",
  "정품",
  "새상품",
  "미개봉",
  "미사용",
  "실착",
  "착용",
  "상태",
  "좋음",
  "급처",
  "구성",
  "풀구성",
  "본품",
  "단품",
  "구매대행",
  "한정판",
  "정가이하",
]);

const ALLOWED_SINGLE_CHAR_TOKENS = new Set(["x", "v"]);

const CATEGORY_ALIASES = new Map<string, string>([
  ["hooded", "hoodie"],
  ["sweatshirt", "hoodie"],
  ["zipup", "zip"],
  ["zip-up", "zip"],
  ["zip", "zip"],
  ["tee", "shirt"],
  ["tshirt", "shirt"],
  ["sneaker", "sneakers"],
  ["shoe", "sneakers"],
  ["shoes", "sneakers"],
  ["trainer", "sneakers"],
  ["trainers", "sneakers"],
  ["runner", "sneakers"],
  ["runners", "sneakers"],
  ["coat", "jacket"],
  ["parka", "jacket"],
  ["windbreaker", "jacket"],
  ["outer", "jacket"],
  ["캡", "headwear"],
  ["모자", "headwear"],
  ["비니", "headwear"],
  ["후드", "hoodie"],
  ["후디", "hoodie"],
  ["후드티", "hoodie"],
  ["맨투맨", "hoodie"],
  ["티셔츠", "shirt"],
  ["반팔", "shirt"],
  ["긴팔", "shirt"],
  ["신발", "sneakers"],
  ["스니커즈", "sneakers"],
  ["운동화", "sneakers"],
  ["자켓", "jacket"],
  ["재킷", "jacket"],
  ["가방", "bag"],
  ["백팩", "bag"],
  ["토트", "bag"],
  ["바지", "pants"],
  ["팬츠", "pants"],
  ["데님", "pants"],
  ["청바지", "pants"],
]);

const COLOR_ALIASES = new Map<string, string>([
  ["grey", "gray"],
  ["charcoal", "gray"],
  ["blk", "black"],
  ["wht", "white"],
  ["blkwhite", "black"],
  ["블랙", "black"],
  ["검정", "black"],
  ["검은", "black"],
  ["화이트", "white"],
  ["흰색", "white"],
  ["그레이", "gray"],
  ["회색", "gray"],
  ["네이비", "navy"],
  ["올리브", "olive"],
  ["카키", "khaki"],
  ["베이지", "beige"],
  ["브라운", "brown"],
  ["레드", "red"],
  ["블루", "blue"],
  ["그린", "green"],
  ["핑크", "pink"],
  ["퍼플", "purple"],
  ["옐로우", "yellow"],
  ["실버", "silver"],
  ["골드", "gold"],
  ["아이보리", "ivory"],
  ["크림", "cream"],
]);

const SEASON_ALIASES = new Map<string, string>([
  ["aw", "fw"],
  ["fa", "fw"],
  ["fall", "fw"],
  ["winter", "fw"],
  ["autumn", "fw"],
  ["spring", "ss"],
  ["summer", "ss"],
]);

const NOISE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "wanted", pattern: /\b(?:삽니다|구매글|구매\s*원함|looking\s*for|wanted)\b/iu },
  { label: "exchange", pattern: /\b(?:교환|교신|trade)\b/iu },
  { label: "reserved", pattern: /\b(?:예약중|예약|보류|hold|reserved)\b/iu },
  { label: "inquiry", pattern: /\b(?:문의|정품문의|가격문의|dm)\b/iu },
  { label: "request", pattern: /\b(?:구합니다|찾습니다|찾아봐요)\b/iu },
];

const TITLE_CLEANUP_PATTERNS = [
  /\[[^\]]*(?:정품|새상품|미개봉|미사용|급처|택포|무료배송|예약|교환|문의)[^\]]*\]/giu,
  /\([^\)]*(?:정품|새상품|미개봉|미사용|급처|택포|무료배송|예약|교환|문의)[^\)]*\)/giu,
  /\b(?:정품|새상품|미개봉|미사용|실착\s*\d*회?|급처|풀구성|단품|본품|국내판|해외판|무료배송|택포|택배비\s*포함|쿨거래|네고\s*가능|정가이하|상태\s*좋음|상태\s*최상|구성품?)\b/giu,
];

const SIZE_PATTERN =
  /\b(?:XXXL|XXL|XL|L|M|S|XS|OS|O\/S|FREE|ONE\s*SIZE|\d{2,3}(?:\.\d)?(?:cm|mm)?|US\d{1,2}(?:\.\d)?|EU\d{2})\b/giu;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/gu;
const SEASON_PATTERN =
  /\b(?:fw|ss|aw|fa)\s?\d{2,4}\b|\b\d{2}(?:fw|ss|aw|fa)\b|\b(?:spring|summer|fall|winter)\s?\d{2,4}\b/giu;
const COLOR_PATTERN =
  /\b(?:black|white|gray|grey|navy|olive|khaki|beige|brown|red|blue|green|pink|purple|yellow|silver|gold|ivory|cream|charcoal|블랙|화이트|그레이|네이비|올리브|카키|베이지|브라운|레드|블루|그린|핑크|퍼플|옐로우|실버|골드|아이보리|크림|검정|검은|흰색|회색)\b/giu;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens.filter(Boolean))];
}

function lowerText(input: string): string {
  return input.normalize("NFKC").toLowerCase().trim();
}

function canonicalizeToken(token: string): string {
  const normalized = lowerText(token).replace(/[._]/g, "");

  if (CATEGORY_ALIASES.has(normalized)) {
    return CATEGORY_ALIASES.get(normalized) ?? normalized;
  }

  if (COLOR_ALIASES.has(normalized)) {
    return COLOR_ALIASES.get(normalized) ?? normalized;
  }

  if (SEASON_ALIASES.has(normalized)) {
    return SEASON_ALIASES.get(normalized) ?? normalized;
  }

  return normalized;
}

function isMeaningfulToken(token: string): boolean {
  if (!token) {
    return false;
  }

  if (STOP_WORDS.has(token)) {
    return false;
  }

  if (token.length === 1 && !ALLOWED_SINGLE_CHAR_TOKENS.has(token) && !/\d/.test(token)) {
    return false;
  }

  return true;
}

function sanitizeUnknown(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeText(value);

  if (!normalized || ["unknown", "uncategorized", "fashion", "none", "n a"].includes(normalized)) {
    return undefined;
  }

  return value.trim();
}

function tokenSetOverlap(source: string[], target: string[]): number {
  if (source.length === 0 || target.length === 0) {
    return 0;
  }

  const targetSet = new Set(target);
  const overlap = source.filter((token) => targetSet.has(token)).length;
  return overlap / source.length;
}

function jaccardSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }

  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;

  return union > 0 ? intersection / union : 0;
}

function extractMatches(pattern: RegExp, input: string): string[] {
  return uniqueTokens(
    Array.from(input.matchAll(new RegExp(pattern.source, pattern.flags)))
      .map((match) => canonicalizeToken(match[0]?.replace(/\s+/g, "")))
      .filter(Boolean),
  );
}

function removeAttributeTerms(tokens: string[], signals: Pick<
  ListingSignals,
  "brandTokens" | "categoryTokens" | "sizeTokens" | "colorTokens" | "seasonTokens" | "yearTokens"
>): string[] {
  const attributeSet = new Set([
    ...signals.brandTokens,
    ...signals.categoryTokens,
    ...signals.sizeTokens,
    ...signals.colorTokens,
    ...signals.seasonTokens,
    ...signals.yearTokens,
  ]);

  return tokens.filter((token) => !attributeSet.has(token));
}

function inferCategoryTokens(titleTokens: string[], category?: string): string[] {
  const explicitCategory = sanitizeUnknown(category);

  if (explicitCategory) {
    return uniqueTokens(tokenize(explicitCategory));
  }

  const checks: Array<{ token: string; pattern: RegExp }> = [
    { token: "hoodie", pattern: /\b(?:hoodie|hooded|후드|후디|후드티)\b/iu },
    { token: "jacket", pattern: /\b(?:jacket|parka|shell|windbreaker|자켓|재킷)\b/iu },
    { token: "fleece", pattern: /\b(?:fleece|플리스)\b/iu },
    { token: "shirt", pattern: /\b(?:shirt|tee|tshirt|티셔츠|반팔|긴팔)\b/iu },
    { token: "sneakers", pattern: /\b(?:sneakers|shoe|trainer|runner|신발|운동화|스니커즈)\b/iu },
    { token: "bag", pattern: /\b(?:bag|backpack|tote|가방|백팩|토트)\b/iu },
    { token: "headwear", pattern: /\b(?:cap|hat|beanie|모자|캡|비니)\b/iu },
    { token: "pants", pattern: /\b(?:pants|jeans|denim|바지|팬츠|데님|청바지)\b/iu },
  ];

  const normalizedTitle = titleTokens.join(" ");
  const inferred = checks
    .filter((entry) => entry.pattern.test(normalizedTitle))
    .map((entry) => entry.token);

  return uniqueTokens(inferred);
}

function getNoiseFlags(value: string): string[] {
  const lowered = lowerText(value);

  return NOISE_PATTERNS.filter((entry) => entry.pattern.test(lowered)).map((entry) => entry.label);
}

function resolveModelTokens(
  cleanedTitle: string,
  brandTokens: string[],
  categoryTokens: string[],
  sizeTokens: string[],
  colorTokens: string[],
  seasonTokens: string[],
  yearTokens: string[],
  model?: string,
): string[] {
  const explicitModel = sanitizeUnknown(model);
  const explicitTokens = explicitModel ? tokenize(explicitModel) : [];

  if (explicitTokens.length > 0) {
    return uniqueTokens(
      explicitTokens.filter(
        (token) =>
          !brandTokens.includes(token) &&
          !categoryTokens.includes(token) &&
          !sizeTokens.includes(token) &&
          !colorTokens.includes(token),
      ),
    );
  }

  return uniqueTokens(
    tokenize(cleanedTitle).filter(
      (token) =>
        !brandTokens.includes(token) &&
        !categoryTokens.includes(token) &&
        !sizeTokens.includes(token) &&
        !colorTokens.includes(token) &&
        !seasonTokens.includes(token) &&
        !yearTokens.includes(token),
    ),
  );
}

function buildSignals(source: SignalSource): ListingSignals {
  const rawTitle = source.title ?? "";
  const cleanedTitle = normalizeText(removeNoisePhrases(rawTitle));
  const brandTokens = sanitizeUnknown(source.brand) ? uniqueTokens(tokenize(source.brand ?? "")) : [];
  const titleTokens = uniqueTokens(tokenize(cleanedTitle));
  const sizeTokens = uniqueTokens([
    ...extractMatches(SIZE_PATTERN, `${rawTitle} ${source.size ?? ""}`),
    ...tokenize(source.size ?? ""),
  ]);
  const colorTokens = extractMatches(COLOR_PATTERN, rawTitle);
  const seasonTokens = extractMatches(SEASON_PATTERN, `${rawTitle} ${source.season ?? ""}`);
  const yearTokens = extractMatches(YEAR_PATTERN, `${rawTitle} ${source.season ?? ""}`);
  const categoryTokens = inferCategoryTokens(titleTokens, source.category);
  const modelTokens = resolveModelTokens(
    cleanedTitle,
    brandTokens,
    categoryTokens,
    sizeTokens,
    colorTokens,
    seasonTokens,
    yearTokens,
    source.model,
  );
  const relatedKeywordTokens = uniqueTokens((source.relatedKeywords ?? []).flatMap((keyword) => tokenize(keyword)));
  const allTokens = uniqueTokens([
    ...brandTokens,
    ...modelTokens,
    ...categoryTokens,
    ...sizeTokens,
    ...colorTokens,
    ...seasonTokens,
    ...yearTokens,
    ...titleTokens,
    ...relatedKeywordTokens,
  ]);
  const importantTokens = uniqueTokens([
    ...modelTokens.filter((token) => token.length >= 3 || /\d/.test(token)),
    ...removeAttributeTerms(titleTokens, {
      brandTokens,
      categoryTokens,
      sizeTokens,
      colorTokens,
      seasonTokens,
      yearTokens,
    }).filter((token) => token.length >= 4 || /\d/.test(token)),
  ]);
  const normalizedNameTokens = uniqueTokens([
    ...brandTokens,
    ...modelTokens.slice(0, 5),
    ...categoryTokens.slice(0, 2),
    ...seasonTokens.slice(0, 1),
    ...yearTokens.slice(0, 1),
  ]);

  return {
    cleanedTitle,
    brandTokens,
    modelTokens,
    categoryTokens,
    sizeTokens,
    colorTokens,
    seasonTokens,
    yearTokens,
    titleTokens,
    relatedKeywordTokens,
    allTokens,
    importantTokens,
    normalizedNameTokens,
    noiseFlags: getNoiseFlags(rawTitle),
  };
}

function numericTokenPenalty(left: string[], right: string[]): number {
  const leftNumeric = left.filter((token) => /\d/.test(token));
  const rightNumeric = right.filter((token) => /\d/.test(token));

  if (leftNumeric.length === 0 || rightNumeric.length === 0) {
    return 0;
  }

  return jaccardSimilarity(leftNumeric, rightNumeric) === 0 ? 0.18 : 0;
}

function brandMismatchPenalty(left: ListingSignals, right: ListingSignals): number {
  if (left.brandTokens.length === 0 || right.brandTokens.length === 0) {
    return 0;
  }

  return jaccardSimilarity(left.brandTokens, right.brandTokens) === 0 ? 0.28 : 0;
}

function categoryMismatchPenalty(left: ListingSignals, right: ListingSignals): number {
  if (left.categoryTokens.length === 0 || right.categoryTokens.length === 0) {
    return 0;
  }

  return jaccardSimilarity(left.categoryTokens, right.categoryTokens) === 0 ? 0.12 : 0;
}

export function normalizeText(input: string): string {
  return lowerText(input)
    .replace(/['’]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function removeNoisePhrases(input: string): string {
  let cleaned = input.normalize("NFKC");

  TITLE_CLEANUP_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, " ");
  });

  NOISE_PATTERNS.forEach((entry) => {
    cleaned = cleaned.replace(entry.pattern, " ");
  });

  return cleaned.replace(/\s+/g, " ").trim();
}

export function tokenize(input: string): string[] {
  return normalizeText(removeNoisePhrases(input))
    .split(" ")
    .map(canonicalizeToken)
    .filter(isMeaningfulToken);
}

export function extractListingSignals(source: SignalSource): ListingSignals {
  return buildSignals(source);
}

export function buildNormalizedName(
  listing: Pick<MockMarketListing, "title" | "brand" | "model" | "season" | "category" | "size">,
): string {
  const signals = buildSignals(listing);
  const tokens =
    signals.normalizedNameTokens.length > 0
      ? signals.normalizedNameTokens
      : removeAttributeTerms(signals.titleTokens, signals).slice(0, 6);

  return tokens.join(" ").trim();
}

export function buildRelatedKeywords(
  listing: Pick<MockMarketListing, "title" | "brand" | "model" | "season" | "category" | "size">,
): string[] {
  const signals = buildSignals(listing);

  return uniqueTokens([
    ...(listing.brand ? [listing.brand.trim()] : []),
    ...(listing.model ? [listing.model.trim()] : []),
    ...(listing.season ? [listing.season.trim()] : []),
    ...(listing.category ? [listing.category.trim()] : []),
    ...(listing.size ? [listing.size.trim()] : []),
    ...signals.colorTokens,
    ...signals.importantTokens.slice(0, 4),
  ]);
}

export function containsNoiseTerm(value: string): boolean {
  const normalized = normalizeText(value);
  const lowered = lowerText(value);

  return (
    NOISE_TERMS.some((term) => normalized.includes(normalizeText(term))) ||
    NOISE_PATTERNS.some((entry) => entry.pattern.test(lowered))
  );
}

export function matchesSearchQuery(query: string, value: string): boolean {
  const querySignals = buildSignals({ title: query });
  const valueSignals = buildSignals({ title: value });

  if (querySignals.allTokens.length === 0) {
    return true;
  }

  const tokenCoverage = tokenSetOverlap(querySignals.importantTokens.length > 0 ? querySignals.importantTokens : querySignals.allTokens, valueSignals.allTokens);
  const phraseMatch =
    querySignals.cleanedTitle.length > 0 &&
    valueSignals.cleanedTitle.includes(querySignals.cleanedTitle);

  return phraseMatch || tokenCoverage >= 0.35;
}

export function computeRelevanceScore(query: string, listing: ListingLike): number {
  const querySignals = buildSignals({ title: query });
  const listingSignals = buildSignals(listing);

  if (querySignals.allTokens.length === 0) {
    return 0;
  }

  const haystack = normalizeText(
    [
      listing.title,
      listing.brand,
      listing.model,
      listing.season,
      listing.category,
      listing.normalizedName,
      ...(listing.relatedKeywords ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const queryTokens = querySignals.importantTokens.length > 0 ? querySignals.importantTokens : querySignals.allTokens;
  const tokenRecall = tokenSetOverlap(queryTokens, listingSignals.allTokens);
  const tokenJaccard = jaccardSimilarity(queryTokens, listingSignals.allTokens);
  const phraseMatch = querySignals.cleanedTitle.length > 0 && haystack.includes(querySignals.cleanedTitle) ? 1 : 0;
  const brandMatch = tokenSetOverlap(querySignals.allTokens, listingSignals.brandTokens);
  const modelMatch = Math.max(
    tokenSetOverlap(queryTokens, listingSignals.modelTokens),
    jaccardSimilarity(querySignals.importantTokens, listingSignals.importantTokens),
  );
  const categoryMatch = tokenSetOverlap(querySignals.allTokens, listingSignals.categoryTokens);
  const keywordMatch = tokenSetOverlap(querySignals.allTokens, listingSignals.relatedKeywordTokens);
  const exactNormalizedName =
    listing.normalizedName.length > 0 &&
    normalizeText(listing.normalizedName).includes(querySignals.cleanedTitle)
      ? 1
      : 0;
  const mismatchPenalty =
    numericTokenPenalty(querySignals.importantTokens, listingSignals.importantTokens) +
    (brandMatch === 0 && listingSignals.brandTokens.length > 0 && querySignals.allTokens.length > 1 ? 0.08 : 0) +
    (listingSignals.noiseFlags.length > 0 ? 0.2 : 0);

  const score =
    tokenRecall * 0.32 +
    tokenJaccard * 0.12 +
    phraseMatch * 0.14 +
    exactNormalizedName * 0.08 +
    brandMatch * 0.14 +
    modelMatch * 0.13 +
    categoryMatch * 0.04 +
    keywordMatch * 0.03 -
    mismatchPenalty;

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function computeListingSimilarity(left: ListingLike, right: ListingLike): number {
  const leftSignals = buildSignals(left);
  const rightSignals = buildSignals(right);
  const brandScore = jaccardSimilarity(leftSignals.brandTokens, rightSignals.brandTokens);
  const modelScore = Math.max(
    jaccardSimilarity(leftSignals.modelTokens, rightSignals.modelTokens),
    jaccardSimilarity(leftSignals.importantTokens, rightSignals.importantTokens),
  );
  const categoryScore = jaccardSimilarity(leftSignals.categoryTokens, rightSignals.categoryTokens);
  const titleScore = jaccardSimilarity(leftSignals.titleTokens, rightSignals.titleTokens);
  const sizeScore =
    leftSignals.sizeTokens.length > 0 && rightSignals.sizeTokens.length > 0
      ? jaccardSimilarity(leftSignals.sizeTokens, rightSignals.sizeTokens)
      : 0;
  const colorScore =
    leftSignals.colorTokens.length > 0 && rightSignals.colorTokens.length > 0
      ? jaccardSimilarity(leftSignals.colorTokens, rightSignals.colorTokens)
      : 0;
  const seasonScore =
    leftSignals.seasonTokens.length > 0 && rightSignals.seasonTokens.length > 0
      ? jaccardSimilarity(leftSignals.seasonTokens, rightSignals.seasonTokens)
      : 0;
  const penalties =
    brandMismatchPenalty(leftSignals, rightSignals) +
    categoryMismatchPenalty(leftSignals, rightSignals) +
    numericTokenPenalty(leftSignals.importantTokens, rightSignals.importantTokens) +
    (leftSignals.sizeTokens.length > 0 &&
    rightSignals.sizeTokens.length > 0 &&
    sizeScore === 0
      ? 0.06
      : 0) +
    (leftSignals.noiseFlags.length > 0 || rightSignals.noiseFlags.length > 0 ? 0.08 : 0);

  const score =
    brandScore * 0.26 +
    modelScore * 0.3 +
    categoryScore * 0.12 +
    titleScore * 0.2 +
    sizeScore * 0.05 +
    colorScore * 0.03 +
    seasonScore * 0.04 -
    penalties;

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function buildComparableLabel(listing: Pick<
  ListingLike,
  "brand" | "model" | "category" | "title" | "size"
>): string {
  const signals = buildSignals(listing);
  const brand = sanitizeUnknown(listing.brand)?.trim();
  const model = sanitizeUnknown(listing.model)?.trim();
  const category = sanitizeUnknown(listing.category)?.trim();

  if (brand && model) {
    return [brand, model, category].filter(Boolean).join(" ");
  }

  const fallbackTokens =
    signals.normalizedNameTokens.length > 0
      ? signals.normalizedNameTokens
      : removeAttributeTerms(signals.titleTokens, signals).slice(0, 6);

  return fallbackTokens.join(" ").trim() || listing.title.trim();
}

import { NOISE_TERMS } from "@/lib/constants";
import { CategoryPresetId, MarketListing, MockMarketListing } from "@/lib/types/market";
import { getSearchCategoryPreset } from "@/lib/search/presets";

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
  "판매중",
  "판매완료",
  "매물",
  "출품",
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
  "한정판",
  "정가이하",
  "today",
  "new",
]);

const ALLOWED_SINGLE_CHAR_TOKENS = new Set(["x", "v", "m", "l", "s"]);

const CATEGORY_ALIASES = new Map<string, string>([
  ["hooded", "hoodie"],
  ["hoodie", "hoodie"],
  ["후드", "hoodie"],
  ["후디", "hoodie"],
  ["후드티", "hoodie"],
  ["sweatshirt", "hoodie"],
  ["맨투맨", "hoodie"],
  ["zipup", "zip"],
  ["zip-up", "zip"],
  ["tee", "shirt"],
  ["tshirt", "shirt"],
  ["t-shirt", "shirt"],
  ["shirt", "shirt"],
  ["티셔츠", "shirt"],
  ["반팔", "shirt"],
  ["긴팔", "shirt"],
  ["jacket", "jacket"],
  ["자켓", "jacket"],
  ["재킷", "jacket"],
  ["parka", "jacket"],
  ["shell", "jacket"],
  ["outer", "jacket"],
  ["fleece", "fleece"],
  ["플리스", "fleece"],
  ["shoe", "sneakers"],
  ["shoes", "sneakers"],
  ["sneaker", "sneakers"],
  ["sneakers", "sneakers"],
  ["runner", "sneakers"],
  ["trainers", "sneakers"],
  ["운동화", "sneakers"],
  ["스니커즈", "sneakers"],
  ["신발", "sneakers"],
  ["bag", "bag"],
  ["backpack", "bag"],
  ["tote", "bag"],
  ["가방", "bag"],
  ["백팩", "bag"],
  ["토트", "bag"],
  ["cap", "headwear"],
  ["hat", "headwear"],
  ["beanie", "headwear"],
  ["모자", "headwear"],
  ["캡", "headwear"],
  ["비니", "headwear"],
  ["pants", "pants"],
  ["jeans", "pants"],
  ["denim", "pants"],
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
  ["black", "black"],
  ["블랙", "black"],
  ["검정", "black"],
  ["검은", "black"],
  ["white", "white"],
  ["화이트", "white"],
  ["흰색", "white"],
  ["gray", "gray"],
  ["그레이", "gray"],
  ["회색", "gray"],
  ["navy", "navy"],
  ["네이비", "navy"],
  ["olive", "olive"],
  ["올리브", "olive"],
  ["khaki", "khaki"],
  ["카키", "khaki"],
  ["beige", "beige"],
  ["베이지", "beige"],
  ["brown", "brown"],
  ["브라운", "brown"],
  ["red", "red"],
  ["레드", "red"],
  ["blue", "blue"],
  ["블루", "blue"],
  ["green", "green"],
  ["그린", "green"],
  ["pink", "pink"],
  ["핑크", "pink"],
  ["purple", "purple"],
  ["퍼플", "purple"],
  ["yellow", "yellow"],
  ["옐로우", "yellow"],
  ["silver", "silver"],
  ["실버", "silver"],
  ["gold", "gold"],
  ["골드", "gold"],
  ["ivory", "ivory"],
  ["아이보리", "ivory"],
  ["cream", "cream"],
  ["크림", "cream"],
]);

const SEASON_ALIASES = new Map<string, string>([
  ["aw", "fw"],
  ["fa", "fw"],
  ["fall", "fw"],
  ["autumn", "fw"],
  ["winter", "fw"],
  ["spring", "ss"],
  ["summer", "ss"],
  ["fw", "fw"],
  ["ss", "ss"],
]);

const NOISE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "wanted", pattern: /\b(?:삽니다|구매글|구매\s*원함|wanted|looking\s*for|lf)\b/iu },
  { label: "exchange", pattern: /\b(?:교환|교신|trade)\b/iu },
  { label: "reserved", pattern: /\b(?:예약|예약중|보류|reserved|hold)\b/iu },
  { label: "inquiry", pattern: /\b(?:문의|정품문의|가격문의|dm)\b/iu },
  { label: "request", pattern: /\b(?:구합니다|찾습니다|구해요)\b/iu },
];

const TITLE_CLEANUP_PATTERNS = [
  /\[[^\]]*(?:정품|새상품|미개봉|미사용|급처|택포|무료배송|예약|교환|문의)[^\]]*\]/giu,
  /\([^\)]*(?:정품|새상품|미개봉|미사용|급처|택포|무료배송|예약|교환|문의)[^\)]*\)/giu,
  /\b(?:정품|새상품|미개봉|미사용|실착\s*\d*회?|급처|풀구성|단품|본품|국내판|해외판|무료배송|택포|쿨거래|네고\s*가능|정가이하|상태\s*좋음|상태\s*최상)\b/giu,
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

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
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
  return source.filter((token) => targetSet.has(token)).length / source.length;
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
  return uniq(
    Array.from(input.matchAll(new RegExp(pattern.source, pattern.flags)))
      .map((match) => canonicalizeToken((match[0] ?? "").replace(/\s+/g, "")))
      .filter(Boolean),
  );
}

function removeAttributeTerms(
  tokens: string[],
  signals: Pick<
    ListingSignals,
    "brandTokens" | "categoryTokens" | "sizeTokens" | "colorTokens" | "seasonTokens" | "yearTokens"
  >,
): string[] {
  const blocked = new Set([
    ...signals.brandTokens,
    ...signals.categoryTokens,
    ...signals.sizeTokens,
    ...signals.colorTokens,
    ...signals.seasonTokens,
    ...signals.yearTokens,
  ]);

  return tokens.filter((token) => !blocked.has(token));
}

function inferCategoryTokens(titleTokens: string[], category?: string): string[] {
  const explicit = sanitizeUnknown(category);
  if (explicit) {
    return uniq(tokenize(explicit));
  }

  const title = titleTokens.join(" ");
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

  return uniq(
    checks.filter((entry) => entry.pattern.test(title)).map((entry) => entry.token),
  );
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
    return uniq(
      explicitTokens.filter(
        (token) =>
          !brandTokens.includes(token) &&
          !categoryTokens.includes(token) &&
          !sizeTokens.includes(token) &&
          !colorTokens.includes(token),
      ),
    );
  }

  return uniq(
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

function buildSignals(source: SignalSource, presetId?: CategoryPresetId): ListingSignals {
  const preset = getSearchCategoryPreset(presetId);
  const rawTitle = source.title ?? "";
  const cleanedTitle = normalizeText(removeNoisePhrases(rawTitle));
  const brandTokens = sanitizeUnknown(source.brand) ? uniq(tokenize(source.brand ?? "")) : [];
  const titleTokens = uniq(tokenize(cleanedTitle));
  const sizeTokens = uniq([
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
  const relatedKeywordTokens = uniq(
    (source.relatedKeywords ?? []).flatMap((keyword) => tokenize(keyword)),
  );
  const allTokens = uniq([
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
  const importantTokens = uniq([
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
  const normalizedNameTokens = uniq([
    ...brandTokens,
    ...modelTokens.slice(0, 5),
    ...categoryTokens.slice(0, 2),
    ...seasonTokens.slice(0, 1),
    ...yearTokens.slice(0, 1),
  ]);
  const presetNoiseFlags = uniq([
    ...preset.noiseKeywords.filter((keyword) => lowerText(rawTitle).includes(lowerText(keyword))),
    ...preset.normalizationRules.rejectKeywordPatterns
      .filter((pattern) => pattern.test(rawTitle))
      .map((pattern) => pattern.source),
  ]);
  let adjustedImportantTokens = uniq(importantTokens);

  if (preset.normalizationRules.preserveNumericModelTokens) {
    adjustedImportantTokens = uniq([
      ...adjustedImportantTokens,
      ...modelTokens.filter((token) => /\d/.test(token) || /^[a-z]+\d+[a-z\d]*$/i.test(token)),
    ]);
  }

  if (preset.normalizationRules.importantAttributes.includes("size")) {
    adjustedImportantTokens = uniq([...adjustedImportantTokens, ...sizeTokens]);
  }

  if (preset.normalizationRules.importantAttributes.includes("color")) {
    adjustedImportantTokens = uniq([...adjustedImportantTokens, ...colorTokens]);
  }

  if (preset.normalizationRules.importantAttributes.includes("season")) {
    adjustedImportantTokens = uniq([...adjustedImportantTokens, ...seasonTokens]);
  }

  if (preset.normalizationRules.importantAttributes.includes("year")) {
    adjustedImportantTokens = uniq([...adjustedImportantTokens, ...yearTokens]);
  }

  if (preset.normalizationRules.importantAttributes.includes("serial")) {
    adjustedImportantTokens = uniq([
      ...adjustedImportantTokens,
      ...modelTokens.filter((token) => /\d/.test(token)),
    ]);
  }

  const adjustedNormalizedNameTokens = uniq([
    ...normalizedNameTokens,
    ...(preset.normalizationRules.importantAttributes.includes("size") ? sizeTokens.slice(0, 1) : []),
    ...(preset.normalizationRules.importantAttributes.includes("year") ? yearTokens.slice(0, 1) : []),
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
    importantTokens: adjustedImportantTokens,
    normalizedNameTokens: adjustedNormalizedNameTokens,
    noiseFlags: uniq([...getNoiseFlags(rawTitle), ...presetNoiseFlags]),
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

export function extractListingSignals(
  source: SignalSource,
  presetId?: CategoryPresetId,
): ListingSignals {
  return buildSignals(source, presetId);
}

export function buildNormalizedName(
  listing: Pick<MockMarketListing, "title" | "brand" | "model" | "season" | "category" | "size">,
  presetId?: CategoryPresetId,
): string {
  const signals = buildSignals(listing, presetId);
  const tokens =
    signals.normalizedNameTokens.length > 0
      ? signals.normalizedNameTokens
      : removeAttributeTerms(signals.titleTokens, signals).slice(0, 6);

  return tokens.join(" ").trim();
}

export function buildRelatedKeywords(
  listing: Pick<MockMarketListing, "title" | "brand" | "model" | "season" | "category" | "size">,
  presetId?: CategoryPresetId,
): string[] {
  const signals = buildSignals(listing, presetId);

  return uniq([
    ...(listing.brand ? [listing.brand.trim()] : []),
    ...(listing.model ? [listing.model.trim()] : []),
    ...(listing.season ? [listing.season.trim()] : []),
    ...(listing.category ? [listing.category.trim()] : []),
    ...(listing.size ? [listing.size.trim()] : []),
    ...signals.colorTokens,
    ...signals.importantTokens.slice(0, 4),
  ]);
}

export function containsNoiseTerm(value: string, presetId?: CategoryPresetId): boolean {
  const preset = getSearchCategoryPreset(presetId);
  const normalized = normalizeText(value);
  const lowered = lowerText(value);

  return (
    NOISE_TERMS.some((term) => normalized.includes(normalizeText(term))) ||
    preset.noiseKeywords.some((term) => normalized.includes(normalizeText(term))) ||
    NOISE_PATTERNS.some((entry) => entry.pattern.test(lowered)) ||
    preset.normalizationRules.rejectKeywordPatterns.some((pattern) => pattern.test(value))
  );
}

function getPresetCoverageThreshold(presetId?: CategoryPresetId): number {
  const preset = getSearchCategoryPreset(presetId);

  switch (preset.id) {
    case "camera":
      return 0.42;
    case "vintage_furniture":
      return 0.36;
    case "fashion":
    default:
      return 0.35;
  }
}

export function matchesSearchQuery(
  query: string,
  value: string,
  presetId?: CategoryPresetId,
): boolean {
  const querySignals = buildSignals({ title: query }, presetId);
  const valueSignals = buildSignals({ title: value }, presetId);

  if (querySignals.allTokens.length === 0) {
    return true;
  }

  const tokenCoverage = tokenSetOverlap(
    querySignals.importantTokens.length > 0 ? querySignals.importantTokens : querySignals.allTokens,
    valueSignals.allTokens,
  );
  const phraseMatch =
    querySignals.cleanedTitle.length > 0 &&
    valueSignals.cleanedTitle.includes(querySignals.cleanedTitle);

  return phraseMatch || tokenCoverage >= getPresetCoverageThreshold(presetId);
}

export function computeRelevanceScore(
  query: string,
  listing: ListingLike,
  presetId?: CategoryPresetId,
): number {
  const preset = getSearchCategoryPreset(presetId);
  const querySignals = buildSignals({ title: query }, preset.id);
  const listingSignals = buildSignals(listing, preset.id);

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
  const queryTokens =
    querySignals.importantTokens.length > 0 ? querySignals.importantTokens : querySignals.allTokens;
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
    (numericTokenPenalty(querySignals.importantTokens, listingSignals.importantTokens) > 0
      ? preset.relevanceWeights.numericMismatchPenalty
      : 0) +
    (brandMatch === 0 && listingSignals.brandTokens.length > 0 && querySignals.allTokens.length > 1
      ? preset.relevanceWeights.brandMissingPenalty
      : 0) +
    (listingSignals.noiseFlags.length > 0 ? preset.relevanceWeights.noisePenalty : 0);

  const score =
    tokenRecall * preset.relevanceWeights.tokenRecall +
    tokenJaccard * preset.relevanceWeights.tokenJaccard +
    phraseMatch * preset.relevanceWeights.phraseMatch +
    exactNormalizedName * preset.relevanceWeights.exactNormalizedName +
    brandMatch * preset.relevanceWeights.brandMatch +
    modelMatch * preset.relevanceWeights.modelMatch +
    categoryMatch * preset.relevanceWeights.categoryMatch +
    keywordMatch * preset.relevanceWeights.keywordMatch -
    mismatchPenalty;

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function computeListingSimilarity(
  left: ListingLike,
  right: ListingLike,
  presetId?: CategoryPresetId,
): number {
  const preset = getSearchCategoryPreset(presetId);
  const leftSignals = buildSignals(left, preset.id);
  const rightSignals = buildSignals(right, preset.id);
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
    (brandMismatchPenalty(leftSignals, rightSignals) > 0
      ? preset.similarity.brandMismatchPenalty
      : 0) +
    (categoryMismatchPenalty(leftSignals, rightSignals) > 0
      ? preset.similarity.categoryMismatchPenalty
      : 0) +
    (numericTokenPenalty(leftSignals.importantTokens, rightSignals.importantTokens) > 0
      ? preset.similarity.numericMismatchPenalty
      : 0) +
    (leftSignals.sizeTokens.length > 0 &&
    rightSignals.sizeTokens.length > 0 &&
    sizeScore === 0
      ? preset.similarity.sizeMismatchPenalty
      : 0) +
    (leftSignals.noiseFlags.length > 0 || rightSignals.noiseFlags.length > 0
      ? preset.similarity.noisePenalty
      : 0);

  const score =
    brandScore * preset.similarity.brandWeight +
    modelScore * preset.similarity.modelWeight +
    categoryScore * preset.similarity.categoryWeight +
    titleScore * preset.similarity.titleWeight +
    sizeScore * preset.similarity.sizeWeight +
    colorScore * preset.similarity.colorWeight +
    seasonScore * preset.similarity.seasonWeight -
    penalties;

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function buildComparableLabel(
  listing: Pick<ListingLike, "brand" | "model" | "category" | "title" | "size">,
): string {
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

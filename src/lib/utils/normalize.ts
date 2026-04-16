import { NOISE_TERMS } from "@/lib/constants";
import { getSearchCategoryPreset } from "@/lib/search/presets";
import type { CategoryPresetId, MarketListing, MockMarketListing } from "@/lib/types/market";

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

const BASE_STOP_WORDS = new Set([
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
  "국내",
  "해외",
  "배송",
  "무료배송",
  "상태",
  "좋음",
  "구성",
  "풀구성",
  "박스",
  "새상품",
  "미개봉",
  "미사용",
  "당일",
  "today",
  "new",
]);

const COLOR_TOKENS = new Set([
  "black",
  "white",
  "gray",
  "grey",
  "navy",
  "olive",
  "khaki",
  "beige",
  "brown",
  "red",
  "blue",
  "green",
  "pink",
  "purple",
  "yellow",
  "silver",
  "gold",
  "ivory",
  "cream",
  "charcoal",
  "블랙",
  "화이트",
  "그레이",
  "네이비",
  "올리브",
  "카키",
  "베이지",
  "브라운",
  "레드",
  "블루",
  "그린",
  "핑크",
  "퍼플",
  "옐로우",
  "실버",
  "골드",
  "아이보리",
  "크림",
]);

const CATEGORY_TOKEN_MAP: Record<string, string> = {
  hooded: "hoodie",
  sweatshirt: "hoodie",
  hoodie: "hoodie",
  후드: "hoodie",
  후디: "hoodie",
  jacket: "jacket",
  shell: "jacket",
  parka: "jacket",
  자켓: "jacket",
  재킷: "jacket",
  fleece: "fleece",
  플리스: "fleece",
  shoe: "sneakers",
  shoes: "sneakers",
  sneaker: "sneakers",
  sneakers: "sneakers",
  trainer: "sneakers",
  trainers: "sneakers",
  러너: "sneakers",
  스니커즈: "sneakers",
  bag: "bag",
  backpack: "bag",
  tote: "bag",
  가방: "bag",
  백팩: "bag",
  shirt: "shirt",
  tee: "shirt",
  tshirt: "shirt",
  "t-shirt": "shirt",
  셔츠: "shirt",
  티셔츠: "shirt",
  cap: "headwear",
  hat: "headwear",
  beanie: "headwear",
  모자: "headwear",
  비니: "headwear",
  pants: "pants",
  jeans: "pants",
  denim: "pants",
  팬츠: "pants",
  청바지: "pants",
  camera: "camera",
  카메라: "camera",
  lens: "lens",
  렌즈: "lens",
  chair: "chair",
  table: "table",
  sofa: "sofa",
  의자: "chair",
  테이블: "table",
  소파: "sofa",
};

const SEASON_PATTERN =
  /\b(?:fw|ss|aw|fa|sp)\s?\d{2,4}\b|\b\d{2}(?:fw|ss|aw|fa|sp)\b|\b(?:spring|summer|fall|winter)\s?\d{2,4}\b/giu;
const SIZE_PATTERN =
  /\b(?:XXXL|XXL|XL|L|M|S|XS|OS|O\/S|FREE|ONE\s*SIZE|\d{2,3}(?:\.\d)?(?:cm|mm)?|US\d{1,2}(?:\.\d)?|EU\d{2})\b/giu;
const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/gu;
const NOISE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "wanted", pattern: /\b(?:삽니다|구매글|구매\s*원함|wanted|looking\s*for|lf)\b/iu },
  { label: "exchange", pattern: /\b(?:교환|교신|trade)\b/iu },
  { label: "reserved", pattern: /\b(?:예약|예약중|보류|reserved|hold)\b/iu },
  { label: "inquiry", pattern: /\b(?:문의|정품문의|가격문의|dm)\b/iu },
  { label: "request", pattern: /\b(?:구합니다|찾습니다|구해요)\b/iu },
];

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalizeToken(token: string): string {
  const normalized = token.normalize("NFKC").toLowerCase().trim();

  if (!normalized) {
    return "";
  }

  return CATEGORY_TOKEN_MAP[normalized] ?? normalized;
}

function isMeaningfulToken(token: string): boolean {
  if (!token) {
    return false;
  }

  if (BASE_STOP_WORDS.has(token)) {
    return false;
  }

  if (token.length === 1 && !/\d/.test(token) && !["x", "s", "m", "l", "v"].includes(token)) {
    return false;
  }

  return true;
}

function splitWords(input: string): string[] {
  return input
    .normalize("NFKC")
    .replace(/['’]/g, "")
    .replace(/[()[\]{}.,/\\:_-]+/g, " ")
    .split(/\s+/)
    .map(canonicalizeToken)
    .filter(isMeaningfulToken);
}

function normalizeUnknown(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /^unknown$/i.test(trimmed) || /^uncategorized$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function collectNoiseFlags(value: string, presetId?: CategoryPresetId): string[] {
  const preset = getSearchCategoryPreset(presetId);
  const mergedTerms = [...NOISE_TERMS, ...preset.noiseKeywords, ...preset.normalizationRules.extraNoiseKeywords];
  const normalized = normalizeText(value);
  const flags = mergedTerms
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term) => normalized.includes(normalizeText(term)));

  NOISE_PATTERNS.forEach((entry) => {
    if (entry.pattern.test(value)) {
      flags.push(entry.label);
    }
  });

  return uniq(flags);
}

function tokenRecallScore(queryTokens: string[], listingTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const listingSet = new Set(listingTokens);
  const matched = queryTokens.filter((token) => listingSet.has(token)).length;
  return matched / queryTokens.length;
}

function tokenJaccardScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function countNumericTokens(tokens: string[]): string[] {
  return tokens.filter((token) => /\d/.test(token));
}

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[()[\]{}.,/\\:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function removeNoisePhrases(input: string): string {
  const preset = getSearchCategoryPreset();
  let cleaned = input.normalize("NFKC");

  [...NOISE_TERMS, ...preset.noiseKeywords, ...preset.normalizationRules.extraNoiseKeywords]
    .filter(Boolean)
    .forEach((term) => {
      cleaned = cleaned.replace(new RegExp(escapeRegExp(term), "giu"), " ");
    });

  NOISE_PATTERNS.forEach((entry) => {
    cleaned = cleaned.replace(entry.pattern, " ");
  });

  return cleaned.replace(/\s+/g, " ").trim();
}

export function tokenize(input: string): string[] {
  return uniq(splitWords(removeNoisePhrases(input)));
}

export function extractListingSignals(
  source: SignalSource,
  presetId?: CategoryPresetId,
): ListingSignals {
  const cleanedTitle = normalizeText(removeNoisePhrases(source.title ?? ""));
  const titleTokens = uniq(splitWords(cleanedTitle));
  const brandTokens = normalizeUnknown(source.brand) ? tokenize(source.brand ?? "") : [];
  const modelTokens = normalizeUnknown(source.model) ? tokenize(source.model ?? "") : [];
  const categoryTokens = uniq(
    tokenize(source.category ?? "").map((token) => CATEGORY_TOKEN_MAP[token] ?? token),
  );
  const sizeTokens = uniq([
    ...tokenize(source.size ?? ""),
    ...(source.title?.match(SIZE_PATTERN) ?? []).map((value) => value.normalize("NFKC").toLowerCase()),
  ]);
  const seasonTokens = uniq([
    ...tokenize(source.season ?? ""),
    ...(source.title?.match(SEASON_PATTERN) ?? []).map((value) =>
      value.normalize("NFKC").replace(/\s+/g, "").toLowerCase(),
    ),
  ]);
  const yearTokens = uniq([
    ...((source.season?.match(YEAR_PATTERN) ?? []).map((value) => value.toLowerCase())),
    ...((source.title?.match(YEAR_PATTERN) ?? []).map((value) => value.toLowerCase())),
  ]);
  const relatedKeywordTokens = uniq(
    (source.relatedKeywords ?? []).flatMap((keyword) => tokenize(keyword)),
  );
  const normalizedNameTokens = uniq(tokenize(source.normalizedName ?? ""));
  const colorTokens = uniq(
    titleTokens.filter((token) => COLOR_TOKENS.has(token)) ??
      tokenize(source.title ?? "").filter((token) => COLOR_TOKENS.has(token)),
  );
  const preset = getSearchCategoryPreset(presetId);

  const importantTokens = uniq(
    [
      ...brandTokens,
      ...modelTokens,
      ...categoryTokens,
      ...(preset.normalizationRules.importantAttributes.includes("size") ? sizeTokens : []),
      ...(preset.normalizationRules.importantAttributes.includes("season")
        ? seasonTokens
        : []),
      ...(preset.normalizationRules.importantAttributes.includes("year") ? yearTokens : []),
    ].filter(Boolean),
  );

  const allTokens = uniq([
    ...titleTokens,
    ...brandTokens,
    ...modelTokens,
    ...categoryTokens,
    ...sizeTokens,
    ...colorTokens,
    ...seasonTokens,
    ...yearTokens,
    ...relatedKeywordTokens,
    ...normalizedNameTokens,
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
    noiseFlags: collectNoiseFlags(source.title ?? "", presetId),
  };
}

export function buildNormalizedName(
  source: SignalSource,
  presetId?: CategoryPresetId,
): string {
  const signals = extractListingSignals(source, presetId);
  const tokens = uniq([
    ...signals.brandTokens,
    ...signals.modelTokens,
    ...signals.categoryTokens,
    ...signals.seasonTokens,
    ...signals.sizeTokens,
    ...signals.yearTokens,
    ...signals.titleTokens.slice(0, 8),
  ]);

  return tokens.join(" ").trim();
}

export function buildRelatedKeywords(
  source: SignalSource,
  presetId?: CategoryPresetId,
): string[] {
  const signals = extractListingSignals(source, presetId);
  return uniq([
    ...signals.brandTokens,
    ...signals.modelTokens,
    ...signals.categoryTokens,
    ...signals.colorTokens,
    ...signals.sizeTokens,
    ...signals.seasonTokens,
    ...signals.relatedKeywordTokens,
    ...signals.titleTokens.slice(0, 8),
  ]).slice(0, 12);
}

export function containsNoiseTerm(value: string, presetId?: CategoryPresetId): boolean {
  const preset = getSearchCategoryPreset(presetId);
  const normalized = normalizeText(value);

  return (
    NOISE_TERMS.some((term) => normalized.includes(normalizeText(term))) ||
    preset.noiseKeywords.some((term) => normalized.includes(normalizeText(term))) ||
    preset.normalizationRules.extraNoiseKeywords.some((term) =>
      normalized.includes(normalizeText(term)),
    ) ||
    NOISE_PATTERNS.some((entry) => entry.pattern.test(value))
  );
}

export function matchesSearchQuery(
  query: string,
  value: string,
  presetId?: CategoryPresetId,
): boolean {
  const querySignals = extractListingSignals({ title: query }, presetId);
  const listingSignals = extractListingSignals({ title: value }, presetId);

  if (querySignals.titleTokens.length === 0) {
    return true;
  }

  if (containsNoiseTerm(value, presetId)) {
    return false;
  }

  const recall = tokenRecallScore(querySignals.titleTokens, listingSignals.allTokens);
  const importantRecall = tokenRecallScore(querySignals.importantTokens, listingSignals.allTokens);

  return recall >= 0.4 || importantRecall >= 0.6;
}

export function computeRelevanceScore(
  query: string,
  listing: SignalSource,
  presetId?: CategoryPresetId,
): number {
  const preset = getSearchCategoryPreset(presetId);
  const weights = preset.relevanceWeights;
  const querySignals = extractListingSignals({ title: query }, presetId);
  const listingSignals = extractListingSignals(listing, presetId);
  const haystack = normalizeText(
    [
      listing.title,
      listing.brand,
      listing.model,
      listing.category,
      listing.normalizedName,
      ...(listing.relatedKeywords ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );

  const tokenRecall = tokenRecallScore(querySignals.titleTokens, listingSignals.allTokens);
  const tokenJaccard = tokenJaccardScore(querySignals.titleTokens, listingSignals.allTokens);
  const phraseMatch =
    querySignals.cleanedTitle && haystack.includes(querySignals.cleanedTitle) ? 1 : 0;
  const exactNormalizedName =
    listing.normalizedName &&
    normalizeText(listing.normalizedName).includes(querySignals.cleanedTitle)
      ? 1
      : 0;
  const brandMatch =
    querySignals.brandTokens.length > 0 &&
    querySignals.brandTokens.every((token) => listingSignals.brandTokens.includes(token))
      ? 1
      : 0;
  const modelMatch =
    querySignals.modelTokens.length > 0 &&
    tokenRecallScore(querySignals.modelTokens, listingSignals.modelTokens) >= 0.7
      ? 1
      : 0;
  const categoryMatch =
    querySignals.categoryTokens.length > 0 &&
    querySignals.categoryTokens.some((token) => listingSignals.categoryTokens.includes(token))
      ? 1
      : 0;
  const keywordMatch =
    querySignals.titleTokens.length > 0 &&
    tokenRecallScore(querySignals.titleTokens, listingSignals.relatedKeywordTokens) >= 0.5
      ? 1
      : 0;
  const brandMissingPenalty =
    querySignals.brandTokens.length > 0 && listingSignals.brandTokens.length === 0
      ? weights.brandMissingPenalty
      : 0;
  const numericMismatchPenalty =
    countNumericTokens(querySignals.allTokens).some(
      (token) => !listingSignals.allTokens.includes(token),
    )
      ? weights.numericMismatchPenalty
      : 0;
  const noisePenalty =
    containsNoiseTerm(listing.title ?? "", presetId) || listingSignals.noiseFlags.length > 0
      ? weights.noisePenalty
      : 0;

  const rawScore =
    tokenRecall * weights.tokenRecall +
    tokenJaccard * weights.tokenJaccard +
    phraseMatch * weights.phraseMatch +
    exactNormalizedName * weights.exactNormalizedName +
    brandMatch * weights.brandMatch +
    modelMatch * weights.modelMatch +
    categoryMatch * weights.categoryMatch +
    keywordMatch * weights.keywordMatch -
    brandMissingPenalty -
    numericMismatchPenalty -
    noisePenalty;

  return Number(clamp(rawScore, 0, 1).toFixed(3));
}

export function computeListingSimilarity(
  left: SignalSource,
  right: SignalSource,
  presetId?: CategoryPresetId,
): number {
  const preset = getSearchCategoryPreset(presetId);
  const config = preset.similarity;
  const leftSignals = extractListingSignals(left, presetId);
  const rightSignals = extractListingSignals(right, presetId);

  const brandScore =
    leftSignals.brandTokens.length > 0 && rightSignals.brandTokens.length > 0
      ? tokenRecallScore(leftSignals.brandTokens, rightSignals.brandTokens)
      : 0;
  const modelScore = tokenJaccardScore(leftSignals.modelTokens, rightSignals.modelTokens);
  const categoryScore = tokenJaccardScore(leftSignals.categoryTokens, rightSignals.categoryTokens);
  const titleScore = tokenJaccardScore(leftSignals.titleTokens, rightSignals.titleTokens);
  const sizeScore = tokenJaccardScore(leftSignals.sizeTokens, rightSignals.sizeTokens);
  const colorScore = tokenJaccardScore(leftSignals.colorTokens, rightSignals.colorTokens);
  const seasonScore = tokenJaccardScore(
    [...leftSignals.seasonTokens, ...leftSignals.yearTokens],
    [...rightSignals.seasonTokens, ...rightSignals.yearTokens],
  );

  let score =
    brandScore * config.brandWeight +
    modelScore * config.modelWeight +
    categoryScore * config.categoryWeight +
    titleScore * config.titleWeight +
    sizeScore * config.sizeWeight +
    colorScore * config.colorWeight +
    seasonScore * config.seasonWeight;

  if (leftSignals.brandTokens.length > 0 && rightSignals.brandTokens.length > 0 && brandScore === 0) {
    score -= config.brandMismatchPenalty;
  }

  if (
    leftSignals.categoryTokens.length > 0 &&
    rightSignals.categoryTokens.length > 0 &&
    categoryScore === 0
  ) {
    score -= config.categoryMismatchPenalty;
  }

  const leftNumeric = countNumericTokens(leftSignals.allTokens);
  const rightNumeric = countNumericTokens(rightSignals.allTokens);
  if (
    leftNumeric.length > 0 &&
    rightNumeric.length > 0 &&
    leftNumeric.some((token) => !rightNumeric.includes(token))
  ) {
    score -= config.numericMismatchPenalty;
  }

  if (
    leftSignals.sizeTokens.length > 0 &&
    rightSignals.sizeTokens.length > 0 &&
    sizeScore === 0
  ) {
    score -= config.sizeMismatchPenalty;
  }

  if (leftSignals.noiseFlags.length > 0 || rightSignals.noiseFlags.length > 0) {
    score -= config.noisePenalty;
  }

  return Number(clamp(score, 0, 1).toFixed(3));
}

export function buildComparableLabel(listing: SignalSource): string {
  const parts = [
    normalizeUnknown(listing.brand),
    normalizeUnknown(listing.model),
    normalizeUnknown(listing.season),
    normalizeUnknown(listing.size),
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" / ");
  }

  return removeNoisePhrases(listing.title ?? "").trim() || "Comparable group";
}

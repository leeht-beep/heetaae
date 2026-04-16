import type { AliasLanguage, MarketId } from "@/lib/types/market";

export type AliasDictionaryKind = "brand" | "model" | "category" | "market";

export interface AliasDictionaryEntry {
  key: string;
  kind: AliasDictionaryKind;
  canonical: string;
  aliases: string[];
  localized: Partial<Record<AliasLanguage, string[]>>;
  tags?: string[];
}

export interface AliasDictionaryMatch {
  entry: AliasDictionaryEntry;
  matchedAlias: string;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizeAliasValue(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function getAllAliasForms(entry: AliasDictionaryEntry): string[] {
  return uniq([
    entry.canonical,
    ...entry.aliases,
    ...(entry.localized.ko ?? []),
    ...(entry.localized.en ?? []),
    ...(entry.localized.ja ?? []),
  ]);
}

function createEntry(
  kind: AliasDictionaryKind,
  key: string,
  canonical: string,
  aliases: string[],
  localized: AliasDictionaryEntry["localized"],
  tags?: string[],
): AliasDictionaryEntry {
  return {
    key,
    kind,
    canonical,
    aliases: uniq([canonical, ...aliases]),
    localized,
    tags,
  };
}

export const BRAND_ALIAS_DICTIONARY: AliasDictionaryEntry[] = [
  createEntry("brand", "supreme", "Supreme", ["supreme", "슈프림", "シュプリーム"], {
    ko: ["슈프림"],
    en: ["Supreme"],
    ja: ["シュプリーム"],
  }),
  createEntry("brand", "patagonia", "Patagonia", ["patagonia", "파타고니아", "パタゴニア"], {
    ko: ["파타고니아"],
    en: ["Patagonia"],
    ja: ["パタゴニア"],
  }),
  createEntry("brand", "arcteryx", "Arc'teryx", ["arc'teryx", "arcteryx", "arc teryx", "아크테릭스", "アークテリクス"], {
    ko: ["아크테릭스"],
    en: ["Arc'teryx", "Arcteryx", "arc teryx"],
    ja: ["アークテリクス"],
  }),
  createEntry("brand", "new-balance", "New Balance", ["new balance", "뉴발란스", "ニューバランス", "nb"], {
    ko: ["뉴발란스"],
    en: ["New Balance", "NB"],
    ja: ["ニューバランス"],
  }),
  createEntry("brand", "the-north-face", "The North Face", ["the north face", "north face", "노스페이스", "ザノースフェイス"], {
    ko: ["노스페이스"],
    en: ["The North Face", "North Face"],
    ja: ["ザノースフェイス", "ノースフェイス"],
  }),
  createEntry("brand", "stussy", "Stussy", ["stussy", "스투시", "ステューシー"], {
    ko: ["스투시"],
    en: ["Stussy"],
    ja: ["ステューシー"],
  }),
  createEntry("brand", "auralee", "AURALEE", ["auralee", "오라리", "オーラリー"], {
    ko: ["오라리"],
    en: ["AURALEE"],
    ja: ["オーラリー"],
  }),
  createEntry("brand", "comoli", "COMOLI", ["comoli", "코모리", "コモリ"], {
    ko: ["코모리"],
    en: ["COMOLI"],
    ja: ["コモリ"],
  }),
  createEntry("brand", "porter-classic", "Porter Classic", ["porter classic", "포터 클래식", "ポータークラシック"], {
    ko: ["포터 클래식"],
    en: ["Porter Classic"],
    ja: ["ポータークラシック"],
  }),
  createEntry("brand", "porter", "PORTER", ["porter", "요시다 포터", "吉田カバン", "ポーター"], {
    ko: ["포터", "요시다 포터"],
    en: ["PORTER", "Porter"],
    ja: ["ポーター", "吉田カバン"],
  }),
  createEntry("brand", "nike", "Nike", ["nike", "나이키", "ナイキ"], {
    ko: ["나이키"],
    en: ["Nike"],
    ja: ["ナイキ"],
  }),
  createEntry("brand", "sony", "Sony", ["sony", "소니", "ソニー"], {
    ko: ["소니"],
    en: ["Sony"],
    ja: ["ソニー"],
  }),
  createEntry("brand", "leica", "Leica", ["leica", "라이카", "ライカ"], {
    ko: ["라이카"],
    en: ["Leica"],
    ja: ["ライカ"],
  }),
  createEntry("brand", "herman-miller", "Herman Miller", ["herman miller", "허먼밀러", "ハーマンミラー"], {
    ko: ["허먼밀러"],
    en: ["Herman Miller"],
    ja: ["ハーマンミラー"],
  }),
  createEntry("brand", "karimoku60", "Karimoku 60", ["karimoku 60", "가리모쿠60", "カリモク60"], {
    ko: ["가리모쿠60"],
    en: ["Karimoku 60"],
    ja: ["カリモク60"],
  }),
  createEntry("brand", "mercari", "Mercari", ["mercari", "메루카리", "メルカリ"], {
    ko: ["메루카리"],
    en: ["Mercari"],
    ja: ["メルカリ"],
  }),
];

export const MODEL_ALIAS_DICTIONARY: AliasDictionaryEntry[] = [
  createEntry("model", "box-logo-hoodie", "Box Logo Hoodie", ["box logo hoodie", "box logo", "bogo hoodie", "박스로고 후드", "ボックスロゴ パーカー", "ボックスロゴ フーディ"], {
    ko: ["박스로고 후드", "박스로고"],
    en: ["Box Logo Hoodie", "Box Logo", "Bogo Hoodie"],
    ja: ["ボックスロゴ パーカー", "ボックスロゴ フーディ", "ボックスロゴ"],
  }),
  createEntry("model", "retro-x", "Retro X", ["retro x", "레트로 x", "レトロx"], {
    ko: ["레트로 X"],
    en: ["Retro X"],
    ja: ["レトロX"],
  }),
  createEntry("model", "beta-lt", "Beta LT", ["beta lt", "베타 lt", "ベータ lt"], {
    ko: ["베타 LT"],
    en: ["Beta LT"],
    ja: ["ベータ LT"],
  }),
  createEntry("model", "992", "992", ["992", "m992"], {
    ko: ["992"],
    en: ["992", "M992"],
    ja: ["992"],
  }),
  createEntry("model", "super-light-wool-shirt", "Super Light Wool Shirt", ["super light wool shirt", "슈퍼 라이트 울 셔츠", "スーパーライトウールシャツ"], {
    ko: ["슈퍼 라이트 울 셔츠"],
    en: ["Super Light Wool Shirt"],
    ja: ["スーパーライトウールシャツ"],
  }),
  createEntry("model", "tie-locken-coat", "Tie Locken Coat", ["tie locken coat", "タイロッケンコート", "타이로켄 코트"], {
    ko: ["타이로켄 코트"],
    en: ["Tie Locken Coat"],
    ja: ["タイロッケンコート"],
  }),
  createEntry("model", "newton-daypack", "Newton Daypack", ["newton daypack", "뉴턴 데이팩", "ニュートン デイパック"], {
    ko: ["뉴턴 데이팩"],
    en: ["Newton Daypack"],
    ja: ["ニュートン デイパック"],
  }),
  createEntry("model", "m6", "M6", ["m6", "라이카 m6", "ライカ m6"], {
    ko: ["M6", "라이카 M6"],
    en: ["M6"],
    ja: ["M6", "ライカ M6"],
  }),
  createEntry("model", "a7c-ii", "A7C II", ["a7c ii", "a7cii", "a7c2", "a7c 2", "a7c ii", "ソニー a7c ii"], {
    ko: ["A7C II", "A7C2"],
    en: ["A7C II", "A7C2"],
    ja: ["A7C II", "A7C2"],
  }),
  createEntry("model", "aeron-chair", "Aeron Chair", ["aeron chair", "에어론 체어", "アーロンチェア"], {
    ko: ["에어론 체어"],
    en: ["Aeron Chair"],
    ja: ["アーロンチェア"],
  }),
  createEntry("model", "k-chair", "K Chair", ["k chair", "k체어", "k 체어", "kチェア"], {
    ko: ["K 체어", "K체어"],
    en: ["K Chair"],
    ja: ["Kチェア"],
  }),
];

export const CATEGORY_ALIAS_DICTIONARY: AliasDictionaryEntry[] = [
  createEntry("category", "hoodie", "hoodie", ["hoodie", "hooded", "후드", "후디", "パーカー", "フーディ"], {
    ko: ["후드", "후디"],
    en: ["hoodie", "hooded"],
    ja: ["パーカー", "フーディ"],
  }),
  createEntry("category", "jacket", "jacket", ["jacket", "shell", "parka", "자켓", "쉘", "ジャケット"], {
    ko: ["자켓", "쉘", "파카"],
    en: ["jacket", "shell", "parka"],
    ja: ["ジャケット", "シェル"],
  }),
  createEntry("category", "shirt", "shirt", ["shirt", "tee", "t-shirt", "티셔츠", "셔츠", "シャツ", "Tシャツ"], {
    ko: ["티셔츠", "셔츠"],
    en: ["shirt", "tee", "t-shirt"],
    ja: ["シャツ", "Tシャツ"],
  }),
  createEntry("category", "sneakers", "sneakers", ["sneakers", "shoe", "shoes", "스니커즈", "신발", "スニーカー"], {
    ko: ["스니커즈", "신발"],
    en: ["sneakers", "shoe", "shoes"],
    ja: ["スニーカー", "シューズ"],
  }),
  createEntry("category", "bag", "bag", ["bag", "backpack", "tote", "가방", "백팩", "バッグ"], {
    ko: ["가방", "백팩"],
    en: ["bag", "backpack", "tote"],
    ja: ["バッグ", "バックパック", "トート"],
  }),
  createEntry("category", "camera", "camera", ["camera", "카메라", "カメラ"], {
    ko: ["카메라"],
    en: ["camera"],
    ja: ["カメラ"],
  }),
  createEntry("category", "chair", "chair", ["chair", "체어", "의자", "チェア"], {
    ko: ["체어", "의자"],
    en: ["chair"],
    ja: ["チェア"],
  }),
];

export function findAliasEntryByCanonical(
  entries: AliasDictionaryEntry[],
  canonical?: string,
): AliasDictionaryEntry | undefined {
  if (!canonical) {
    return undefined;
  }

  const normalizedCanonical = normalizeAliasValue(canonical);
  return entries.find((entry) => normalizeAliasValue(entry.canonical) === normalizedCanonical);
}

export function findBestAliasMatch(
  query: string,
  entries: AliasDictionaryEntry[],
): AliasDictionaryMatch | undefined {
  const normalizedQuery = normalizeAliasValue(query);
  const matches = entries.flatMap((entry) =>
    getAllAliasForms(entry)
      .filter((alias) => normalizedQuery.includes(normalizeAliasValue(alias)))
      .map((matchedAlias) => ({
        entry,
        matchedAlias,
      })),
  );

  return matches.sort((left, right) => right.matchedAlias.length - left.matchedAlias.length)[0];
}

export function getPreferredLanguagesForMarket(market: MarketId): AliasLanguage[] {
  return market === "mercari" ? ["ja", "en"] : ["ko", "en"];
}

export function getLocalizedAliasCandidates(
  entry: AliasDictionaryEntry | undefined,
  languages: AliasLanguage[],
): string[] {
  if (!entry) {
    return [];
  }

  return uniq([
    ...languages.flatMap((language) => entry.localized[language] ?? []),
    entry.canonical,
  ]);
}

export function getAllAliasCandidates(entry: AliasDictionaryEntry | undefined): string[] {
  if (!entry) {
    return [];
  }

  return getAllAliasForms(entry);
}

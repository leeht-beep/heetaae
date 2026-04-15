import { SearchBenchmarkCase } from "@/lib/benchmarks/types";

export const SEARCH_BENCHMARK_DATASET: SearchBenchmarkCase[] = [
  {
    id: "supreme-brand-en",
    label: "Supreme brand only",
    query: "Supreme",
    tags: ["core", "fashion", "brand-only", "english"],
    recommendedPreset: "fashion",
    notes: "브랜드 단독 검색 반응 확인",
    minProvidersWithResults: 2,
  },
  {
    id: "supreme-box-logo-en",
    label: "Supreme Box Logo Hoodie EN",
    query: "Supreme Box Logo Hoodie",
    tags: ["core", "fashion", "brand-model", "english"],
    recommendedPreset: "fashion",
    minProvidersWithResults: 2,
  },
  {
    id: "supreme-box-logo-ko",
    label: "Supreme Box Logo Hoodie KO",
    query: "슈프림 박스로고 후드",
    tags: ["core", "fashion", "brand-model", "korean", "mixed-lang"],
    recommendedPreset: "fashion",
    minProvidersWithResults: 2,
  },
  {
    id: "supreme-box-logo-ja",
    label: "Supreme Box Logo Hoodie JA",
    query: "シュプリーム ボックスロゴ パーカー",
    tags: ["core", "fashion", "brand-model", "japanese", "mixed-lang"],
    minProvidersWithResults: 2,
  },
  {
    id: "patagonia-retro-x-en",
    label: "Patagonia Retro X EN",
    query: "Patagonia Retro X",
    tags: ["core", "fashion", "brand-model", "english"],
    minProvidersWithResults: 2,
  },
  {
    id: "patagonia-retro-x-ko",
    label: "Patagonia Retro X KO",
    query: "파타고니아 레트로 X",
    tags: ["core", "fashion", "brand-model", "korean", "mixed-lang"],
    minProvidersWithResults: 2,
  },
  {
    id: "arcteryx-beta-lt-en",
    label: "Arc'teryx Beta LT EN",
    query: "Arc'teryx Beta LT",
    tags: ["core", "fashion", "brand-model", "english"],
    minProvidersWithResults: 2,
  },
  {
    id: "arcteryx-beta-lt-abbrev",
    label: "Arc Beta LT abbrev",
    query: "arc beta lt",
    tags: ["core", "fashion", "abbrev", "english", "brand-model"],
    minProvidersWithResults: 1,
  },
  {
    id: "new-balance-992-ko",
    label: "New Balance 992 KO",
    query: "뉴발란스 992 그레이",
    tags: ["core", "fashion", "brand-model", "korean", "mixed-lang"],
    minProvidersWithResults: 2,
  },
  {
    id: "auralee-super-light-en",
    label: "AURALEE Super Light Wool Shirt EN",
    query: "AURALEE Super Light Wool Shirt",
    tags: ["core", "fashion", "brand-model", "english"],
    minProvidersWithResults: 1,
  },
  {
    id: "auralee-super-light-ja",
    label: "AURALEE Super Light Wool Shirt JA",
    query: "オーラリー スーパーライトウールシャツ",
    tags: ["core", "fashion", "brand-model", "japanese", "mixed-lang"],
    minProvidersWithResults: 1,
  },
  {
    id: "comoli-tie-locken-ko",
    label: "COMOLI Tie Locken Coat KO",
    query: "코모리 타이로켄 코트",
    tags: ["core", "fashion", "brand-model", "korean", "mixed-lang"],
    minProvidersWithResults: 1,
  },
  {
    id: "porter-classic-newton-ja",
    label: "Porter Classic Newton Daypack JA",
    query: "ポータークラシック ニュートン デイパック",
    tags: ["core", "fashion", "brand-model", "japanese", "mixed-lang"],
    minProvidersWithResults: 1,
  },
  {
    id: "leica-m6-en",
    label: "Leica M6",
    query: "Leica M6",
    tags: ["camera", "english", "brand-model", "exploratory"],
    recommendedPreset: "camera",
    notes: "패션 외 카테고리 대응력 확인",
  },
  {
    id: "sony-a7c2-ko",
    label: "Sony A7C II KO",
    query: "소니 A7C2",
    tags: ["camera", "korean", "abbrev", "exploratory"],
    recommendedPreset: "camera",
  },
  {
    id: "herman-miller-aeron-ko",
    label: "Herman Miller Aeron KO",
    query: "허먼밀러 에어론 체어",
    tags: ["furniture", "korean", "brand-model", "exploratory"],
    recommendedPreset: "vintage_furniture",
  },
  {
    id: "karimoku-k-chair-ja",
    label: "Karimoku 60 K Chair JA",
    query: "カリモク60 Kチェア",
    tags: ["furniture", "japanese", "brand-model", "exploratory"],
    recommendedPreset: "vintage_furniture",
  },
];

export function filterBenchmarkDataset(options: {
  ids?: string[];
  tags?: string[];
  maxQueries?: number;
}): SearchBenchmarkCase[] {
  const idFilter = options.ids?.filter(Boolean) ?? [];
  const tagFilter = options.tags?.filter(Boolean) ?? [];
  const filtered = SEARCH_BENCHMARK_DATASET.filter((entry) => {
    if (idFilter.length > 0 && !idFilter.includes(entry.id)) {
      return false;
    }

    if (tagFilter.length > 0 && !tagFilter.some((tag) => entry.tags.includes(tag as never))) {
      return false;
    }

    return true;
  });

  return typeof options.maxQueries === "number" && options.maxQueries > 0
    ? filtered.slice(0, options.maxQueries)
    : filtered;
}

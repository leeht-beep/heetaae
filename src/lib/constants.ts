import { CostSettings, MarketId, ResultTab } from "@/lib/types/market";

export const MARKET_LABELS: Record<MarketId, string> = {
  mercari: "메루카리",
  bunjang: "번개장터",
  fruitsfamily: "FruitsFamily",
};

export const MARKET_THEME: Record<MarketId, string> = {
  mercari: "bg-teal/10 text-teal border-teal/20",
  bunjang: "bg-coral/10 text-coral border-coral/20",
  fruitsfamily: "bg-sand text-ink border-line",
};

export const DEFAULT_SEARCH_TERM = "Supreme Box Logo Hoodie";

export const QUICK_SEARCHES = [
  "Supreme Box Logo Hoodie",
  "Patagonia Retro X",
  "Arc'teryx Beta LT",
  "New Balance 992 Grey",
];

export const DEFAULT_COST_SETTINGS: CostSettings = {
  exchangeRate: 9.15,
  japanDomesticShipping: 900,
  internationalShipping: 18000,
  extraCosts: 12000,
  platformFeeRate: 0.065,
  targetMarginRate: 0.22,
};

export const DEFAULT_RESULT_TABS: Array<{ id: ResultTab; label: string }> = [
  { id: "recommended", label: "추천" },
  { id: "all", label: "전체" },
  { id: "active", label: "판매중" },
  { id: "sold", label: "판매완료" },
  { id: "mercari", label: "메루카리" },
  { id: "bunjang", label: "번개장터" },
  { id: "fruitsfamily", label: "FruitsFamily" },
];

export const NOISE_TERMS = [
  "구매",
  "삽니다",
  "교환",
  "예약",
  "문의",
  "wanted",
  "looking for",
  "찾아요",
  "삽니다만",
];

export const DEFAULT_MIN_RELEVANCE = 0.34;

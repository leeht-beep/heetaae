import type { CostSettings, MarketId, ResultTab } from "@/lib/types/market";

export const MARKET_LABELS: Record<MarketId, string> = {
  mercari: "Mercari",
  bunjang: "번개장터",
  fruitsfamily: "FruitsFamily",
};

export const MARKET_THEME: Record<MarketId, string> = {
  mercari: "border-teal/20 bg-teal/10 text-teal",
  bunjang: "border-coral/20 bg-coral/10 text-coral",
  fruitsfamily: "border-line bg-sand text-ink",
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
  { id: "mercari", label: "Mercari" },
  { id: "bunjang", label: "번개장터" },
  { id: "fruitsfamily", label: "FruitsFamily" },
];

export const NOISE_TERMS = [
  "삽니다",
  "구매",
  "구매글",
  "구해요",
  "구합니다",
  "교환",
  "교신",
  "예약",
  "예약중",
  "문의",
  "정품문의",
  "가격문의",
  "wanted",
  "looking for",
  "lf",
  "trade",
  "reserved",
  "hold",
];

export const DEFAULT_MIN_RELEVANCE = 0.34;

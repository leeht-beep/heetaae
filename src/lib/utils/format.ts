import { MARKET_LABELS } from "@/lib/constants";
import {
  CurrencyCode,
  ListingType,
  MarketId,
  ProviderExecutionStatus,
  ProviderMode,
  TrendDirection,
} from "@/lib/types/market";

export function formatCurrency(value: number, currency: CurrencyCode = "KRW"): string {
  const locale = currency === "JPY" ? "ja-JP" : "ko-KR";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatTrend(direction: TrendDirection, percentage: number): string {
  const label = direction === "up" ? "상승" : direction === "down" ? "하락" : "보합";
  return `${label} ${Math.abs(percentage * 100).toFixed(1)}%`;
}

export function marketLabel(market: MarketId): string {
  return MARKET_LABELS[market];
}

export function listingStatusLabel(type: ListingType): string {
  return type === "active" ? "판매중" : "판매완료";
}

export function providerModeLabel(mode: ProviderMode): string {
  return mode === "mock" ? "Mock 데이터" : "실수집";
}

export function providerStatusLabel(status: ProviderExecutionStatus): string {
  switch (status) {
    case "success":
      return "정상";
    case "empty":
      return "빈 결과";
    case "partial":
      return "부분 성공";
    case "timeout":
      return "타임아웃";
    case "blocked":
      return "차단";
    case "parse_error":
    case "parsing_failure":
      return "파싱 실패";
    case "error":
    default:
      return "실패";
  }
}

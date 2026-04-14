"use client";

import { useState, useTransition } from "react";
import { CostSettingsPanel } from "@/components/CostSettingsPanel";
import { ListingBoard } from "@/components/ListingBoard";
import { ListingDetailModal } from "@/components/ListingDetailModal";
import { MarketInsightsTable } from "@/components/MarketInsightsTable";
import { SummaryDashboard } from "@/components/SummaryDashboard";
import {
  DEFAULT_COST_SETTINGS,
  DEFAULT_SEARCH_TERM,
  MARKET_THEME,
  QUICK_SEARCHES,
} from "@/lib/constants";
import {
  CostSettings,
  MarketListing,
  ProviderExecutionStatus,
  RecommendedListing,
  ResultTab,
  SearchResponse,
} from "@/lib/types/market";
import {
  formatCurrency,
  marketLabel,
  providerModeLabel,
  providerStatusLabel,
} from "@/lib/utils/format";

type SelectableListing = MarketListing | RecommendedListing;

interface ResellWorkbenchProps {
  initialData: SearchResponse;
}

function statusTone(status: ProviderExecutionStatus): string {
  switch (status) {
    case "success":
      return "border-teal/20 bg-teal/10 text-teal";
    case "empty":
      return "border-line bg-white/80 text-muted";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "timeout":
    case "parsing_failure":
    case "error":
    default:
      return "border-coral/20 bg-coral/10 text-coral";
  }
}

export function ResellWorkbench({ initialData }: ResellWorkbenchProps) {
  const [queryInput, setQueryInput] = useState(initialData.searchTerm);
  const [costs, setCosts] = useState(initialData.costs);
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<ResultTab>("recommended");
  const [selectedListing, setSelectedListing] = useState<SelectableListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const failingMarkets = data.marketResults.filter((result) =>
    ["partial", "timeout", "parsing_failure", "error"].includes(result.status),
  );
  const emptyMarkets = data.marketResults.filter((result) => result.status === "empty");

  const executeSearch = (nextQuery = queryInput, nextCosts: CostSettings = costs) => {
    const normalizedQuery = nextQuery.trim() || DEFAULT_SEARCH_TERM;
    const params = new URLSearchParams({
      q: normalizedQuery,
      mode: data.providerMode,
      exchangeRate: String(nextCosts.exchangeRate),
      japanDomesticShipping: String(nextCosts.japanDomesticShipping),
      internationalShipping: String(nextCosts.internationalShipping),
      extraCosts: String(nextCosts.extraCosts),
      platformFeeRate: String(nextCosts.platformFeeRate),
      targetMarginRate: String(nextCosts.targetMarginRate),
    });

    setError(null);
    setIsLoading(true);

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/search?${params.toString()}`);

          if (!response.ok) {
            throw new Error("검색 결과를 불러오지 못했습니다.");
          }

          const payload = (await response.json()) as SearchResponse;
          setData(payload);
          setCosts(nextCosts);
          setQueryInput(payload.searchTerm);
          setActiveTab("recommended");
          setSelectedListing(null);
        } catch (searchError) {
          setError(
            searchError instanceof Error
              ? searchError.message
              : "예상하지 못한 오류가 발생했습니다.",
          );
        } finally {
          setIsLoading(false);
        }
      })();
    });
  };

  const currentComparableGroup = selectedListing
    ? data.groups.find((group) =>
        group.listings.some(
          (item) =>
            item.id === selectedListing.id &&
            item.sourceMarket === selectedListing.sourceMarket,
        ),
      )
    : undefined;
  const comparableListings =
    currentComparableGroup?.listings.filter((item) => item.id !== selectedListing?.id) ?? [];

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <section className="surface-panel overflow-hidden">
          <div className="grid gap-8 px-5 py-6 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:px-8 lg:py-8">
            <div>
              <div className="inline-flex rounded-full border border-line bg-white/85 px-4 py-2 text-sm font-semibold text-muted">
                메루카리 일본 매입가 대비 한국 리셀 판단 도구
              </div>
              <h1 className="mt-5 max-w-3xl font-[var(--font-display)] text-4xl font-bold leading-tight text-ink sm:text-5xl">
                일본에서 사고 한국에서 팔기 전에
                <br />
                빠르게 판단하는 반응형 리셀 분석 웹서비스
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
                검색 한 번으로 메루카리, 번개장터, FruitsFamily 결과를 함께 비교하고 판매중,
                판매완료, 추천 매물, 예상 순이익과 추천 매입가까지 한 화면에서 확인합니다.
              </p>

              <form
                className="mt-6 flex flex-col gap-3 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  executeSearch(queryInput, costs);
                }}
              >
                <input
                  className="soft-input min-h-[58px] flex-1"
                  placeholder="브랜드 + 모델명 검색 예: Supreme Box Logo Hoodie"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                />
                <button className="soft-button bg-ink text-white" type="submit">
                  {isLoading || isPending ? "검색중..." : "통합 검색"}
                </button>
              </form>

              <div className="mt-4 flex flex-wrap gap-2">
                {QUICK_SEARCHES.map((item) => (
                  <button
                    key={item}
                    className="tag-chip"
                    type="button"
                    onClick={() => {
                      setQueryInput(item);
                      executeSearch(item, costs);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>

              {error ? (
                <div className="mt-4 rounded-[1.2rem] border border-coral/20 bg-coral/10 px-4 py-3 text-sm text-coral">
                  {error}
                </div>
              ) : null}

              {data.hasPartialFailures ? (
                <div className="mt-4 rounded-[1.2rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  일부 마켓 수집이 완전하지 않았지만 나머지 결과는 계속 표시합니다.
                  {failingMarkets.length > 0
                    ? ` 문제가 있었던 마켓: ${failingMarkets.map((item) => marketLabel(item.sourceMarket)).join(", ")}`
                    : ""}
                </div>
              ) : null}

              {!data.hasAnySuccessfulMarket ? (
                <div className="mt-4 rounded-[1.2rem] border border-coral/20 bg-coral/10 px-4 py-3 text-sm text-coral">
                  현재 검색에서는 정상적으로 수집된 마켓이 없습니다. 잠시 후 다시 시도하거나 Mock 모드로
                  확인해 주세요.
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <article className="stat-card p-5">
                <p className="section-title">검색어</p>
                <p className="mt-3 font-[var(--font-display)] text-2xl font-bold text-ink">
                  {data.searchTerm}
                </p>
                <p className="mt-2 text-sm text-muted">
                  정규화된 매물 {data.listings.length}건 / 추천 매입 후보 {data.recommendedListings.length}건
                </p>
              </article>

              <article className="stat-card p-5">
                <p className="section-title">추천 판매처</p>
                <p className="mt-3 font-[var(--font-display)] text-2xl font-bold text-ink">
                  {marketLabel(data.recommendation.bestResaleMarket)}
                </p>
                <p className="mt-2 text-sm text-muted">
                  목표 판매가 {formatCurrency(data.profitProjection.recommendedSellPrice, "KRW")}
                </p>
              </article>

              <article className="stat-card p-5">
                <p className="section-title">데이터 모드</p>
                <p className="mt-3 font-[var(--font-display)] text-2xl font-bold text-ink">
                  {providerModeLabel(data.providerMode)}
                </p>
                <p className="mt-2 text-sm text-muted">
                  mock / real collector를 같은 contract로 교체할 수 있도록 분리되어 있습니다.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.marketResults.map((result) => (
                    <span
                      key={result.sourceMarket}
                      className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${statusTone(result.status)}`}
                    >
                      {marketLabel(result.sourceMarket)} · {providerStatusLabel(result.status)} · {providerModeLabel(result.mode)}
                    </span>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>

        <div className="mt-6 space-y-6">
          <SummaryDashboard
            dashboard={data.dashboard}
            recommendation={data.recommendation}
            projection={data.profitProjection}
          />

          <section className="surface-panel p-5 sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="section-title">수집 상태</p>
                <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
                  마켓별 provider 실행 결과
                </h2>
              </div>
              <p className="text-sm text-muted">
                빈 결과, 부분 성공, 실패를 개별 마켓 단위로 분리해 UI가 깨지지 않도록 처리합니다.
              </p>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.marketResults.map((result) => (
                <article
                  key={result.sourceMarket}
                  className="rounded-[1.35rem] border border-line bg-white/75 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${MARKET_THEME[result.sourceMarket]}`}
                    >
                      {marketLabel(result.sourceMarket)}
                    </span>
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(result.status)}`}
                    >
                      {providerStatusLabel(result.status)} · {providerModeLabel(result.mode)}
                    </span>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-muted">
                    <div className="flex items-center justify-between gap-3">
                      <span>Raw / 정규화</span>
                      <strong className="text-ink">
                        {result.rawItemCount} / {result.normalizedItemCount}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>판매중 / 완료</span>
                      <strong className="text-ink">
                        {result.activeListingCount} / {result.soldListingCount}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>건너뜀</span>
                      <strong className="text-ink">{result.skippedItemCount}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>응답 시간</span>
                      <strong className="text-ink">{result.durationMs}ms</strong>
                    </div>
                  </div>
                  {result.error ? (
                    <p className="mt-4 rounded-2xl bg-coral/8 px-3 py-2 text-sm text-coral">
                      {result.error.message}
                    </p>
                  ) : null}
                  {result.warnings.length > 0 ? (
                    <p className="mt-3 text-xs text-muted">
                      경고 {result.warnings.length}건
                      {result.status === "empty" && emptyMarkets.length > 0 ? " · 검색 결과 없음" : ""}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <MarketInsightsTable marketAnalyses={data.marketAnalyses} />

              <section className="surface-panel p-5 sm:p-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="section-title">유사 상품 묶음</p>
                    <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
                      유사 상품 묶음 비교
                    </h2>
                  </div>
                  <p className="text-sm text-muted">
                    동일 모델군을 묶어 가격 스프레드와 거래 흐름을 빠르게 비교합니다.
                  </p>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.groups.slice(0, 6).map((group) => (
                    <article
                      key={group.id}
                      className="rounded-[1.35rem] border border-line bg-white/75 p-4"
                    >
                      <p className="text-sm font-semibold text-ink">{group.label}</p>
                      <p className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
                        {formatCurrency(group.averagePriceKrw, "KRW")}
                      </p>
                      <div className="mt-3 space-y-2 text-sm text-muted">
                        <div className="flex items-center justify-between gap-3">
                          <span>매물 수</span>
                          <strong className="text-ink">{group.listingCount}</strong>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>판매완료 / 판매중</span>
                          <strong className="text-ink">
                            {group.soldCount} / {group.activeCount}
                          </strong>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>마켓 스프레드</span>
                          <strong className="text-ink">
                            {formatCurrency(group.marketSpread, "KRW")}
                          </strong>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <ListingBoard
                activeTab={activeTab}
                listings={data.listings}
                recommendedListings={data.recommendedListings}
                onSelect={setSelectedListing}
                onTabChange={setActiveTab}
              />
            </div>

            <CostSettingsPanel
              costs={costs}
              pending={isLoading || isPending}
              onChange={setCosts}
              onReset={() => setCosts(DEFAULT_COST_SETTINGS)}
              onSubmit={() => executeSearch(queryInput, costs)}
            />
          </div>
        </div>
      </main>

      <ListingDetailModal
        comparableListings={comparableListings}
        listing={selectedListing}
        projection={data.profitProjection}
        onClose={() => setSelectedListing(null)}
      />
    </>
  );
}

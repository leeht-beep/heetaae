import { marketLabel } from "@/lib/utils/format";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  DashboardSummary,
  ProfitProjection,
  RecommendationResult,
} from "@/lib/types/market";

interface SummaryDashboardProps {
  dashboard: DashboardSummary;
  recommendation: RecommendationResult;
  projection: ProfitProjection;
}

export function SummaryDashboard({
  dashboard,
  recommendation,
  projection,
}: SummaryDashboardProps) {
  const cards = [
    {
      label: "일본 평균가",
      value: formatCurrency(dashboard.japanAveragePriceJpy, "JPY"),
      subValue: formatCurrency(dashboard.japanAveragePrice, "KRW"),
    },
    {
      label: "한국 평균가",
      value: formatCurrency(dashboard.koreaAveragePrice, "KRW"),
      subValue: `추천 판매처 ${marketLabel(dashboard.recommendedSellMarket)}`,
    },
    {
      label: "예상 순이익",
      value: formatCurrency(dashboard.expectedNetProfit, "KRW"),
      subValue: `예상 마진율 ${formatPercent(dashboard.expectedMarginRate)}`,
    },
    {
      label: "추천 매입가",
      value: formatCurrency(dashboard.recommendedBuyPriceJpy, "JPY"),
      subValue: formatCurrency(dashboard.recommendedBuyPrice, "KRW"),
    },
    {
      label: "추천 점수",
      value: `${dashboard.recommendationScore} / 100`,
      subValue: `등급 ${dashboard.recommendationGrade}`,
    },
    {
      label: "시장 활발도",
      value: `${dashboard.marketActivityScore}점`,
      subValue: `7일 ${dashboard.estimatedVolume7d} / 14일 ${dashboard.estimatedVolume14d} / 30일 ${dashboard.estimatedVolume30d}`,
    },
    {
      label: "예상 판매가",
      value: formatCurrency(dashboard.recommendedSellPrice, "KRW"),
      subValue: `수수료 차감 후 ${formatCurrency(projection.netSellProceeds, "KRW")}`,
    },
    {
      label: "최적 판매처",
      value: marketLabel(recommendation.bestResaleMarket),
      subValue: "판매완료와 유동성 기준",
    },
  ];

  const lists = [
    {
      label: "추천 사유",
      items: recommendation.recommendationReasons,
      emptyText: "실제 수집 데이터가 붙으면 추천 근거가 더 구체적으로 표시됩니다.",
    },
    {
      label: "주의 요소",
      items: recommendation.blockerReasons,
      emptyText: "현재 조건에서는 큰 blocker가 보이지 않습니다.",
    },
    {
      label: "조정 제안",
      items: recommendation.suggestedAdjustments,
      emptyText: "현재 비용 설정으로 먼저 테스트해도 괜찮습니다.",
    },
    {
      label: "판매처 추천 근거",
      items: recommendation.bestMarketReasons,
      emptyText: "데이터가 더 쌓이면 판매처 추천 근거가 더 선명해집니다.",
    },
  ];

  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.label} className="stat-card p-5">
            <p className="section-title">{card.label}</p>
            <p className="mt-3 font-[var(--font-display)] text-2xl font-bold text-ink">
              {card.value}
            </p>
            <p className="mt-2 text-sm text-muted">{card.subValue}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="surface-panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-title">리셀 판단</p>
              <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
                등급 {recommendation.recommendationGrade}, 총점 {dashboard.recommendationScore}점
              </h2>
            </div>
            <div className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white">
              우선 판매처 {marketLabel(recommendation.bestResaleMarket)}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {lists.map((list) => (
              <div key={list.label} className="rounded-[1.35rem] border border-line bg-white/70 p-4">
                <p className="text-sm font-semibold text-ink">{list.label}</p>
                <ul className="mt-3 space-y-2 text-sm text-muted">
                  {(list.items.length > 0 ? list.items : [list.emptyText]).map((item) => (
                    <li key={item} className="rounded-2xl bg-mist px-3 py-2">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-panel p-5 sm:p-6">
          <p className="section-title">수익 시뮬레이션</p>
          <div className="mt-5 space-y-4">
            <div className="rounded-[1.35rem] border border-line bg-white/75 p-4">
              <p className="text-sm font-semibold text-ink">비용 기준</p>
              <div className="mt-3 space-y-2 text-sm text-muted">
                <div className="flex items-center justify-between gap-3">
                  <span>현재 일본 평균 매입가</span>
                  <strong className="text-ink">
                    {formatCurrency(projection.currentJapanAveragePriceJpy, "JPY")}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>부대비용 합계</span>
                  <strong className="text-ink">
                    {formatCurrency(projection.totalAdditionalCosts, "KRW")}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>수수료 차감 후 실수령</span>
                  <strong className="text-ink">
                    {formatCurrency(projection.netSellProceeds, "KRW")}
                  </strong>
                </div>
              </div>
            </div>

            <div className="rounded-[1.35rem] border border-line bg-gradient-to-br from-teal/10 via-white/70 to-coral/10 p-4">
              <p className="text-sm font-semibold text-ink">핵심 판단값</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/80 p-3">
                  <p className="text-xs uppercase tracking-[0.15em] text-muted">추천 매입가</p>
                  <p className="mt-2 text-lg font-bold text-ink">
                    {formatCurrency(projection.recommendedBuyPriceJpy, "JPY")}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/80 p-3">
                  <p className="text-xs uppercase tracking-[0.15em] text-muted">예상 순이익</p>
                  <p className="mt-2 text-lg font-bold text-ink">
                    {formatCurrency(projection.expectedNetProfit, "KRW")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

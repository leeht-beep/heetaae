import { MARKET_THEME } from "@/lib/constants";
import { MarketAnalysis } from "@/lib/types/market";
import { formatCurrency, formatTrend, marketLabel } from "@/lib/utils/format";

interface MarketInsightsTableProps {
  marketAnalyses: MarketAnalysis[];
}

export function MarketInsightsTable({ marketAnalyses }: MarketInsightsTableProps) {
  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-line px-5 py-5 sm:px-6">
        <p className="section-title">마켓 스냅샷</p>
        <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
          마켓별 평균가와 거래량 신호
        </h2>
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="data-table min-w-full">
          <thead>
            <tr>
              <th>마켓</th>
              <th>평균가</th>
              <th>중간값</th>
              <th>최저 / 최고</th>
              <th>판매중 / 완료</th>
              <th>7일 / 14일 / 30일</th>
              <th>추세</th>
              <th>유동성</th>
            </tr>
          </thead>
          <tbody>
            {marketAnalyses.map((analysis) => (
              <tr key={analysis.sourceMarket}>
                <td>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${MARKET_THEME[analysis.sourceMarket]}`}
                  >
                    {marketLabel(analysis.sourceMarket)}
                  </span>
                </td>
                <td>
                  <div className="font-semibold text-ink">
                    {formatCurrency(analysis.marketAveragePrice, "KRW")}
                  </div>
                  <div className="text-sm text-muted">
                    {analysis.sourceMarket === "mercari"
                      ? formatCurrency(analysis.nativeAveragePrice, "JPY")
                      : formatCurrency(analysis.nativeAveragePrice, "KRW")}
                  </div>
                </td>
                <td>{formatCurrency(analysis.marketMedianPrice, "KRW")}</td>
                <td className="text-sm text-muted">
                  {formatCurrency(analysis.lowestPrice, "KRW")} /{" "}
                  {formatCurrency(analysis.highestPrice, "KRW")}
                </td>
                <td>
                  {analysis.activeListingCount} / {analysis.soldListingCount}
                </td>
                <td>
                  {analysis.estimatedVolume7d} / {analysis.estimatedVolume14d} /{" "}
                  {analysis.estimatedVolume30d}
                </td>
                <td>{formatTrend(analysis.trendDirection, analysis.trendPercentage)}</td>
                <td>{analysis.liquidityScore}점</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 p-5 lg:hidden">
        {marketAnalyses.map((analysis) => (
          <article
            key={analysis.sourceMarket}
            className="rounded-[1.4rem] border border-line bg-white/75 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${MARKET_THEME[analysis.sourceMarket]}`}
              >
                {marketLabel(analysis.sourceMarket)}
              </span>
              <span className="text-sm font-semibold text-muted">
                유동성 {analysis.liquidityScore}점
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted">평균가 / 중간값</p>
                <p className="mt-2 font-semibold text-ink">
                  {formatCurrency(analysis.marketAveragePrice, "KRW")}
                </p>
                <p className="text-sm text-muted">
                  {formatCurrency(analysis.marketMedianPrice, "KRW")}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.15em] text-muted">거래량</p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  7일 {analysis.estimatedVolume7d} / 14일 {analysis.estimatedVolume14d} / 30일{" "}
                  {analysis.estimatedVolume30d}
                </p>
                <p className="text-sm text-muted">
                  판매중 {analysis.activeListingCount} / 판매완료 {analysis.soldListingCount}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-mist px-3 py-3 text-sm">
              <span className="text-muted">
                {formatCurrency(analysis.lowestPrice, "KRW")} ~{" "}
                {formatCurrency(analysis.highestPrice, "KRW")}
              </span>
              <strong className="text-ink">
                {formatTrend(analysis.trendDirection, analysis.trendPercentage)}
              </strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

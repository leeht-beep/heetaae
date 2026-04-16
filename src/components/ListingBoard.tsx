import Image from "next/image";
import { DEFAULT_RESULT_TABS, MARKET_THEME } from "@/lib/constants";
import type {
  MarketListing,
  RecommendedListing,
  ResultTab,
} from "@/lib/types/market";
import {
  formatCurrency,
  formatDate,
  formatPercent,
  listingStatusLabel,
  marketLabel,
} from "@/lib/utils/format";

type SelectableListing = MarketListing | RecommendedListing;

interface ListingBoardProps {
  activeTab: ResultTab;
  listings: MarketListing[];
  recommendedListings: RecommendedListing[];
  onSelect: (listing: SelectableListing) => void;
  onTabChange: (tab: ResultTab) => void;
}

function isRecommendedListing(
  listing: SelectableListing,
): listing is RecommendedListing {
  return "estimatedProfit" in listing;
}

function buildVisibleListings(
  activeTab: ResultTab,
  listings: MarketListing[],
  recommendedListings: RecommendedListing[],
): SelectableListing[] {
  if (activeTab === "recommended") {
    return recommendedListings;
  }

  const filtered = listings.filter((listing) => {
    if (activeTab === "all") {
      return true;
    }

    if (activeTab === "active" || activeTab === "sold") {
      return listing.listingType === activeTab;
    }

    return listing.sourceMarket === activeTab;
  });

  return filtered.sort((left, right) =>
    (right.soldAt ?? right.listedAt).localeCompare(left.soldAt ?? left.listedAt),
  );
}

export function ListingBoard({
  activeTab,
  listings,
  recommendedListings,
  onSelect,
  onTabChange,
}: ListingBoardProps) {
  const visibleListings = buildVisibleListings(activeTab, listings, recommendedListings);
  const counts = {
    recommended: recommendedListings.length,
    all: listings.length,
    active: listings.filter((listing) => listing.listingType === "active").length,
    sold: listings.filter((listing) => listing.listingType === "sold").length,
    mercari: listings.filter((listing) => listing.sourceMarket === "mercari").length,
    bunjang: listings.filter((listing) => listing.sourceMarket === "bunjang").length,
    fruitsfamily: listings.filter((listing) => listing.sourceMarket === "fruitsfamily").length,
  } satisfies Record<ResultTab, number>;

  return (
    <section className="surface-panel overflow-hidden">
      <div className="border-b border-line px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="section-title">매물 목록</p>
            <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
              판매중 / 판매완료 / 추천 매물 비교
            </h2>
          </div>
          <p className="text-sm text-muted">
            추천 탭은 현재 비용 조건 기준으로 매입 매력이 높은 순서대로 정렬합니다.
          </p>
        </div>
      </div>

      <div className="soft-scrollbar overflow-x-auto border-b border-line px-5 py-4 sm:px-6">
        <div className="flex min-w-max gap-2">
          {DEFAULT_RESULT_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "border-transparent bg-ink text-white"
                    : "border-line bg-white/80 text-muted"
                }`}
                type="button"
                onClick={() => onTabChange(tab.id)}
              >
                {tab.label} <span className="ml-1 opacity-70">{counts[tab.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visibleListings.length === 0 ? (
        <div className="px-5 py-12 text-center text-sm text-muted sm:px-6">
          현재 조건에서 보여줄 매물이 없습니다. 검색어를 더 좁히거나 비용 조건을 조정해보세요.
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table min-w-full">
              <thead>
                <tr>
                  <th>상품</th>
                  <th>마켓</th>
                  <th>상태</th>
                  <th>가격</th>
                  <th>날짜</th>
                  <th>관련도</th>
                  <th>판단값</th>
                </tr>
              </thead>
              <tbody>
                {visibleListings.map((listing) => (
                  <tr key={`${listing.sourceMarket}-${listing.id}`}>
                    <td>
                      <div className="flex gap-4">
                        <Image
                          alt={listing.title}
                          className="h-20 w-20 rounded-2xl border border-line object-cover"
                          height={80}
                          src={listing.imageUrl}
                          width={80}
                        />
                        <div className="min-w-0">
                          <button
                            className="line-clamp-2 text-left text-base font-semibold text-ink"
                            type="button"
                            onClick={() => onSelect(listing)}
                          >
                            {listing.title}
                          </button>
                          <p className="mt-1 text-sm text-muted">
                            {listing.brand} / {listing.model}
                            {listing.size ? ` / ${listing.size}` : ""}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {listing.relatedKeywords.slice(0, 4).map((keyword) => (
                              <span key={keyword} className="tag-chip">
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${MARKET_THEME[listing.sourceMarket]}`}
                      >
                        {marketLabel(listing.sourceMarket)}
                      </span>
                    </td>
                    <td>{listingStatusLabel(listing.listingType)}</td>
                    <td>
                      <p className="font-semibold text-ink">
                        {formatCurrency(listing.price, listing.currency)}
                      </p>
                      <p className="text-sm text-muted">
                        {formatCurrency(listing.priceKrw ?? 0, "KRW")}
                      </p>
                    </td>
                    <td>{formatDate(listing.soldAt ?? listing.listedAt)}</td>
                    <td>{Math.round(listing.relevanceScore * 100)}점</td>
                    <td>
                      {isRecommendedListing(listing) ? (
                        <div className="space-y-1 text-sm">
                          <p className="font-semibold text-ink">
                            {formatCurrency(listing.estimatedProfit, "KRW")}
                          </p>
                          <p className="text-muted">
                            {marketLabel(listing.targetResaleMarket)} /{" "}
                            {formatPercent(listing.estimatedMarginRate)}
                          </p>
                        </div>
                      ) : (
                        <a
                          className="text-sm font-semibold text-teal"
                          href={listing.itemUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          원문 보기
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 p-5 lg:hidden">
            {visibleListings.map((listing) => (
              <article
                key={`${listing.sourceMarket}-${listing.id}`}
                className="rounded-[1.4rem] border border-line bg-white/75 p-4"
              >
                <div className="flex gap-4">
                  <Image
                    alt={listing.title}
                    className="h-24 w-24 rounded-2xl border border-line object-cover"
                    height={96}
                    src={listing.imageUrl}
                    width={96}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${MARKET_THEME[listing.sourceMarket]}`}
                      >
                        {marketLabel(listing.sourceMarket)}
                      </span>
                      <span className="tag-chip">{listingStatusLabel(listing.listingType)}</span>
                    </div>
                    <button
                      className="mt-3 line-clamp-2 text-left text-base font-semibold text-ink"
                      type="button"
                      onClick={() => onSelect(listing)}
                    >
                      {listing.title}
                    </button>
                    <p className="mt-2 text-sm text-muted">
                      {listing.brand} / {listing.model}
                      {listing.size ? ` / ${listing.size}` : ""}
                    </p>
                    <div className="mt-3 text-sm">
                      <p className="font-semibold text-ink">
                        {formatCurrency(listing.price, listing.currency)}
                      </p>
                      <p className="text-muted">
                        {formatCurrency(listing.priceKrw ?? 0, "KRW")} /{" "}
                        {formatDate(listing.soldAt ?? listing.listedAt)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {listing.relatedKeywords.slice(0, 4).map((keyword) => (
                    <span key={keyword} className="tag-chip">
                      {keyword}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-mist px-3 py-3 text-sm">
                  <span className="text-muted">
                    관련도 {Math.round(listing.relevanceScore * 100)}점
                  </span>
                  {isRecommendedListing(listing) ? (
                    <strong className="text-ink">
                      수익 {formatCurrency(listing.estimatedProfit, "KRW")}
                    </strong>
                  ) : (
                    <a
                      className="font-semibold text-teal"
                      href={listing.itemUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      원문 보기
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

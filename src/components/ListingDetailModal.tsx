"use client";

import { useEffect } from "react";
import Image from "next/image";
import { MARKET_THEME } from "@/lib/constants";
import {
  MarketListing,
  MarketId,
  ProfitProjection,
  RecommendedListing,
} from "@/lib/types/market";
import {
  formatCurrency,
  formatDate,
  formatPercent,
  listingStatusLabel,
  marketLabel,
} from "@/lib/utils/format";

type SelectableListing = MarketListing | RecommendedListing;

interface ListingDetailModalProps {
  listing: SelectableListing | null;
  comparableListings: MarketListing[];
  projection: ProfitProjection;
  onClose: () => void;
}

function isRecommendedListing(
  listing: SelectableListing,
): listing is RecommendedListing {
  return "estimatedProfit" in listing;
}

function buildMarketComparison(
  listings: MarketListing[],
): Array<{ market: MarketId; averagePrice: number; count: number }> {
  return (["mercari", "bunjang", "fruitsfamily"] as MarketId[]).map((market) => {
    const scoped = listings.filter((listing) => listing.sourceMarket === market);
    const prices = scoped.map((listing) => listing.priceKrw ?? 0).filter(Boolean);

    return {
      market,
      averagePrice:
        prices.length > 0
          ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length)
          : 0,
      count: scoped.length,
    };
  });
}

export function ListingDetailModal({
  listing,
  comparableListings,
  projection,
  onClose,
}: ListingDetailModalProps) {
  useEffect(() => {
    if (!listing) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [listing, onClose]);

  if (!listing) {
    return null;
  }

  const relatedSet = [listing, ...comparableListings];
  const marketComparison = buildMarketComparison(relatedSet);
  const isRecommended = isRecommendedListing(listing);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="surface-panel max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-[2rem] sm:rounded-[2rem]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-white/85 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="section-title">상세 보기</p>
            <h3 className="mt-1 font-[var(--font-display)] text-xl font-bold text-ink">
              개별 상품 비교
            </h3>
          </div>
          <button
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink"
            type="button"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[0.55fr_0.45fr]">
          <div className="space-y-5">
            <Image
              alt={listing.title}
              className="aspect-square w-full rounded-[1.7rem] border border-line object-cover"
              height={960}
              src={listing.imageUrl}
              width={960}
            />

            <div className="rounded-[1.5rem] border border-line bg-white/75 p-4">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${MARKET_THEME[listing.sourceMarket]}`}
                >
                  {marketLabel(listing.sourceMarket)}
                </span>
                <span className="tag-chip">{listingStatusLabel(listing.listingType)}</span>
                <span className="tag-chip">
                  관련도 {Math.round(listing.relevanceScore * 100)}점
                </span>
              </div>
              <h4 className="mt-4 text-2xl font-bold text-ink">{listing.title}</h4>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-mist p-3">
                  <p className="text-xs uppercase tracking-[0.15em] text-muted">가격</p>
                  <p className="mt-2 font-semibold text-ink">
                    {formatCurrency(listing.price, listing.currency)}
                  </p>
                  <p className="text-sm text-muted">
                    {formatCurrency(listing.priceKrw ?? 0, "KRW")}
                  </p>
                </div>
                <div className="rounded-2xl bg-mist p-3">
                  <p className="text-xs uppercase tracking-[0.15em] text-muted">등록 / 판매일</p>
                  <p className="mt-2 text-sm font-semibold text-ink">
                    등록 {formatDate(listing.listedAt)}
                  </p>
                  <p className="text-sm text-muted">판매 {formatDate(listing.soldAt)}</p>
                </div>
              </div>

              {isRecommended ? (
                <div className="mt-4 rounded-[1.2rem] bg-gradient-to-br from-teal/10 via-white to-coral/10 p-4">
                  <p className="text-sm font-semibold text-ink">추천 매입 후보</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.15em] text-muted">예상 순이익</p>
                      <p className="mt-2 font-semibold text-ink">
                        {formatCurrency(listing.estimatedProfit, "KRW")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.15em] text-muted">예상 마진율</p>
                      <p className="mt-2 font-semibold text-ink">
                        {formatPercent(listing.estimatedMarginRate)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {listing.relatedKeywords.map((keyword) => (
                  <span key={keyword} className="tag-chip">
                    {keyword}
                  </span>
                ))}
              </div>

              <a
                className="mt-5 inline-flex rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white"
                href={listing.itemUrl}
                rel="noreferrer"
                target="_blank"
              >
                원문 링크 열기
              </a>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-[1.5rem] border border-line bg-white/75 p-4">
              <p className="section-title">가격 비교</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {marketComparison.map((item) => (
                  <div key={item.market} className="rounded-2xl bg-mist p-3">
                    <p className="text-sm font-semibold text-ink">{marketLabel(item.market)}</p>
                    <p className="mt-2 text-lg font-bold text-ink">
                      {formatCurrency(item.averagePrice, "KRW")}
                    </p>
                    <p className="text-sm text-muted">유사 매물 {item.count}건</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-line bg-white/75 p-4">
              <p className="section-title">판단 기준값</p>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-mist px-3 py-3">
                  <span className="text-muted">추천 매입가</span>
                  <strong className="text-ink">
                    {formatCurrency(projection.recommendedBuyPriceJpy, "JPY")}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-mist px-3 py-3">
                  <span className="text-muted">예상 판매가</span>
                  <strong className="text-ink">
                    {formatCurrency(projection.recommendedSellPrice, "KRW")}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-mist px-3 py-3">
                  <span className="text-muted">추천 판매처</span>
                  <strong className="text-ink">
                    {marketLabel(projection.bestResaleMarket)}
                  </strong>
                </div>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-line bg-white/75 p-4">
              <p className="section-title">유사 매물</p>
              <div className="mt-4 space-y-3">
                {comparableListings.length === 0 ? (
                  <div className="rounded-2xl bg-mist px-4 py-4 text-sm text-muted">
                    현재 묶음에서는 추가로 비교할 유사 매물이 없습니다.
                  </div>
                ) : (
                  comparableListings.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-2xl border border-line bg-white px-3 py-3"
                    >
                      <Image
                        alt={item.title}
                        className="h-16 w-16 rounded-2xl border border-line object-cover"
                        height={64}
                        src={item.imageUrl}
                        width={64}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 font-semibold text-ink">{item.title}</p>
                        <p className="mt-1 text-sm text-muted">
                          {marketLabel(item.sourceMarket)} / {listingStatusLabel(item.listingType)}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-ink">
                          {formatCurrency(item.priceKrw ?? 0, "KRW")}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

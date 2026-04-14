"use client";

import { CostSettings } from "@/lib/types/market";
import { formatCurrency } from "@/lib/utils/format";

interface CostSettingsPanelProps {
  costs: CostSettings;
  pending: boolean;
  onChange: (nextCosts: CostSettings) => void;
  onReset: () => void;
  onSubmit: () => void;
}

export function CostSettingsPanel({
  costs,
  pending,
  onChange,
  onReset,
  onSubmit,
}: CostSettingsPanelProps) {
  const totalAdditionalCosts = Math.round(
    costs.japanDomesticShipping * costs.exchangeRate +
      costs.internationalShipping +
      costs.extraCosts,
  );

  const setNumber = (
    key: keyof CostSettings,
    value: string,
    options?: { percent?: boolean },
  ) => {
    const parsed = Number(value);
    const nextValue = Number.isFinite(parsed) ? parsed : 0;

    onChange({
      ...costs,
      [key]: options?.percent ? nextValue / 100 : nextValue,
    });
  };

  return (
    <aside className="surface-panel lg:sticky lg:top-6">
      <div className="border-b border-line px-5 py-5 sm:px-6">
        <p className="section-title">비용 설정</p>
        <h2 className="mt-2 font-[var(--font-display)] text-2xl font-bold text-ink">
          추천 매입가 계산 설정
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          일본 내 배송비는 JPY 기준, 국제 배송비와 기타 비용은 KRW 기준으로 입력합니다.
        </p>
      </div>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">환율</span>
            <input
              className="soft-input"
              type="number"
              step="0.01"
              value={costs.exchangeRate}
              onChange={(event) => setNumber("exchangeRate", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">
              일본 내 배송비 (JPY)
            </span>
            <input
              className="soft-input"
              type="number"
              step="100"
              value={costs.japanDomesticShipping}
              onChange={(event) => setNumber("japanDomesticShipping", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">
              국제 배송비 (KRW)
            </span>
            <input
              className="soft-input"
              type="number"
              step="1000"
              value={costs.internationalShipping}
              onChange={(event) => setNumber("internationalShipping", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">기타 비용 (KRW)</span>
            <input
              className="soft-input"
              type="number"
              step="1000"
              value={costs.extraCosts}
              onChange={(event) => setNumber("extraCosts", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">플랫폼 수수료 (%)</span>
            <input
              className="soft-input"
              type="number"
              step="0.1"
              value={costs.platformFeeRate * 100}
              onChange={(event) =>
                setNumber("platformFeeRate", event.target.value, { percent: true })
              }
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-ink">목표 마진율 (%)</span>
            <input
              className="soft-input"
              type="number"
              step="0.1"
              value={costs.targetMarginRate * 100}
              onChange={(event) =>
                setNumber("targetMarginRate", event.target.value, { percent: true })
              }
            />
          </label>
        </div>

        <div className="rounded-[1.35rem] border border-line bg-gradient-to-br from-mist via-white to-sand p-4">
          <p className="text-sm font-semibold text-ink">부대비용 요약</p>
          <p className="mt-3 font-[var(--font-display)] text-2xl font-bold text-ink">
            {formatCurrency(totalAdditionalCosts, "KRW")}
          </p>
          <p className="mt-2 text-sm text-muted">
            일본 내 배송비 {formatCurrency(costs.japanDomesticShipping, "JPY")} 포함
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
          <button
            className="soft-button bg-teal text-white"
            type="button"
            disabled={pending}
            onClick={onSubmit}
          >
            {pending ? "재계산 중..." : "이 비용으로 재계산"}
          </button>
          <button
            className="soft-button border border-line bg-white/80 text-ink"
            type="button"
            onClick={onReset}
          >
            기본값으로 되돌리기
          </button>
        </div>
      </div>
    </aside>
  );
}

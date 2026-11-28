'use client';

import type { ReactNode } from 'react';
import type { Deal } from '@/lib/types';
import { lowestSharedPrice } from '@/lib/compare';
import { SITE_LABELS, UNKNOWN_LABEL, formatDiscountRate, formatPrice } from '@/lib/labels';
import { formatRemaining, formatShortDateTime, isExpired } from '@/lib/time';
import { DealImage } from '@/components/DealImage';

interface CompareTableProps {
  /** 비교함에 담은 상품 (담은 순서) */
  deals: readonly Deal[];
  now: Date;
  onRemove: (id: string) => void;
}

const ROW_LABEL =
  'sticky left-0 z-10 w-16 min-w-16 border-r border-[#EEF0F3] bg-white px-3 py-3 text-left align-top text-xs font-medium text-[#8A9099]';
const CELL = 'w-40 min-w-40 px-3 py-3 text-left align-top sm:w-52 sm:min-w-52';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]';

function Unknown() {
  return <span className="text-xs text-[#8A9099]">{UNKNOWN_LABEL}</span>;
}

function stateLabel(deal: Deal, now: Date): string {
  if (isExpired(deal.endsAt, now)) return '종료된 할인';
  return deal.soldOut ? '품절' : '판매 중';
}

function EndsCell({ deal, now }: { deal: Deal; now: Date }) {
  const remaining = formatRemaining(deal.endsAt, now);
  if (remaining.kind === 'unknown') return <Unknown />;
  const text = remaining.kind === 'later' ? `${remaining.label} 마감` : remaining.label;
  return (
    <>
      <span className={`tabular-nums ${remaining.urgent ? 'font-bold text-[#E8112D]' : 'text-[#3D4249]'}`}>{text}</span>
      {deal.endsAtSource === 'event' && <span className="ml-1.5 text-[11px] text-[#8A9099]">행사 기준</span>}
    </>
  );
}

function Row({ label, deals, render }: { label: string; deals: readonly Deal[]; render: (deal: Deal) => ReactNode }) {
  return (
    <tr className="border-t border-[#EEF0F3]">
      <th scope="row" className={ROW_LABEL}>
        {label}
      </th>
      {deals.map((deal) => (
        <td key={deal.id} className={CELL}>
          {render(deal)}
        </td>
      ))}
    </tr>
  );
}

/**
 * 비교함에 담은 상품을 나란히 보여 주는 표 (T050·T051, US4-2).
 * 좁은 화면에서는 표 안에서만 가로로 넘긴다. 모르는 값은 "알 수 없음"으로 둔다 (헌법 III).
 */
export function CompareTable({ deals, now, onRemove }: CompareTableProps) {
  // 담은 것이 모두 같은 상품일 때만 최저가를 가린다 (다른 상품끼리는 싼 쪽이 "최저가"가 아니다).
  const lowest = lowestSharedPrice(deals, now);

  return (
    <div className="overflow-x-auto rounded-xl border border-[#E6E8EC]">
      <table className="border-collapse text-sm">
        <caption className="sr-only">비교함에 담은 상품 비교</caption>
        <thead>
          <tr>
            <th scope="col" className={ROW_LABEL}>
              <span className="sr-only">항목</span>
            </th>
            {deals.map((deal) => (
              <th key={deal.id} scope="col" className={`${CELL} font-normal`}>
                <div className="relative aspect-square overflow-hidden rounded-lg bg-[#F1F2F4]">
                  <DealImage src={deal.imageUrl} />
                  <span className="absolute left-2 top-2 rounded-md bg-[#15171A] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white">
                    {SITE_LABELS[deal.siteId] ?? deal.siteId}
                  </span>
                </div>
                {deal.brand ? (
                  <p className="mt-2 truncate text-xs font-bold text-[#15171A]">{deal.brand}</p>
                ) : (
                  <p className="mt-2 truncate text-[11px] text-[#8A9099]">브랜드 {UNKNOWN_LABEL}</p>
                )}
                <p className="mt-0.5 line-clamp-3 break-words text-sm leading-5 text-[#3D4249]">{deal.name}</p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row
            label="할인가"
            deals={deals}
            render={(deal) => {
              const isLowest = lowest !== null && !deal.soldOut && !isExpired(deal.endsAt, now) && deal.salePrice === lowest;
              return (
                <>
                  <span className={`text-base font-extrabold tabular-nums ${isLowest ? 'text-[#E8112D]' : 'text-[#15171A]'}`}>
                    {formatPrice(deal.salePrice)}
                  </span>
                  {isLowest && (
                    <span className="ml-1.5 rounded bg-[#E8112D] px-1.5 py-0.5 align-middle text-[11px] font-bold text-white">
                      최저가
                    </span>
                  )}
                </>
              );
            }}
          />
          <Row
            label="할인율"
            deals={deals}
            render={(deal) =>
              deal.discountRate !== null ? (
                <span className="font-bold tabular-nums text-[#15171A]">{formatDiscountRate(deal.discountRate)}</span>
              ) : (
                <Unknown />
              )
            }
          />
          <Row
            label="정가"
            deals={deals}
            render={(deal) =>
              deal.originalPrice !== null ? (
                <span className="tabular-nums text-[#8A9099] line-through">{formatPrice(deal.originalPrice)}</span>
              ) : (
                <Unknown />
              )
            }
          />
          <Row label="마감" deals={deals} render={(deal) => <EndsCell deal={deal} now={now} />} />
          <Row
            label="상태"
            deals={deals}
            render={(deal) => <span className="text-[#3D4249]">{stateLabel(deal, now)}</span>}
          />
          <Row
            label="수집"
            deals={deals}
            render={(deal) => (
              <span className="text-xs tabular-nums text-[#8A9099]">{formatShortDateTime(deal.crawledAt)}</span>
            )}
          />
          <Row
            label="이동"
            deals={deals}
            render={(deal) => (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  href={deal.url}
                  target="_blank"
                  rel="noopener"
                  className={`inline-flex h-9 items-center rounded-full bg-[#15171A] px-3.5 text-xs font-bold text-white ${FOCUS}`}
                >
                  사이트에서 보기
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(deal.id)}
                  aria-label={`${deal.name} 비교함에서 빼기`}
                  className={`h-9 text-xs font-medium text-[#8A9099] underline underline-offset-2 hover:text-[#15171A] ${FOCUS}`}
                >
                  빼기
                </button>
              </div>
            )}
          />
        </tbody>
      </table>
    </div>
  );
}

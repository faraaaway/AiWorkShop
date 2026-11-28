'use client';

import type { GroupOffer, ProductGroup } from '@/lib/group';
import { SITE_LABELS, UNKNOWN_LABEL, formatDiscountRate, formatPrice } from '@/lib/labels';
import { formatRemaining } from '@/lib/time';
import { DealImage } from '@/components/DealImage';

interface GroupPriceCardProps {
  group: ProductGroup;
  now: Date;
  /** 목록의 "가격 비교" 링크로 들어온 묶음이면 테두리로 강조한다. */
  focused?: boolean;
}

function endsText(offer: GroupOffer, now: Date): string {
  const remaining = formatRemaining(offer.deal.endsAt, now);
  if (remaining.kind === 'unknown') return `마감 ${UNKNOWN_LABEL}`;
  return remaining.kind === 'later' ? `${remaining.label} 마감` : remaining.label;
}

function OfferRow({ offer, now }: { offer: GroupOffer; now: Date }) {
  const { deal, isLowest, variantCount } = offer;
  return (
    <tr className={`border-t border-[#EEF0F3] ${isLowest ? 'bg-[#FFF1F3]' : ''}`}>
      <th scope="row" className="py-2.5 pl-3 pr-2 text-left align-middle font-bold text-[#15171A]">
        {SITE_LABELS[deal.siteId] ?? deal.siteId}
        {isLowest && (
          <span className="ml-1.5 rounded bg-[#E8112D] px-1.5 py-0.5 align-middle text-[11px] font-bold text-white">
            최저가
          </span>
        )}
        {deal.soldOut && <span className="ml-1.5 text-[11px] font-medium text-[#8A9099]">품절</span>}
        {variantCount > 1 && (
          <span className="block text-[11px] font-normal text-[#8A9099]">옵션 {variantCount}개 중 가장 싼 값</span>
        )}
        <span className="block text-[11px] font-normal tabular-nums text-[#8A9099]">{endsText(offer, now)}</span>
      </th>
      <td className="px-2 py-2.5 text-right align-middle">
        <span className={`font-extrabold tabular-nums ${isLowest ? 'text-[#E8112D]' : deal.soldOut ? 'text-[#8A9099]' : 'text-[#15171A]'}`}>
          {formatPrice(deal.salePrice)}
        </span>
        <span className="block text-[11px] tabular-nums text-[#8A9099]">
          {deal.discountRate !== null ? formatDiscountRate(deal.discountRate) : `할인율 ${UNKNOWN_LABEL}`}
        </span>
      </td>
      <td className="py-2.5 pl-2 pr-3 text-right align-middle">
        <a
          href={deal.url}
          target="_blank"
          rel="noopener"
          aria-label={`${SITE_LABELS[deal.siteId] ?? deal.siteId}에서 ${deal.name} 보기`}
          className="inline-flex h-9 items-center whitespace-nowrap rounded-full border border-[#DFE2E7] px-3 text-xs font-bold text-[#15171A] hover:border-[#15171A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]"
        >
          보러 가기
        </a>
      </td>
    </tr>
  );
}

/**
 * 같은 상품의 사이트별 가격표 (T050, US4-1, FR-019). 최저가 줄을 강조한다.
 */
export function GroupPriceCard({ group, now, focused = false }: GroupPriceCardProps) {
  return (
    <article
      className={`min-w-0 rounded-xl border bg-white ${focused ? 'border-[#15171A] shadow-[0_0_0_1px_#15171A]' : 'border-[#E6E8EC]'}`}
    >
      <div className="flex gap-3 p-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#F1F2F4]">
          <DealImage src={group.imageUrl} fallback={null} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-[#15171A]">{group.brand}</p>
          <h3 className="mt-0.5 line-clamp-2 break-words text-sm leading-5 text-[#3D4249]">{group.name}</h3>
          <p className="mt-1.5 text-xs text-[#3D4249]">
            {group.onSaleCount === 0 ? (
              '모든 사이트에서 품절'
            ) : group.onSaleCount === 1 ? (
              '지금 판매 중인 곳은 한 곳뿐'
            ) : group.priceGap > 0 ? (
              <>
                사이트 간 <strong className="font-extrabold tabular-nums text-[#E8112D]">{formatPrice(group.priceGap)}</strong> 차이
              </>
            ) : (
              '사이트 간 가격이 같음'
            )}
          </p>
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          {group.brand} {group.name} 사이트별 가격
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">사이트와 마감</th>
            <th scope="col">할인가와 할인율</th>
            <th scope="col">상품 페이지</th>
          </tr>
        </thead>
        <tbody>
          {group.offers.map((offer) => (
            <OfferRow key={offer.deal.id} offer={offer} now={now} />
          ))}
        </tbody>
      </table>
    </article>
  );
}

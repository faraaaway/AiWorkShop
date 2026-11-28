'use client';

import { useId } from 'react';
import Link from 'next/link';
import type { Deal } from '@/lib/types';
import { COMPARE_MAX } from '@/lib/compare';
import { SITE_LABELS, UNKNOWN_LABEL, formatDiscountRate, formatPrice } from '@/lib/labels';
import { formatRemaining, formatShortDateTime } from '@/lib/time';
import { DealImage } from '@/components/DealImage';

export interface DealCardCompare {
  /** 이 상품이 비교함에 담겨 있는가 */
  selected: boolean;
  /** 비교함이 가득 찼는가 (담긴 상품은 그래도 뺄 수 있다) */
  full: boolean;
  onToggle: () => void;
}

export interface DealCardGroupLink {
  /** 사이트별 가격 비교 화면 주소 */
  href: string;
  /** 이 상품을 파는 사이트 수 */
  siteCount: number;
}

interface DealCardProps {
  deal: Deal;
  /** 남은 시간 계산 기준 시각 (목록 화면이 1분마다 갱신) */
  now: Date;
  /** 비교함 담기 버튼 (T051). 없으면 그리지 않는다. */
  compare?: DealCardCompare;
  /** 같은 상품이 여러 사이트에 있을 때의 가격 비교 링크 (US4-1). 없으면 그리지 않는다. */
  groupLink?: DealCardGroupLink;
}

const COMPARE_FULL_REASON = `비교함이 가득 찼습니다 (최대 ${COMPARE_MAX}개)`;

/** 카드 이미지 오른쪽 위의 비교함 담기 버튼. 카드 링크 밖에 두어 눌러도 상품 페이지가 열리지 않는다. */
function CompareButton({ deal, selected, full, onToggle }: DealCardCompare & { deal: Deal }) {
  const reasonId = useId();
  const blocked = full && !selected;
  const tone = selected
    ? 'border-[#15171A] bg-[#15171A] text-white'
    : blocked
      ? 'cursor-not-allowed border-[#DFE2E7] bg-white/90 text-[#A3A8B0]'
      : 'border-[#DFE2E7] bg-white/95 text-[#15171A] hover:border-[#15171A]';
  return (
    <>
      <button
        type="button"
        // disabled 대신 aria-disabled: 키보드로도 닿아서 담을 수 없는 이유를 읽을 수 있어야 한다.
        onClick={blocked ? undefined : onToggle}
        // 켜짐/꺼짐은 aria-pressed가 알린다. 이름은 바꾸지 않고, 보이는 글자("비교")를 이름에 담는다.
        aria-pressed={selected}
        aria-disabled={blocked || undefined}
        aria-label={`비교함에 담기: ${deal.name}`}
        aria-describedby={blocked ? reasonId : undefined}
        title={blocked ? COMPARE_FULL_REASON : undefined}
        className={`absolute right-2 top-2 h-8 rounded-full border px-2.5 text-xs font-bold shadow-sm before:absolute before:-inset-1.5 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] ${tone}`}
      >
        {selected ? '✓ 비교' : '+ 비교'}
      </button>
      {blocked && (
        <span id={reasonId} className="sr-only">
          {COMPARE_FULL_REASON}
        </span>
      )}
    </>
  );
}

/**
 * 할인 카드 (T024, T034).
 * 모르는 값은 지어내지 않고 회색 작은 글씨 "알 수 없음"으로 둔다 (헌법 III).
 */
export function DealCard({ deal, now, compare, groupLink }: DealCardProps) {
  const remaining = formatRemaining(deal.endsAt, now);
  const expired = remaining.kind === 'expired';
  const siteName = SITE_LABELS[deal.siteId] ?? deal.siteId;
  const rate = deal.discountRate;
  // 사이트 표시 할인율이 계산값과 1%p 넘게 다르면 함께 보여준다.
  const shownRate =
    rate !== null && deal.displayedDiscountRate !== null && Math.abs(deal.displayedDiscountRate - rate) > 1
      ? deal.displayedDiscountRate
      : null;
  const badge = expired ? '종료' : deal.soldOut ? '품절' : null;

  return (
    <div className="relative min-w-0">
      <a
        href={deal.url}
        target="_blank"
        rel="noopener"
        className={`group block min-w-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15171A] ${expired ? 'opacity-60 grayscale' : ''}`}
      >
        <div className="relative aspect-square overflow-hidden rounded-xl bg-[#F1F2F4]">
          <DealImage src={deal.imageUrl} className={deal.soldOut && !expired ? 'opacity-50' : ''} />

          <span className={`absolute left-2 top-2 truncate rounded-md ${compare ? 'max-w-[calc(100%-5.5rem)]' : 'max-w-[calc(100%-1rem)]'} bg-[#15171A] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white`}>
            {siteName}
          </span>

          {badge && (
            <span className="absolute inset-x-0 bottom-0 bg-[#15171A]/80 py-1.5 text-center text-xs font-semibold text-white">
              {badge}
            </span>
          )}
        </div>

        <div className="mt-2.5 min-w-0 px-0.5">
          {deal.brand ? (
            <p className="truncate text-xs font-bold text-[#15171A]">{deal.brand}</p>
          ) : (
            <p className="truncate text-[11px] text-[#8A9099]">브랜드 {UNKNOWN_LABEL}</p>
          )}

          <p className="mt-0.5 line-clamp-2 min-h-[2.5rem] break-words text-sm leading-5 text-[#3D4249] group-hover:underline">
            {deal.name}
          </p>

          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            {rate !== null ? (
              <span className="text-[22px] font-extrabold leading-7 tracking-tight tabular-nums text-[#E8112D]">
                {formatDiscountRate(rate)}
              </span>
            ) : (
              <span className="text-[11px] leading-7 text-[#8A9099]">할인율 {UNKNOWN_LABEL}</span>
            )}
            <span className="text-base font-bold leading-7 tabular-nums text-[#15171A]">
              {formatPrice(deal.salePrice)}
            </span>
          </p>

          <p className="text-xs leading-4 text-[#8A9099]">
            {deal.originalPrice !== null ? (
              <span className="tabular-nums line-through">{formatPrice(deal.originalPrice)}</span>
            ) : (
              <span className="text-[11px]">정가 {UNKNOWN_LABEL}</span>
            )}
            {shownRate !== null && (
              <span className="ml-1.5 text-[11px]">사이트 표시 {formatDiscountRate(shownRate)}</span>
            )}
          </p>

          <p className="mt-2 flex min-h-[1.375rem] flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            {remaining.kind === 'unknown' && <span className="text-[11px] text-[#8A9099]">마감 {UNKNOWN_LABEL}</span>}
            {remaining.kind === 'expired' && <span className="font-medium text-[#8A9099]">종료된 할인</span>}
            {(remaining.kind === 'today' || remaining.kind === 'later') &&
              (remaining.urgent ? (
                <span className="rounded bg-[#E8112D] px-1.5 py-0.5 font-bold tabular-nums text-white">
                  {remaining.kind === 'today' ? remaining.label : `${remaining.label} 마감`}
                </span>
              ) : (
                <span className="font-medium tabular-nums text-[#3D4249]">{remaining.label}</span>
              ))}
            {deal.endsAtSource === 'event' && remaining.kind !== 'unknown' && (
              <span className="text-[11px] text-[#8A9099]" title={deal.eventName ?? undefined}>
                행사 기준
              </span>
            )}
          </p>

          <p className="mt-1 text-[11px] leading-4 tabular-nums text-[#A3A8B0]">
            {formatShortDateTime(deal.crawledAt)} 수집
          </p>
        </div>
      </a>

      {compare && <CompareButton deal={deal} {...compare} />}

      {groupLink && (
        <Link
          href={groupLink.href}
          className="mx-0.5 mt-1.5 inline-flex h-7 items-center rounded-md bg-[#F1F2F4] px-2 text-xs font-bold text-[#15171A] hover:bg-[#E6E8EC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]"
        >
          {groupLink.siteCount}곳 가격 비교
          <span aria-hidden="true" className="ml-1">
            ›
          </span>
        </Link>
      )}
    </div>
  );
}

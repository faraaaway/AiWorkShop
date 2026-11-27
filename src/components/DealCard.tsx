'use client';

import { useState } from 'react';
import type { Deal } from '@/lib/types';
import { SITE_LABELS, UNKNOWN_LABEL, formatDiscountRate, formatPrice } from '@/lib/labels';
import { formatRemaining, formatShortDateTime } from '@/lib/time';

interface DealCardProps {
  deal: Deal;
  /** 남은 시간 계산 기준 시각 (목록 화면이 1분마다 갱신) */
  now: Date;
}

/**
 * 할인 카드 (T024, T034).
 * 모르는 값은 지어내지 않고 회색 작은 글씨 "알 수 없음"으로 둔다 (헌법 III).
 */
export function DealCard({ deal, now }: DealCardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  const remaining = formatRemaining(deal.endsAt, now);
  const expired = remaining.kind === 'expired';
  const siteName = SITE_LABELS[deal.siteId] ?? deal.siteId;
  const rate = deal.discountRate;
  // 사이트 표시 할인율이 계산값과 1%p 넘게 다르면 함께 보여준다.
  const shownRate =
    rate !== null && deal.displayedDiscountRate !== null && Math.abs(deal.displayedDiscountRate - rate) > 1
      ? deal.displayedDiscountRate
      : null;
  const showImage = deal.imageUrl !== null && !imageFailed;
  const badge = expired ? '종료' : deal.soldOut ? '품절' : null;

  return (
    <a
      href={deal.url}
      target="_blank"
      rel="noopener"
      className={`group block min-w-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15171A] ${expired ? 'opacity-60 grayscale' : ''}`}
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-[#F1F2F4]">
        {showImage ? (
          // 쇼핑몰 CDN 이미지를 그대로 쓴다 (next/image는 도메인 등록이 필요해 쓰지 않음).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deal.imageUrl ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className={`h-full w-full object-cover ${deal.soldOut && !expired ? 'opacity-50' : ''}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-[#8A9099]">이미지 없음</div>
        )}

        <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-[#15171A] px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white">
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
  );
}

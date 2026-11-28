'use client';

import Link from 'next/link';
import type { Deal } from '@/lib/types';
import { COMPARE_MAX, COMPARE_MIN } from '@/lib/compare';
import { DealImage } from '@/components/DealImage';

export interface CompareTrayItem {
  id: string;
  /** 담아 두었지만 지금 수집된 목록에 없으면 null */
  deal: Deal | null;
}

interface CompareTrayProps {
  /** 담은 순서 그대로 */
  items: readonly CompareTrayItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]';
const ACTION = `inline-flex h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold ${FOCUS}`;

function TrayThumb({ item, onRemove }: { item: CompareTrayItem; onRemove: (id: string) => void }) {
  const name = item.deal ? item.deal.name : '지금 목록에 없는 상품';
  return (
    <li className="relative h-11 w-11 shrink-0">
      <div className="h-full w-full overflow-hidden rounded-lg bg-[#F1F2F4]" title={name}>
        {item.deal ? (
          <DealImage src={item.deal.imageUrl} fallback={null} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-[#8A9099]">없음</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`${name} 비교함에서 빼기`}
        className={`absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#15171A] text-[11px] leading-none text-white before:absolute before:-inset-2 before:content-[''] ${FOCUS}`}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

/**
 * 비교함 (T051, US4-2): 목록 화면 아래에 붙어 담은 상품을 보여 주고 비교 화면으로 보낸다.
 * 담은 것이 없으면 그리지 않는다.
 */
export function CompareTray({ items, onRemove, onClear }: CompareTrayProps) {
  if (items.length === 0) return null;
  const ready = items.length >= COMPARE_MIN;

  return (
    <section
      aria-label="비교함"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E6E8EC] bg-white shadow-[0_-6px_20px_rgba(21,23,26,0.08)]"
    >
      <div className="mx-auto flex max-w-screen-2xl items-center gap-3 px-4 py-2.5">
        <p className="shrink-0 text-sm font-bold text-[#15171A]" aria-live="polite">
          비교함{' '}
          <span className="tabular-nums">
            {items.length}/{COMPARE_MAX}
          </span>
        </p>

        <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1.5 pr-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item) => (
            <TrayThumb key={item.id} item={item} onRemove={onRemove} />
          ))}
        </ul>

        {/* 좁은 화면에서는 자리가 모자라 숨긴다 (썸네일의 ×로 하나씩 뺄 수 있다). */}
        <button
          type="button"
          onClick={onClear}
          className={`hidden h-11 shrink-0 items-center px-2 text-sm font-medium text-[#8A9099] hover:text-[#15171A] sm:inline-flex ${FOCUS}`}
        >
          비우기
        </button>

        {ready ? (
          <Link href="/compare" className={`${ACTION} bg-[#15171A] text-white`}>
            비교하기
          </Link>
        ) : (
          // 하나만 담았을 때: 누를 수 없는 이유를 글로 보여 준다.
          <span className={`${ACTION} bg-[#EEF0F3] text-[#8A9099]`}>{COMPARE_MIN}개부터 비교</span>
        )}
      </div>
    </section>
  );
}

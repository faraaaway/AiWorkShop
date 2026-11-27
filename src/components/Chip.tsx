import type { ReactNode } from 'react';

interface ChipProps {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  /** sale: 할인율·마감처럼 빨강으로 읽히는 조건에만 쓴다 */
  tone?: 'ink' | 'sale';
  /** 펼침 패널을 여닫는 칩일 때 */
  expanded?: boolean;
  controls?: string;
  /** 고를 수 없는 칩일 때 그 이유 — 흐리게 그리고 눌러도 반응하지 않는다 */
  unavailableReason?: string;
}

/** 누르면 켜지고 다시 누르면 꺼지는 필터 칩. */
export function Chip({ selected, onClick, children, tone = 'ink', expanded, controls, unavailableReason }: ChipProps) {
  const unavailable = unavailableReason !== undefined;
  const on = tone === 'sale' ? 'border-[#E8112D] bg-[#E8112D] text-white' : 'border-[#15171A] bg-[#15171A] text-white';
  const off = 'border-[#DFE2E7] bg-white text-[#15171A] hover:border-[#15171A]';
  const dimmed = 'cursor-not-allowed border-dashed border-[#DFE2E7] bg-transparent text-[#A3A8B0]';
  return (
    <button
      type="button"
      // disabled 대신 aria-disabled: 키보드로도 닿아서 이유(title)를 읽을 수 있어야 한다.
      onClick={unavailable ? undefined : onClick}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-disabled={unavailable || undefined}
      title={unavailableReason}
      className={`h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A] ${unavailable ? dimmed : selected ? on : off}`}
    >
      {children}
    </button>
  );
}

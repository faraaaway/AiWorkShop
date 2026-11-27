import { SORT_KEYS, type SortKey } from '@/lib/filters';

export const SORT_LABELS: Record<SortKey, string> = {
  discount: '할인율 높은 순',
  ending: '마감 임박 순',
  price: '가격 낮은 순',
};

interface SortSelectProps {
  value: SortKey;
  onChange: (next: SortKey) => void;
}

/** 정렬 선택 (T032). 휴대폰에서 기본 선택 화면이 뜨도록 native select를 쓴다. */
export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">정렬</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SortKey)}
        className="h-9 appearance-none rounded-full border border-[#DFE2E7] bg-white pl-3.5 pr-8 text-sm font-medium text-[#15171A] hover:border-[#15171A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]"
      >
        {SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-[#15171A]"
      >
        <path d="M2 4.5 6 8.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

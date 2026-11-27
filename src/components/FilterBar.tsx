'use client';

import { useState } from 'react';
import type { SiteId } from '@/lib/types';
import { GENDER_LABELS, SITE_LABELS, THEME_LABELS } from '@/lib/labels';
import {
  GENDER_ORDER,
  SITE_ORDER,
  THEME_ORDER,
  type DiscountMin,
  type FilterState,
  type SiteOption,
  type SortKey,
} from '@/lib/filters';
import { Chip } from '@/components/Chip';
import { SortSelect } from '@/components/SortSelect';

const DISCOUNT_CHIPS: DiscountMin[] = [30, 50, 70];

// 가로로 넘기는 줄. 스크롤 막대는 숨기고 화면 폭은 넘지 않게 한다.
const SCROLL_ROW =
  'flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

interface FilterBarProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  sort: SortKey;
  onSortChange: (next: SortKey) => void;
  /** 사이트별 할인 개수. 목록을 아직 못 읽었으면 null (개수 없이 모두 고를 수 있게 둔다). */
  siteOptions: readonly SiteOption[] | null;
}

interface SiteFilterPanelProps {
  selected: SiteId[];
  options: readonly SiteOption[] | null;
  onToggle: (id: SiteId) => void;
  onClear: () => void;
}

/** 사이트 선택 (여러 곳 선택 가능). 할인이 없는 사이트는 흐리게 두고 고를 수 없다. */
function SiteFilterPanel({ selected, options, onToggle, onClear }: SiteFilterPanelProps) {
  return (
    <div
      id="site-filter-panel"
      role="group"
      aria-label="사이트"
      className="flex flex-wrap gap-2 border-t border-[#EEF0F3] bg-[#F7F8FA] px-4 py-3"
    >
      <Chip selected={selected.length === 0} onClick={onClear}>
        모든 사이트
      </Chip>
      {SITE_ORDER.map((id) => {
        const option = options?.find((candidate) => candidate.id === id);
        const isSelected = selected.includes(id);
        // 이미 골라 둔 사이트는 할인이 없어도 다시 눌러 뺄 수 있어야 한다.
        const reason = option && !isSelected ? (option.emptyReason ?? undefined) : undefined;
        return (
          <Chip key={id} selected={isSelected} onClick={() => onToggle(id)} unavailableReason={reason}>
            {SITE_LABELS[id]}
            {option && <span className="ml-1 text-xs tabular-nums opacity-70">{option.count.toLocaleString('ko-KR')}</span>}
          </Chip>
        );
      })}
    </div>
  );
}

/**
 * 상단 고정 필터 (T031): 성별 탭 → 테마 칩 → 정렬·할인율·오늘 마감·사이트·종료 보기.
 */
export function FilterBar({ filters, onChange, sort, onSortChange, siteOptions }: FilterBarProps) {
  const [sitesOpen, setSitesOpen] = useState(false);
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  const toggleSite = (id: SiteId) => {
    const next = filters.sites.includes(id) ? filters.sites.filter((s) => s !== id) : [...filters.sites, id];
    set({ sites: SITE_ORDER.filter((s) => next.includes(s)) });
  };

  const siteChipLabel =
    filters.sites.length === 0
      ? '사이트'
      : filters.sites.length === 1
        ? SITE_LABELS[filters.sites[0]]
        : `사이트 ${filters.sites.length}곳`;

  return (
    <div className="sticky top-0 z-20 border-b border-[#E6E8EC] bg-white">
      <div className="mx-auto max-w-screen-2xl">
        {/* 성별 탭 */}
        <div role="group" aria-label="성별" className="flex border-b border-[#EEF0F3] px-2">
          {(['all', ...GENDER_ORDER] as const).map((gender) => {
            const selected = filters.gender === gender;
            return (
              <button
                key={gender}
                type="button"
                aria-pressed={selected}
                onClick={() => set({ gender })}
                className={`relative h-11 min-w-0 flex-1 text-[15px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#15171A] sm:flex-none sm:px-5 ${selected ? 'font-bold text-[#15171A]' : 'font-medium text-[#8A9099] hover:text-[#15171A]'}`}
              >
                {gender === 'all' ? '전체' : GENDER_LABELS[gender]}
                {selected && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#15171A]" />}
              </button>
            );
          })}
        </div>

        {/* 테마 칩 */}
        <div role="group" aria-label="테마" className={`${SCROLL_ROW} pt-2.5`}>
          <Chip selected={filters.theme === 'all'} onClick={() => set({ theme: 'all' })}>
            전체
          </Chip>
          {THEME_ORDER.map((theme) => (
            <Chip key={theme} selected={filters.theme === theme} onClick={() => set({ theme })}>
              {THEME_LABELS[theme]}
            </Chip>
          ))}
        </div>

        {/* 정렬 · 할인율 · 오늘 마감 · 사이트 · 종료 보기 */}
        <div className={`${SCROLL_ROW} py-2.5`}>
          <SortSelect value={sort} onChange={onSortChange} />
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-[#DFE2E7]" />
          <div role="group" aria-label="할인율" className="flex shrink-0 items-center gap-2">
            {DISCOUNT_CHIPS.map((min) => (
              <Chip
                key={min}
                tone="sale"
                selected={filters.minDiscount === min}
                onClick={() => set({ minDiscount: filters.minDiscount === min ? 0 : min })}
              >
                {min}% 이상
              </Chip>
            ))}
          </div>
          <Chip tone="sale" selected={filters.endingToday} onClick={() => set({ endingToday: !filters.endingToday })}>
            오늘 마감
          </Chip>
          <Chip
            selected={filters.sites.length > 0}
            expanded={sitesOpen}
            controls="site-filter-panel"
            onClick={() => setSitesOpen((open) => !open)}
          >
            {siteChipLabel}
            <span aria-hidden="true" className="ml-1 inline-block text-[10px]">
              {sitesOpen ? '▲' : '▼'}
            </span>
          </Chip>
          <Chip selected={filters.includeExpired} onClick={() => set({ includeExpired: !filters.includeExpired })}>
            종료된 할인 보기
          </Chip>
        </div>

        {sitesOpen && (
          <SiteFilterPanel
            selected={filters.sites}
            options={siteOptions}
            onToggle={toggleSite}
            onClear={() => set({ sites: [] })}
          />
        )}
      </div>
    </div>
  );
}

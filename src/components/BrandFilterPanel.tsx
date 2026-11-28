'use client';

import { useState } from 'react';
import type { BrandOption } from '@/lib/filters';
import { normalizeBrand } from '@/lib/group';
import { Chip } from '@/components/Chip';

/** 한 번에 보여 주는 브랜드 칩 수. 브랜드가 수백 개라 나머지는 이름으로 찾게 한다. */
const MAX_SHOWN = 30;

interface BrandFilterPanelProps {
  /** 고른 브랜드의 키 (고른 순서) */
  selected: readonly string[];
  /** 브랜드별 할인 개수, 많은 순. 목록을 아직 못 읽었으면 null */
  options: readonly BrandOption[] | null;
  onToggle: (key: string) => void;
  onClear: () => void;
}

function BrandCount({ count }: { count: number }) {
  return <span className="ml-1 text-xs tabular-nums opacity-70">{count.toLocaleString('ko-KR')}</span>;
}

/**
 * 브랜드 선택 (여러 개 선택 가능). 할인이 많은 브랜드부터 보여 주고, 이름을 치면 그 안에서 좁힌다.
 * 고른 브랜드는 항상 맨 앞에 두어 다시 눌러 뺄 수 있게 한다.
 */
export function BrandFilterPanel({ selected, options, onToggle, onClear }: BrandFilterPanelProps) {
  const [term, setTerm] = useState('');
  const needle = normalizeBrand(term);

  const byKey = new Map((options ?? []).map((option) => [option.key, option]));
  // 고른 브랜드가 지금 목록에 없어도(재수집으로 사라짐) 뺄 수 있도록 칩은 남긴다.
  const chosen = selected.map((key) => byKey.get(key) ?? { key, label: key, count: 0 });
  const candidates = (options ?? []).filter(
    (option) => !selected.includes(option.key) && (needle === '' || option.key.includes(needle)),
  );
  const shown = candidates.slice(0, MAX_SHOWN);
  const hiddenCount = candidates.length - shown.length;

  return (
    <div
      id="brand-filter-panel"
      role="group"
      aria-label="브랜드"
      className="border-t border-[#EEF0F3] bg-[#F7F8FA] px-4 py-3"
    >
      <label className="block">
        <span className="sr-only">브랜드 이름으로 찾기</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="브랜드 이름으로 찾기"
          autoComplete="off"
          // 휴대폰에서는 16px: 더 작으면 iOS가 입력할 때 화면을 확대한다.
          className="h-10 w-full max-w-xs rounded-full border border-[#DFE2E7] bg-white px-3.5 text-base text-[#15171A] sm:h-9 sm:text-sm placeholder:text-[#A3A8B0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]"
        />
      </label>

      {/* 상단 고정 영역 안에 있으므로 길어지면 이 안에서만 넘긴다 (목록을 가리지 않게). */}
      <div className="mt-2.5 flex max-h-44 flex-wrap gap-2 overflow-y-auto p-0.5">
        <Chip selected={selected.length === 0} onClick={onClear}>
          모든 브랜드
        </Chip>
        {chosen.map((option) => (
          <Chip key={option.key} selected onClick={() => onToggle(option.key)}>
            {option.label}
            <BrandCount count={option.count} />
          </Chip>
        ))}
        {shown.map((option) => (
          <Chip key={option.key} selected={false} onClick={() => onToggle(option.key)}>
            {option.label}
            <BrandCount count={option.count} />
          </Chip>
        ))}
      </div>

      <p className="mt-2 text-xs text-[#8A9099]" aria-live="polite">
        {options === null && '브랜드 목록을 불러오는 중…'}
        {options !== null && candidates.length === 0 && needle !== '' && `"${term.trim()}"에 맞는 브랜드가 없습니다.`}
        {hiddenCount > 0 &&
          `할인이 많은 순으로 ${MAX_SHOWN}개만 보입니다. 나머지 ${hiddenCount.toLocaleString('ko-KR')}개는 이름으로 찾아보세요.`}
      </p>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Deal } from '@/lib/types';
import { getDeals } from '@/lib/api';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  applyFilters,
  isFiltered,
  loadSavedView,
  saveView,
  sortDeals,
  type FilterState,
  type SortKey,
} from '@/lib/filters';
import { STALE_AFTER_HOURS, formatAgo, formatDateTime, isStale } from '@/lib/time';
import { AppHeader } from '@/components/AppHeader';
import { DealCard } from '@/components/DealCard';
import { FilterBar } from '@/components/FilterBar';
import { useNow } from '@/components/useNow';

/** 한 번에 그리는 카드 수. 아래로 내리면 이만큼씩 더 그린다 (5,000개에서도 필터가 바로 반응하도록). */
const PAGE_SIZE = 60;

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5';

interface DealsData {
  deals: Deal[];
  lastUpdatedAt: string | null;
}

export default function DealListPage() {
  const [data, setData] = useState<DealsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [restored, setRestored] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useNow();
  const moreRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await getDeals();
      setData({ deals: result.deals, lastUpdatedAt: result.lastUpdatedAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '할인 목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 지난번에 고른 필터·정렬 되살리기 (FR-022)
  useEffect(() => {
    const saved = loadSavedView();
    if (saved) {
      setFilters(saved.filters);
      setSort(saved.sort);
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) saveView({ filters, sort });
  }, [restored, filters, sort]);

  const changeFilters = (next: FilterState) => {
    setFilters(next);
    setShown(PAGE_SIZE);
  };
  const changeSort = (next: SortKey) => {
    setSort(next);
    setShown(PAGE_SIZE);
  };
  const resetFilters = () => changeFilters(DEFAULT_FILTERS);

  const results = useMemo(
    () => (data ? sortDeals(applyFilters(data.deals, filters, now), sort, now) : []),
    [data, filters, sort, now],
  );
  const visible = results.slice(0, shown);
  const hasMore = shown < results.length;

  // 목록 끝이 보이면 다음 묶음을 그린다.
  useEffect(() => {
    const target = moreRef.current;
    if (!target || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown((count) => count + PAGE_SIZE);
      },
      { rootMargin: '600px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, shown]);

  const stale = data ? isStale(data.lastUpdatedAt, now) : false;
  const filtered = isFiltered(filters);

  return (
    <div className="min-h-screen bg-white text-[#15171A]">
      <AppHeader>
        {data &&
          (data.lastUpdatedAt ? (
            <span>
              마지막 업데이트 <time dateTime={data.lastUpdatedAt}>{formatDateTime(data.lastUpdatedAt)}</time> (
              {formatAgo(data.lastUpdatedAt, now)})
            </span>
          ) : (
            <span>마지막 업데이트 알 수 없음</span>
          ))}
      </AppHeader>

      {/* 상단 고정이 화면 전체 높이에서 동작하도록 감싸는 요소 없이 바로 둔다 */}
      <FilterBar filters={filters} onChange={changeFilters} sort={sort} onSortChange={changeSort} />

      <main className="mx-auto max-w-screen-2xl px-4 pb-16 pt-4">
        {stale && (
          <p role="status" className="mb-4 rounded-lg bg-[#FFF4D6] px-3.5 py-2.5 text-sm text-[#5C4400]">
            마지막 업데이트가 {STALE_AFTER_HOURS}시간을 넘었습니다. 가격과 마감 시각이 달라졌을 수 있습니다.{' '}
            <Link href="/status" className="font-bold underline underline-offset-2">
              다시 수집하기
            </Link>
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-lg bg-[#FDECEE] px-3.5 py-3 text-sm text-[#9B0C1F]">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-1 font-bold underline underline-offset-2">
              다시 불러오기
            </button>
          </div>
        )}

        {!data && !error && (
          <div className={GRID} aria-busy="true" aria-label="할인 목록을 불러오는 중">
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index}>
                <div className="aspect-square rounded-xl bg-[#F1F2F4]" />
                <div className="mt-3 h-3 w-1/3 rounded bg-[#F1F2F4]" />
                <div className="mt-2 h-3 w-4/5 rounded bg-[#F1F2F4]" />
                <div className="mt-3 h-5 w-1/2 rounded bg-[#F1F2F4]" />
              </div>
            ))}
          </div>
        )}

        {data && data.deals.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-base font-bold">아직 수집된 할인이 없습니다</p>
            <p className="mt-1 text-sm text-[#8A9099]">수집 상태 화면에서 수집을 시작하면 여기에 표시됩니다.</p>
            <Link
              href="/status"
              className="mt-5 inline-flex h-11 items-center rounded-full bg-[#15171A] px-5 text-sm font-bold text-white"
            >
              수집 상태로 가기
            </Link>
          </div>
        )}

        {data && data.deals.length > 0 && (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm text-[#3D4249]" aria-live="polite">
                할인 <strong className="font-bold tabular-nums text-[#15171A]">{results.length.toLocaleString('ko-KR')}</strong>개
              </p>
              {filtered && results.length > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-sm font-medium text-[#8A9099] underline underline-offset-2 hover:text-[#15171A]"
                >
                  필터 초기화
                </button>
              )}
            </div>

            {results.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-base font-bold">조건에 맞는 할인이 없습니다</p>
                <p className="mt-1 text-sm text-[#8A9099]">조건을 줄이거나 필터를 초기화해 보세요.</p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-5 inline-flex h-11 items-center rounded-full bg-[#15171A] px-5 text-sm font-bold text-white"
                >
                  필터 초기화
                </button>
              </div>
            ) : (
              <>
                <ul className={GRID}>
                  {visible.map((deal) => (
                    <li key={deal.id} className="min-w-0">
                      <DealCard deal={deal} now={now} />
                    </li>
                  ))}
                </ul>
                {hasMore && <div ref={moreRef} className="h-10" aria-hidden="true" />}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { isCompareFull } from '@/lib/compare';
import { isReadOnlyDeploy } from '@/lib/deploy-mode';
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  SITE_ORDER,
  applyFilters,
  buildBrandOptions,
  buildSiteOptions,
  countCollectedSites,
  countExpired,
  isFiltered,
  loadSavedView,
  saveView,
  sortDeals,
  type FilterState,
  type SortKey,
} from '@/lib/filters';
import { groupDeals, indexGroupsByDealId } from '@/lib/group';
import { STALE_AFTER_HOURS, isStale } from '@/lib/time';
import { AppHeader, LastUpdated } from '@/components/AppHeader';
import { CompareTray } from '@/components/CompareTray';
import { DealCard } from '@/components/DealCard';
import { FilterBar } from '@/components/FilterBar';
import { useCompare } from '@/components/useCompare';
import { useDeals } from '@/components/useDeals';
import { useNow } from '@/components/useNow';

/** 한 번에 그리는 카드 수. 아래로 내리면 이만큼씩 더 그린다 (5,000개에서도 필터가 바로 반응하도록). */
const PAGE_SIZE = 60;

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4 xl:grid-cols-5';

/** 사이트별 가격 비교 화면에서 이 묶음을 맨 앞에 보여 주는 주소. */
function groupHref(key: string): string {
  return `/compare?group=${encodeURIComponent(key)}`;
}

/** 일부 사이트만 수집됐을 때 필터 아래에 한 줄로 알린다 (수집이 막힌 사이트가 있을 수 있다). */
function CollectionHint({ collected, total }: { collected: number; total: number }) {
  return (
    <p className="mb-3 text-xs text-[#8A9099]">
      {total}곳 중 {collected}곳만 수집됨 —{' '}
      <Link href="/status" className="underline underline-offset-2 hover:text-[#15171A]">
        수집 상태 보기
      </Link>
    </p>
  );
}

/** 수집된 할인이 모두 종료됐을 때: 걸린 필터가 없으니 초기화 대신 종료된 할인 보기를 권한다. */
function AllExpiredMessage({ onShowExpired }: { onShowExpired: () => void }) {
  return (
    <div className="py-20 text-center">
      <p className="text-base font-bold">진행 중인 할인이 없습니다</p>
      <p className="mt-1 text-sm text-[#8A9099]">수집된 할인이 모두 종료됐습니다.</p>
      <button
        type="button"
        onClick={onShowExpired}
        className="mt-5 inline-flex h-11 items-center rounded-full bg-[#15171A] px-5 text-sm font-bold text-white"
      >
        종료된 할인 보기
      </button>
    </div>
  );
}

export default function DealListPage() {
  const { data, error, reload } = useDeals();
  const compare = useCompare();
  const readOnly = isReadOnlyDeploy();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [restored, setRestored] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const now = useNow();
  const moreRef = useRef<HTMLDivElement | null>(null);

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

  // 사이트 필터가 실제로 할인이 있는 사이트만 고르게 한다 (수집이 안 되는 사이트가 있다).
  const siteOptions = useMemo(
    () => (data ? buildSiteOptions(data.deals, filters.includeExpired, now) : null),
    [data, filters.includeExpired, now],
  );
  const collectedSites = siteOptions ? countCollectedSites(siteOptions) : 0;
  // 브랜드 필터 선택지: 할인이 많은 브랜드부터 (종료된 할인은 "종료된 할인 보기"가 켜져 있을 때만 센다).
  const brandOptions = useMemo(
    () => (data ? buildBrandOptions(data.deals, filters.includeExpired, now) : null),
    [data, filters.includeExpired, now],
  );
  // 종료된 할인이 없으면 "종료된 할인 보기"를 흐리게 둔다 (켜도 달라지는 것이 없다).
  const expiredCount = useMemo(() => (data ? countExpired(data.deals, now) : null), [data, now]);

  // 같은 상품이 여러 사이트에 있으면 카드에 "N곳 가격 비교" 링크를 단다 (US4-1).
  const groupByDealId = useMemo(
    () => indexGroupsByDealId(data ? groupDeals(data.deals, now) : []),
    [data, now],
  );

  // 비교함에 담은 상품 (US4-2). 지금 목록에 없는 것은 deal 없이 자리만 남겨 뺄 수 있게 한다.
  const trayItems = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.deals.map((deal) => [deal.id, deal]));
    return compare.ids.map((id) => ({ id, deal: byId.get(id) ?? null }));
  }, [data, compare.ids]);
  const compareFull = isCompareFull(compare.ids);

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
      <AppHeader>{data && <LastUpdated at={data.lastUpdatedAt} now={now} />}</AppHeader>

      {/* 상단 고정이 화면 전체 높이에서 동작하도록 감싸는 요소 없이 바로 둔다 */}
      <FilterBar
        filters={filters}
        onChange={changeFilters}
        sort={sort}
        onSortChange={changeSort}
        siteOptions={siteOptions}
        brandOptions={brandOptions}
        expiredCount={expiredCount}
      />

      {/* 비교함이 떠 있으면 마지막 줄 카드가 가려지지 않게 아래를 더 비운다 */}
      <main className={`mx-auto max-w-screen-2xl px-4 pt-4 ${trayItems.length > 0 ? 'pb-32' : 'pb-16'}`}>
        {/* 공개 배포판에는 수집 상태 화면이 없으므로 그쪽으로 가는 안내와 링크를 보이지 않는다 */}
        {!readOnly && data && data.deals.length > 0 && collectedSites < SITE_ORDER.length && (
          <CollectionHint collected={collectedSites} total={SITE_ORDER.length} />
        )}

        {stale && (
          <p role="status" className="mb-4 rounded-lg bg-[#FFF4D6] px-3.5 py-2.5 text-sm text-[#5C4400]">
            마지막 업데이트가 {STALE_AFTER_HOURS}시간을 넘었습니다. 가격과 마감 시각이 달라졌을 수 있습니다.
            {!readOnly && (
              <>
                {' '}
                <Link href="/status" className="font-bold underline underline-offset-2">
                  다시 수집하기
                </Link>
              </>
            )}
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-lg bg-[#FDECEE] px-3.5 py-3 text-sm text-[#9B0C1F]">
            <p>{error}</p>
            <button type="button" onClick={() => void reload()} className="mt-1 font-bold underline underline-offset-2">
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

        {data && data.deals.length === 0 && readOnly && (
          <div className="py-20 text-center">
            <p className="text-base font-bold">아직 공개된 할인이 없습니다</p>
            <p className="mt-1 text-sm text-[#8A9099]">할인 목록이 올라오면 여기에 표시됩니다.</p>
          </div>
        )}

        {data && data.deals.length === 0 && !readOnly && (
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

            {results.length === 0 && !filtered ? (
              <AllExpiredMessage onShowExpired={() => changeFilters({ ...filters, includeExpired: true })} />
            ) : results.length === 0 ? (
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
                  {visible.map((deal) => {
                    const group = groupByDealId.get(deal.id);
                    return (
                      <li key={deal.id} className="min-w-0">
                        <DealCard
                          deal={deal}
                          now={now}
                          compare={{
                            selected: compare.ids.includes(deal.id),
                            full: compareFull,
                            onToggle: () => compare.toggle(deal.id),
                          }}
                          groupLink={group && { href: groupHref(group.key), siteCount: group.offers.length }}
                        />
                      </li>
                    );
                  })}
                </ul>
                {hasMore && <div ref={moreRef} className="h-10" aria-hidden="true" />}
              </>
            )}
          </>
        )}
      </main>

      <CompareTray items={trayItems} onRemove={compare.remove} onClear={compare.clear} />
    </div>
  );
}

'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { COMPARE_MAX, COMPARE_MIN, pickCompared, type ComparedDeals } from '@/lib/compare';
import { groupDeals, type ProductGroup } from '@/lib/group';
import { AppHeader, LastUpdated } from '@/components/AppHeader';
import { CompareTable } from '@/components/CompareTable';
import { GroupPriceCard } from '@/components/GroupPriceCard';
import { useCompare, type CompareStore } from '@/components/useCompare';
import { useDeals } from '@/components/useDeals';
import { useNow } from '@/components/useNow';

/** 목록 카드의 "N곳 가격 비교" 링크가 넘겨 주는 묶음 키 (`/compare?group=<키>`). */
const GROUP_PARAM = 'group';

const SECTION_TITLE = 'text-lg font-extrabold tracking-tight text-[#15171A]';
const HINT_BOX = 'rounded-xl bg-[#F7F8FA] px-4 py-6 text-center text-sm text-[#3D4249]';
const TEXT_BUTTON =
  'text-sm font-medium text-[#8A9099] underline underline-offset-2 hover:text-[#15171A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171A]';

interface PickedSectionProps {
  picked: ComparedDeals;
  compare: CompareStore;
  now: Date;
}

/** 비교함: 목록에서 담은 상품을 나란히 본다 (US4-2). */
function PickedSection({ picked, compare, now }: PickedSectionProps) {
  const count = compare.ids.length;
  const removeMissing = () => picked.missingIds.forEach((id) => compare.remove(id));

  return (
    <section aria-labelledby="picked-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="picked-heading" className={SECTION_TITLE}>
          비교함{' '}
          <span className="text-sm font-bold tabular-nums text-[#8A9099]">
            {count}/{COMPARE_MAX}
          </span>
        </h2>
        {count > 0 && (
          <button type="button" onClick={compare.clear} className={TEXT_BUTTON}>
            비우기
          </button>
        )}
      </div>

      {picked.missingIds.length > 0 && (
        <p role="status" className="mt-3 rounded-lg bg-[#FFF4D6] px-3.5 py-2.5 text-sm text-[#5C4400]">
          담아 둔 상품 {picked.missingIds.length}개는 지금 수집된 목록에 없습니다.{' '}
          <button type="button" onClick={removeMissing} className="font-bold underline underline-offset-2">
            비교함에서 빼기
          </button>
        </p>
      )}

      <div className="mt-3">
        {picked.deals.length === 0 ? (
          <div className={HINT_BOX}>
            <p>
              할인 목록에서 카드의 <strong className="font-bold">+ 비교</strong>를 눌러 {COMPARE_MIN}~{COMPARE_MAX}개를 담으면
              여기서 나란히 볼 수 있습니다.
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex h-11 items-center rounded-full bg-[#15171A] px-5 text-sm font-bold text-white"
            >
              할인 목록으로 가기
            </Link>
          </div>
        ) : (
          <>
            <CompareTable deals={picked.deals} now={now} onRemove={compare.remove} />
            {picked.deals.length < COMPARE_MIN && (
              <p className="mt-2 text-xs text-[#8A9099]">
                하나 더 담으면 나란히 비교할 수 있습니다.{' '}
                <Link href="/" className="underline underline-offset-2 hover:text-[#15171A]">
                  할인 목록에서 담기
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

interface GroupsSectionProps {
  groups: readonly ProductGroup[];
  /** 목록에서 고르고 들어온 묶음의 키. 없으면 null */
  focusKey: string | null;
  now: Date;
}

/** 같은 상품의 사이트별 가격 비교 (US4-1). 고르고 들어온 묶음을 맨 앞에 둔다. */
function GroupsSection({ groups, focusKey, now }: GroupsSectionProps) {
  const focused = focusKey === null ? null : (groups.find((group) => group.key === focusKey) ?? null);
  const ordered = focused ? [focused, ...groups.filter((group) => group !== focused)] : groups;

  return (
    <section aria-labelledby="groups-heading">
      <h2 id="groups-heading" className={SECTION_TITLE}>
        여러 사이트에 있는 같은 상품{' '}
        <span className="text-sm font-bold tabular-nums text-[#8A9099]">{groups.length}개</span>
      </h2>
      <p className="mt-1 text-xs leading-5 text-[#8A9099]">
        브랜드와 상품명이 같은 상품을 자동으로 묶었습니다 (색상·사이즈 표기는 무시). 사이트마다 쿠폰 적용 기준이 달라 실제 결제
        금액은 다를 수 있으니 사이트에서 확인하세요.
      </p>

      {focusKey !== null && !focused && (
        <p role="status" className="mt-3 rounded-lg bg-[#EEF0F3] px-3.5 py-2.5 text-sm text-[#3D4249]">
          고른 상품은 지금 한 사이트에서만 진행 중이라 비교할 가격이 없습니다.
        </p>
      )}

      {ordered.length === 0 ? (
        <div className={`${HINT_BOX} mt-3`}>
          <p className="font-bold text-[#15171A]">지금은 여러 사이트에 함께 올라온 같은 상품이 없습니다</p>
          <p className="mt-1 text-[#8A9099]">수집할 때마다 다시 계산합니다.</p>
        </div>
      ) : (
        <ul className="mt-3 grid gap-4 lg:grid-cols-2">
          {ordered.map((group) => (
            <li key={group.key} className="min-w-0">
              <GroupPriceCard group={group} now={now} focused={group === focused} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompareView() {
  const { data, error, reload } = useDeals();
  const compare = useCompare();
  const now = useNow();
  const focusKey = useSearchParams().get(GROUP_PARAM);

  const groups = useMemo(() => (data ? groupDeals(data.deals, now) : []), [data, now]);
  const picked = useMemo(() => (data ? pickCompared(compare.ids, data.deals) : null), [data, compare.ids]);

  return (
    <div className="min-h-screen bg-white text-[#15171A]">
      <AppHeader>{data && <LastUpdated at={data.lastUpdatedAt} now={now} />}</AppHeader>

      <main className="mx-auto max-w-screen-xl px-4 pb-16 pt-5">
        {error && (
          <div role="alert" className="rounded-lg bg-[#FDECEE] px-3.5 py-3 text-sm text-[#9B0C1F]">
            <p>{error}</p>
            <button type="button" onClick={() => void reload()} className="mt-1 font-bold underline underline-offset-2">
              다시 불러오기
            </button>
          </div>
        )}

        {!data && !error && (
          <p className="mt-8 text-sm text-[#8A9099]" aria-busy="true">
            할인 목록을 불러오는 중…
          </p>
        )}

        {data && picked && (
          // 목록에서 묶음을 고르고 들어왔으면 그 가격표가 먼저, 아니면 비교함이 먼저다.
          <div className="flex flex-col gap-10">
            {focusKey !== null && <GroupsSection groups={groups} focusKey={focusKey} now={now} />}
            <PickedSection picked={picked} compare={compare} now={now} />
            {focusKey === null && <GroupsSection groups={groups} focusKey={null} now={now} />}
          </div>
        )}
      </main>
    </div>
  );
}

/** 가격 비교 화면 (T050·T051, US4): 비교함에 담은 상품과, 여러 사이트에 있는 같은 상품의 가격표. */
export default function ComparePage() {
  return (
    // useSearchParams를 쓰는 화면은 Suspense로 감싸야 빌드가 통과한다.
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <CompareView />
    </Suspense>
  );
}

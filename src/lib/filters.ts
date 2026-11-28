// 목록 필터·정렬 순수 함수 (T030) + 선택 기억 (T053).
import { SITE_IDS } from '@/lib/types';
import type { Deal, Gender, SiteId, Theme } from '@/lib/types';
import { isEndingSoon, isExpired } from '@/lib/time';

export type DiscountMin = 0 | 30 | 50 | 70;
export type SortKey = 'discount' | 'ending' | 'price';

export interface FilterState {
  gender: Gender | 'all';
  theme: Theme | 'all';
  /** 0이면 할인율 조건 없음 */
  minDiscount: DiscountMin;
  /** 비어 있으면 모든 사이트 */
  sites: SiteId[];
  /** 마감까지 24시간 이내만 */
  endingToday: boolean;
  /** 종료된 할인도 보기 */
  includeExpired: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  gender: 'all',
  theme: 'all',
  minDiscount: 0,
  sites: [],
  endingToday: false,
  includeExpired: false,
};

export const DEFAULT_SORT: SortKey = 'discount';

export const DISCOUNT_STEPS: DiscountMin[] = [0, 30, 50, 70];
export const SORT_KEYS: SortKey[] = ['discount', 'ending', 'price'];

export const GENDER_ORDER: Gender[] = ['men', 'women', 'unisex', 'unclassified'];
export const THEME_ORDER: Theme[] = [
  'outer', 'top', 'knit', 'bottom', 'dress', 'setup',
  'shoes', 'bag_acc', 'inner_home', 'etc', 'unclassified',
];
/** 등록된 모든 사이트(공용 SITE_IDS 순서). 사이트가 추가되면 필터와 안내 문구에 자동으로 반영된다. */
export const SITE_ORDER: readonly SiteId[] = SITE_IDS;

/** 기본값과 다른 조건이 하나라도 걸려 있는가. */
export function isFiltered(state: FilterState): boolean {
  return (
    state.gender !== 'all' ||
    state.theme !== 'all' ||
    state.minDiscount !== 0 ||
    state.sites.length > 0 ||
    state.endingToday ||
    state.includeExpired
  );
}

/**
 * 조건을 모두 만족하는 Deal만 남긴다 (조건끼리는 AND).
 * - 할인율 조건이 있으면 할인율을 모르는(null) 상품은 제외한다.
 * - 종료된 할인은 `includeExpired`가 켜져 있을 때만 남긴다.
 * - "오늘 마감"은 진행 중이면서 마감까지 24시간 이내인 것만 남긴다.
 */
export function applyFilters(deals: Deal[], state: FilterState, now: Date = new Date()): Deal[] {
  const sites = state.sites.length > 0 ? new Set<SiteId>(state.sites) : null;
  return deals.filter((deal) => {
    if (!state.includeExpired && isExpired(deal.endsAt, now)) return false;
    if (state.gender !== 'all' && deal.gender !== state.gender) return false;
    if (state.theme !== 'all' && deal.theme !== state.theme) return false;
    if (state.minDiscount > 0 && (deal.discountRate === null || deal.discountRate < state.minDiscount)) {
      return false;
    }
    if (sites && !sites.has(deal.siteId)) return false;
    if (state.endingToday && !isEndingSoon(deal.endsAt, now)) return false;
    return true;
  });
}

// ── 종료된 할인 (보여 줄 것이 있는가) ───────────────────────────────────────

/** "종료된 할인 보기"를 고를 수 없을 때의 이유. */
export const NO_EXPIRED_REASON = '종료된 할인이 없습니다';

/**
 * 종료 시각이 지난 할인의 수. 다른 필터와 상관없이 수집된 전체에서 센다.
 * 0이면 "종료된 할인 보기"를 켜도 목록이 달라지지 않는다 (수집할 때마다 끝난 할인은 목록에서 빠진다).
 */
export function countExpired(deals: readonly Deal[], now: Date = new Date()): number {
  return deals.filter((deal) => isExpired(deal.endsAt, now)).length;
}

// ── 사이트 선택지 (어느 사이트에 실제로 할인이 있는가) ────────────────────

export const NO_DEALS_REASON = '수집된 할인이 없습니다';
export const ONLY_EXPIRED_REASON = '진행 중인 할인이 없습니다 (종료된 할인만 있음)';

export interface SiteOption {
  id: SiteId;
  /** 지금 목록에서 볼 수 있는 개수 ("종료된 할인 보기"가 꺼져 있으면 진행 중인 것만) */
  count: number;
  /** 종료된 것까지 포함해 수집된 전체 개수 */
  total: number;
  /** 고를 수 없는 이유. 고를 수 있으면 null */
  emptyReason: string | null;
}

/** 수집된 Deal을 사이트별로 세어 사이트 필터 선택지를 만든다 (9개 사이트, 고정 순서). */
export function buildSiteOptions(deals: readonly Deal[], includeExpired: boolean, now: Date = new Date()): SiteOption[] {
  const totals = new Map<SiteId, number>();
  const active = new Map<SiteId, number>();
  for (const deal of deals) {
    totals.set(deal.siteId, (totals.get(deal.siteId) ?? 0) + 1);
    if (!isExpired(deal.endsAt, now)) active.set(deal.siteId, (active.get(deal.siteId) ?? 0) + 1);
  }
  return SITE_ORDER.map((id) => {
    const total = totals.get(id) ?? 0;
    const count = includeExpired ? total : (active.get(id) ?? 0);
    const emptyReason = count > 0 ? null : total > 0 ? ONLY_EXPIRED_REASON : NO_DEALS_REASON;
    return { id, count, total, emptyReason };
  });
}

/** 할인이 하나라도 수집된 사이트 수. */
export function countCollectedSites(options: readonly SiteOption[]): number {
  return options.filter((option) => option.total > 0).length;
}

/** 판매 중 0 → 품절 1 → 종료 2. 어떤 정렬에서도 이 순서가 먼저다. */
function availabilityRank(deal: Deal, now: Date): number {
  if (isExpired(deal.endsAt, now)) return 2;
  return deal.soldOut ? 1 : 0;
}

function endTime(deal: Deal): number {
  if (!deal.endsAt) return Number.POSITIVE_INFINITY;
  const t = Date.parse(deal.endsAt);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** null은 가장 낮은 할인율로 취급해 뒤로 보낸다. */
function rate(deal: Deal): number {
  return deal.discountRate ?? -1;
}

/**
 * 새 배열로 정렬해 돌려준다 (원본 유지).
 * - discount: 할인율 높은 순 (모르는 값은 뒤)
 * - ending: 마감 임박 순 (종료 시각을 모르면 뒤)
 * - price: 할인가 낮은 순
 * 품절은 판매 중 뒤로, 종료된 할인은 맨 뒤로 보낸다.
 */
export function sortDeals(deals: Deal[], sort: SortKey, now: Date = new Date()): Deal[] {
  const keyed = deals.map((deal) => ({ deal, rank: availabilityRank(deal, now) }));
  keyed.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const x = a.deal;
    const y = b.deal;
    let diff = 0;
    if (sort === 'discount') diff = rate(y) - rate(x);
    else if (sort === 'ending') diff = endTime(x) - endTime(y);
    else diff = x.salePrice - y.salePrice;
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
    // 동점이면 할인율 높은 순 → 가격 낮은 순 → id (항상 같은 순서가 나오도록)
    return rate(y) - rate(x) || x.salePrice - y.salePrice || x.id.localeCompare(y.id);
  });
  return keyed.map((k) => k.deal);
}

// ── 선택 기억 (FR-022, Stretch) ─────────────────────────────────────────────

const STORAGE_KEY = 'bf-deal-tracker:list-view:v1';

export interface SavedView {
  filters: FilterState;
  sort: SortKey;
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** 저장된 값을 검증해 되살린다. 모르는 값은 기본값으로 바꾼다. */
export function parseSavedView(raw: unknown): SavedView {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = (obj.filters && typeof obj.filters === 'object' ? obj.filters : {}) as Record<string, unknown>;
  const sites = Array.isArray(f.sites)
    ? SITE_ORDER.filter((id) => (f.sites as unknown[]).includes(id))
    : [];
  return {
    filters: {
      gender: oneOf<FilterState['gender']>(f.gender, ['all', ...GENDER_ORDER], 'all'),
      theme: oneOf<FilterState['theme']>(f.theme, ['all', ...THEME_ORDER], 'all'),
      minDiscount: oneOf<DiscountMin>(f.minDiscount, DISCOUNT_STEPS, 0),
      sites,
      endingToday: f.endingToday === true,
      includeExpired: f.includeExpired === true,
    },
    sort: oneOf<SortKey>(obj.sort, SORT_KEYS, DEFAULT_SORT),
  };
}

/** 브라우저에 저장된 선택을 읽는다. 없거나 읽을 수 없으면 null. */
export function loadSavedView(): SavedView | null {
  if (typeof window === 'undefined') return null;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    return text ? parseSavedView(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function saveView(view: SavedView): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    // 저장 공간이 막혀 있어도 목록은 계속 동작해야 한다.
  }
}

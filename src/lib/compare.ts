// 비교함 (T051, US4-2): 목록에서 고른 상품 2~4개를 나란히 본다. 여기는 순수 함수만 두고,
// 브라우저 저장은 components/useCompare.ts가 맡는다.
import type { Deal } from '@/lib/types';
import { groupKey } from '@/lib/group';
import { isExpired } from '@/lib/time';

/** 이 수 이상 담아야 비교 화면에서 나란히 볼 수 있다. */
export const COMPARE_MIN = 2;
/** 한 번에 담을 수 있는 최대 개수. */
export const COMPARE_MAX = 4;

export function canCompare(ids: readonly string[]): boolean {
  return ids.length >= COMPARE_MIN;
}

export function isCompareFull(ids: readonly string[]): boolean {
  return ids.length >= COMPARE_MAX;
}

/** 담겨 있으면 빼고, 없으면 맨 뒤에 담는다. 가득 찼으면 더 담지 않는다. 새 배열을 돌려준다. */
export function toggleCompareId(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((existing) => existing !== id);
  if (isCompareFull(ids)) return [...ids];
  return [...ids, id];
}

/** 저장된 값을 검증해 되살린다: 문자열 id만, 중복 없이, 한도까지. */
export function parseCompareIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter((value): value is string => typeof value === 'string' && value !== '');
  return [...new Set(ids)].slice(0, COMPARE_MAX);
}

/**
 * 비교함에 담은 것이 모두 같은 상품(브랜드·상품명이 같음)일 때만, 지금 살 수 있는 것 중 최저가를 돌려준다.
 * 서로 다른 상품이 섞여 있거나, 같은 상품인지 알 수 없거나, 살 수 있는 것이 2개 미만이면 null —
 * 그럴 때 "최저가"라고 표시하면 틀린 말이 된다.
 */
export function lowestSharedPrice(deals: readonly Deal[], now: Date = new Date()): number | null {
  if (deals.length < COMPARE_MIN) return null;
  const key = groupKey(deals[0]);
  if (key === null || deals.some((deal) => groupKey(deal) !== key)) return null;
  const buyable = deals.filter((deal) => !deal.soldOut && !isExpired(deal.endsAt, now));
  if (buyable.length < COMPARE_MIN) return null;
  return Math.min(...buyable.map((deal) => deal.salePrice));
}

export interface ComparedDeals {
  /** 담은 순서대로 찾은 상품 */
  deals: Deal[];
  /** 담아 두었지만 지금 수집된 목록에 없는 상품의 id */
  missingIds: string[];
}

/** 담은 id를 지금 수집된 Deal과 맞춘다. 없는 것은 지어내지 않고 따로 알린다. */
export function pickCompared(ids: readonly string[], deals: readonly Deal[]): ComparedDeals {
  const byId = new Map(deals.map((deal) => [deal.id, deal]));
  const found: Deal[] = [];
  const missingIds: string[] = [];
  for (const id of ids) {
    const deal = byId.get(id);
    if (deal) found.push(deal);
    else missingIds.push(id);
  }
  return { deals: found, missingIds };
}

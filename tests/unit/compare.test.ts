import { describe, expect, it } from 'vitest';
import type { Deal } from '@/lib/types';
import {
  COMPARE_MAX,
  COMPARE_MIN,
  canCompare,
  isCompareFull,
  lowestSharedPrice,
  parseCompareIds,
  pickCompared,
  toggleCompareId,
} from '@/lib/compare';

function deal(id: string): Deal {
  return {
    id,
    siteId: 'musinsa',
    name: `상품 ${id}`,
    brand: '브랜드',
    url: `https://example.com/${id}`,
    imageUrl: null,
    originalPrice: 100000,
    salePrice: 50000,
    discountRate: 50,
    displayedDiscountRate: null,
    endsAt: null,
    endsAtSource: null,
    eventName: null,
    eventUrl: null,
    gender: 'women',
    theme: 'outer',
    soldOut: false,
    crawledAt: '2026-11-27T20:00:00+09:00',
  };
}

describe('비교함 한도', () => {
  it('2개부터 비교할 수 있고 4개까지 담는다 (US4-2)', () => {
    expect(COMPARE_MIN).toBe(2);
    expect(COMPARE_MAX).toBe(4);
  });

  it('canCompare: 2개 이상일 때만 true', () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare(['a'])).toBe(false);
    expect(canCompare(['a', 'b'])).toBe(true);
  });

  it('isCompareFull: 4개면 true', () => {
    expect(isCompareFull(['a', 'b', 'c'])).toBe(false);
    expect(isCompareFull(['a', 'b', 'c', 'd'])).toBe(true);
  });
});

describe('toggleCompareId', () => {
  it('없는 상품은 맨 뒤에 담는다', () => {
    expect(toggleCompareId(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('이미 담은 상품은 뺀다', () => {
    expect(toggleCompareId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('가득 찼으면 더 담지 않는다', () => {
    const full = ['a', 'b', 'c', 'd'];
    expect(toggleCompareId(full, 'e')).toEqual(full);
  });

  it('가득 찼어도 담은 상품은 뺄 수 있다', () => {
    expect(toggleCompareId(['a', 'b', 'c', 'd'], 'a')).toEqual(['b', 'c', 'd']);
  });

  it('받은 배열을 바꾸지 않는다', () => {
    const ids = ['a'];
    toggleCompareId(ids, 'b');
    toggleCompareId(ids, 'a');
    expect(ids).toEqual(['a']);
  });
});

describe('parseCompareIds', () => {
  it('문자열 id 배열을 그대로 되살린다', () => {
    expect(parseCompareIds(['musinsa:1', '29cm:2'])).toEqual(['musinsa:1', '29cm:2']);
  });

  it('배열이 아니면 빈 목록', () => {
    expect(parseCompareIds(null)).toEqual([]);
    expect(parseCompareIds('musinsa:1')).toEqual([]);
    expect(parseCompareIds({ 0: 'musinsa:1' })).toEqual([]);
  });

  it('문자열이 아니거나 빈 값은 버린다', () => {
    expect(parseCompareIds(['a', 1, null, '', { id: 'b' }, 'c'])).toEqual(['a', 'c']);
  });

  it('중복은 한 번만 남긴다', () => {
    expect(parseCompareIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('한도를 넘는 것은 앞에서부터 4개만 남긴다', () => {
    expect(parseCompareIds(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('lowestSharedPrice', () => {
  const NOW = new Date('2026-11-27T21:00:00+09:00');
  const same = (id: string, over: Partial<Deal> = {}): Deal => ({ ...deal(id), name: '울 코트', ...over });

  it('같은 상품끼리 담았으면 판매 중인 것 중 최저가를 돌려준다', () => {
    const deals = [same('a', { salePrice: 90000 }), same('b', { siteId: '29cm', salePrice: 70000, name: '울 코트 블랙' })];
    expect(lowestSharedPrice(deals, NOW)).toBe(70000);
  });

  it('서로 다른 상품이 섞여 있으면 최저가를 따지지 않는다 (null)', () => {
    const deals = [same('a', { salePrice: 90000 }), same('b', { salePrice: 990, name: '립 틴트' })];
    expect(lowestSharedPrice(deals, NOW)).toBeNull();
  });

  it('브랜드를 몰라 같은 상품인지 알 수 없으면 null', () => {
    const deals = [same('a', { brand: null }), same('b', { brand: null })];
    expect(lowestSharedPrice(deals, NOW)).toBeNull();
  });

  it('하나만 담았으면 null', () => {
    expect(lowestSharedPrice([same('a')], NOW)).toBeNull();
  });

  it('품절·종료를 빼고 살 수 있는 것이 2개 미만이면 null', () => {
    const expired = '2026-11-27T20:00:00+09:00';
    expect(lowestSharedPrice([same('a'), same('b', { soldOut: true })], NOW)).toBeNull();
    expect(lowestSharedPrice([same('a'), same('b', { endsAt: expired })], NOW)).toBeNull();
  });

  it('품절인 것이 더 싸도 판매 중인 것 중에서 고른다', () => {
    const deals = [same('a', { salePrice: 90000 }), same('b', { salePrice: 80000 }), same('c', { salePrice: 10000, soldOut: true })];
    expect(lowestSharedPrice(deals, NOW)).toBe(80000);
  });
});

describe('pickCompared', () => {
  it('담은 순서대로 Deal을 찾아 준다', () => {
    const deals = [deal('a'), deal('b'), deal('c')];
    const picked = pickCompared(['c', 'a'], deals);
    expect(picked.deals.map((d) => d.id)).toEqual(['c', 'a']);
    expect(picked.missingIds).toEqual([]);
  });

  it('지금 수집된 목록에 없는 상품은 따로 알려 준다', () => {
    const picked = pickCompared(['a', 'gone', 'b'], [deal('a'), deal('b')]);
    expect(picked.deals.map((d) => d.id)).toEqual(['a', 'b']);
    expect(picked.missingIds).toEqual(['gone']);
  });

  it('아무것도 안 담았으면 둘 다 비어 있다', () => {
    expect(pickCompared([], [deal('a')])).toEqual({ deals: [], missingIds: [] });
  });
});

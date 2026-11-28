import { describe, expect, it } from 'vitest';
import type { Deal } from '@/lib/types';
import {
  DEFAULT_FILTERS,
  applyFilters,
  countExpired,
  isFiltered,
  parseSavedView,
  sortDeals,
  type FilterState,
} from '@/lib/filters';
import { formatRemaining, isEndingSoon, isExpired, isStale } from '@/lib/time';

// 기준 시각: 2026-11-27 21:00 KST
const NOW = new Date('2026-11-27T21:00:00+09:00');

function deal(id: string, over: Partial<Deal> = {}): Deal {
  return {
    id: `musinsa:${id}`,
    siteId: 'musinsa',
    name: `상품 ${id}`,
    brand: '브랜드',
    url: `https://example.com/${id}`,
    imageUrl: null,
    originalPrice: 100000,
    salePrice: 50000,
    discountRate: 50,
    displayedDiscountRate: null,
    endsAt: '2026-11-30T23:59:00+09:00',
    endsAtSource: 'product',
    eventName: null,
    eventUrl: null,
    gender: 'women',
    theme: 'outer',
    soldOut: false,
    crawledAt: '2026-11-27T20:00:00+09:00',
    ...over,
  };
}

function filters(over: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTERS, ...over };
}

function ids(deals: Deal[]): string[] {
  return deals.map((d) => d.id.split(':')[1]);
}

describe('applyFilters', () => {
  const deals = [
    deal('a', { gender: 'women', theme: 'outer', discountRate: 60 }),
    deal('b', { gender: 'women', theme: 'outer', discountRate: 40 }),
    deal('c', { gender: 'men', theme: 'outer', discountRate: 70 }),
    deal('d', { gender: 'women', theme: 'knit', discountRate: 80 }),
    deal('e', { gender: 'unclassified', theme: 'unclassified', discountRate: null }),
    deal('f', { gender: 'women', theme: 'outer', discountRate: 55, siteId: '29cm' }),
    deal('g', { gender: 'women', theme: 'outer', discountRate: 90, endsAt: '2026-11-27T12:00:00+09:00' }),
  ];

  it('기본 상태에서는 종료된 할인만 숨긴다', () => {
    expect(ids(applyFilters(deals, filters(), NOW))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('성별 + 테마 + 할인율을 함께 적용한다 (여성 + 아우터 + 50%+)', () => {
    const state = filters({ gender: 'women', theme: 'outer', minDiscount: 50 });
    expect(ids(applyFilters(deals, state, NOW))).toEqual(['a', 'f']);
  });

  it('할인율 구간 경계값을 포함한다', () => {
    const edge = [deal('x', { discountRate: 30 }), deal('y', { discountRate: 29 })];
    expect(ids(applyFilters(edge, filters({ minDiscount: 30 }), NOW))).toEqual(['x']);
  });

  it('할인율 조건이 있으면 할인율을 모르는 상품은 제외하고, 없으면 남긴다', () => {
    expect(ids(applyFilters(deals, filters({ minDiscount: 30 }), NOW))).not.toContain('e');
    expect(ids(applyFilters(deals, filters(), NOW))).toContain('e');
  });

  it('미분류를 따로 고를 수 있다', () => {
    expect(ids(applyFilters(deals, filters({ gender: 'unclassified' }), NOW))).toEqual(['e']);
    expect(ids(applyFilters(deals, filters({ theme: 'unclassified' }), NOW))).toEqual(['e']);
  });

  it('사이트를 여러 개 고를 수 있고, 비워 두면 전체다', () => {
    expect(ids(applyFilters(deals, filters({ sites: ['29cm'] }), NOW))).toEqual(['f']);
    expect(applyFilters(deals, filters({ sites: ['29cm', 'musinsa'] }), NOW)).toHaveLength(6);
  });

  it('"오늘 마감"은 진행 중이면서 24시간 이내에 끝나는 것만 남긴다', () => {
    const soon = [
      deal('today', { endsAt: '2026-11-27T23:59:00+09:00' }),
      deal('within24h', { endsAt: '2026-11-28T20:00:00+09:00' }),
      deal('later', { endsAt: '2026-11-28T21:01:00+09:00' }),
      deal('unknown', { endsAt: null }),
      deal('past', { endsAt: '2026-11-27T20:59:00+09:00' }),
    ];
    const state = filters({ endingToday: true, includeExpired: true });
    expect(ids(applyFilters(soon, state, NOW))).toEqual(['today', 'within24h']);
  });

  it('"종료된 할인 보기"를 켜면 종료된 것도 남긴다', () => {
    expect(ids(applyFilters(deals, filters({ includeExpired: true }), NOW))).toContain('g');
  });

  it('맞는 상품이 없으면 빈 배열', () => {
    expect(applyFilters(deals, filters({ gender: 'men', theme: 'dress' }), NOW)).toEqual([]);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const before = ids(deals);
    applyFilters(deals, filters({ minDiscount: 70 }), NOW);
    expect(ids(deals)).toEqual(before);
  });
});

describe('sortDeals', () => {
  it('할인율 높은 순 — 모르는 값은 뒤로', () => {
    const list = [
      deal('low', { discountRate: 20 }),
      deal('none', { discountRate: null }),
      deal('high', { discountRate: 75 }),
      deal('mid', { discountRate: 50 }),
    ];
    expect(ids(sortDeals(list, 'discount', NOW))).toEqual(['high', 'mid', 'low', 'none']);
  });

  it('마감 임박 순 — 종료 시각을 모르면 뒤로', () => {
    const list = [
      deal('d3', { endsAt: '2026-11-30T23:59:00+09:00' }),
      deal('unknown', { endsAt: null }),
      deal('d0', { endsAt: '2026-11-27T23:59:00+09:00' }),
      deal('d1', { endsAt: '2026-11-28T13:00:00+09:00' }),
    ];
    expect(ids(sortDeals(list, 'ending', NOW))).toEqual(['d0', 'd1', 'd3', 'unknown']);
  });

  it('가격 낮은 순', () => {
    const list = [
      deal('p3', { salePrice: 89000 }),
      deal('p1', { salePrice: 9900 }),
      deal('p2', { salePrice: 39000 }),
    ];
    expect(ids(sortDeals(list, 'price', NOW))).toEqual(['p1', 'p2', 'p3']);
  });

  it('품절은 판매 중 뒤로, 종료된 할인은 맨 뒤로 보낸다 (모든 정렬 공통)', () => {
    const list = [
      deal('expired', { discountRate: 95, salePrice: 1000, endsAt: '2026-11-27T10:00:00+09:00' }),
      deal('soldout', { discountRate: 90, salePrice: 2000, soldOut: true, endsAt: '2026-11-27T22:00:00+09:00' }),
      deal('open-low', { discountRate: 10, salePrice: 90000 }),
      deal('open-high', { discountRate: 60, salePrice: 40000 }),
    ];
    expect(ids(sortDeals(list, 'discount', NOW))).toEqual(['open-high', 'open-low', 'soldout', 'expired']);
    expect(ids(sortDeals(list, 'price', NOW))).toEqual(['open-high', 'open-low', 'soldout', 'expired']);
    expect(ids(sortDeals(list, 'ending', NOW)).slice(2)).toEqual(['soldout', 'expired']);
  });

  it('동점이면 항상 같은 순서가 나온다', () => {
    const list = [deal('b'), deal('a'), deal('c')];
    expect(ids(sortDeals(list, 'discount', NOW))).toEqual(['a', 'b', 'c']);
    expect(ids(sortDeals([...list].reverse(), 'discount', NOW))).toEqual(['a', 'b', 'c']);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const list = [deal('b', { discountRate: 10 }), deal('a', { discountRate: 90 })];
    sortDeals(list, 'discount', NOW);
    expect(ids(list)).toEqual(['b', 'a']);
  });
});

describe('필터 + 정렬 조합 (quickstart V4)', () => {
  it('여성 + 아우터 + 50%+ + 마감 임박 순', () => {
    const list = [
      deal('late', { discountRate: 70, endsAt: '2026-12-01T23:59:00+09:00' }),
      deal('soon', { discountRate: 50, endsAt: '2026-11-28T09:00:00+09:00' }),
      deal('men', { gender: 'men', discountRate: 80, endsAt: '2026-11-27T22:00:00+09:00' }),
      deal('cheap-rate', { discountRate: 49, endsAt: '2026-11-27T22:00:00+09:00' }),
      deal('mid', { discountRate: 65, endsAt: '2026-11-29T12:00:00+09:00' }),
    ];
    const state = filters({ gender: 'women', theme: 'outer', minDiscount: 50 });
    const result = sortDeals(applyFilters(list, state, NOW), 'ending', NOW);
    expect(ids(result)).toEqual(['soon', 'mid', 'late']);
  });

  it('5,000개도 1초 안에 걸러 정렬한다 (SC-005)', () => {
    const genders = ['men', 'women', 'unisex', 'unclassified'] as const;
    const themes = ['outer', 'top', 'knit', 'bottom'] as const;
    const many = Array.from({ length: 5000 }, (_, i) =>
      deal(String(i), {
        gender: genders[i % 4],
        theme: themes[i % 4],
        discountRate: i % 97 === 0 ? null : i % 90,
        salePrice: 1000 + ((i * 7919) % 200000),
      }),
    );
    const started = performance.now();
    const result = sortDeals(applyFilters(many, filters({ minDiscount: 30 }), NOW), 'price', NOW);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('isFiltered / parseSavedView', () => {
  it('기본 상태는 필터가 없는 것으로 본다', () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered(filters({ sites: ['naver'] }))).toBe(true);
    expect(isFiltered(filters({ endingToday: true }))).toBe(true);
  });

  it('저장된 선택을 그대로 되살린다', () => {
    const saved = {
      filters: filters({ gender: 'men', theme: 'shoes', minDiscount: 50, sites: ['zigzag', 'musinsa'] }),
      sort: 'ending',
    };
    const view = parseSavedView(JSON.parse(JSON.stringify(saved)));
    expect(view.sort).toBe('ending');
    expect(view.filters.gender).toBe('men');
    expect(view.filters.theme).toBe('shoes');
    expect(view.filters.minDiscount).toBe(50);
    expect(view.filters.sites).toEqual(['musinsa', 'zigzag']);
  });

  it('모르는 값은 기본값으로 바꾼다', () => {
    const view = parseSavedView({
      filters: { gender: 'kids', theme: 42, minDiscount: 45, sites: ['coupang', '4910'], endingToday: 'yes' },
      sort: 'random',
    });
    expect(view.filters).toEqual({ ...DEFAULT_FILTERS, sites: ['4910'] });
    expect(view.sort).toBe('discount');
    expect(parseSavedView(null).filters).toEqual(DEFAULT_FILTERS);
  });
});

describe('time', () => {
  it('종료 시각을 모르면 "알 수 없음"', () => {
    expect(formatRemaining(null, NOW)).toEqual({ kind: 'unknown', label: '알 수 없음', urgent: false });
    expect(formatRemaining('날짜 아님', NOW).label).toBe('알 수 없음');
  });

  it('오늘 끝나면 "오늘 HH:mm 마감"', () => {
    expect(formatRemaining('2026-11-27T23:59:00+09:00', NOW)).toEqual({
      kind: 'today',
      label: '오늘 23:59 마감',
      urgent: true,
    });
  });

  it('내일 이후는 "D-n HH:mm" — 24시간 이내면 강조', () => {
    expect(formatRemaining('2026-11-29T13:00:00+09:00', NOW)).toEqual({
      kind: 'later',
      label: 'D-2 13:00',
      urgent: false,
    });
    expect(formatRemaining('2026-11-28T13:00:00+09:00', NOW)).toEqual({
      kind: 'later',
      label: 'D-1 13:00',
      urgent: true,
    });
  });

  it('지났으면 "종료"', () => {
    expect(formatRemaining('2026-11-27T20:59:00+09:00', NOW).label).toBe('종료');
    expect(isExpired('2026-11-27T20:59:00+09:00', NOW)).toBe(true);
    expect(isExpired(null, NOW)).toBe(false);
  });

  it('다른 시간대 표기로 받아도 KST 달력으로 계산한다', () => {
    // 2026-11-27T15:30Z = 11월 28일 00:30 KST → 내일
    expect(formatRemaining('2026-11-27T15:30:00Z', NOW).label).toBe('D-1 00:30');
    expect(isEndingSoon('2026-11-27T15:30:00Z', NOW)).toBe(true);
  });

  it('12시간보다 오래된 데이터를 알아낸다', () => {
    expect(isStale('2026-11-27T08:59:00+09:00', NOW)).toBe(true);
    expect(isStale('2026-11-27T09:01:00+09:00', NOW)).toBe(false);
    expect(isStale(null, NOW)).toBe(false);
  });
});

describe('countExpired ("종료된 할인 보기"가 보여 줄 것이 있는가)', () => {
  it('종료 시각이 지난 할인만 센다', () => {
    const deals = [
      deal('past-1', { endsAt: '2026-11-27T20:59:00+09:00' }),
      deal('past-2', { endsAt: '2026-11-26T23:59:00+09:00' }),
      deal('future', { endsAt: '2026-11-30T23:59:00+09:00' }),
    ];
    expect(countExpired(deals, NOW)).toBe(2);
  });

  it('종료 시각을 모르는 할인은 종료로 치지 않는다', () => {
    expect(countExpired([deal('unknown', { endsAt: null })], NOW)).toBe(0);
  });

  it('지금 막 끝난 할인은 종료로 센다 (목록에서 숨기는 기준과 같다)', () => {
    const justEnded = deal('edge', { endsAt: '2026-11-27T21:00:00+09:00' });
    expect(countExpired([justEnded], NOW)).toBe(1);
    expect(applyFilters([justEnded], DEFAULT_FILTERS, NOW)).toEqual([]);
  });

  it('종료된 것이 없거나 목록이 비면 0', () => {
    expect(countExpired([deal('future')], NOW)).toBe(0);
    expect(countExpired([], NOW)).toBe(0);
  });

  it('다른 필터와 상관없이 수집된 전체에서 센다', () => {
    const deals = [
      deal('men', { gender: 'men', endsAt: '2026-11-27T20:00:00+09:00' }),
      deal('women', { gender: 'women', endsAt: '2026-11-27T20:00:00+09:00' }),
    ];
    expect(countExpired(deals, NOW)).toBe(2);
  });
});

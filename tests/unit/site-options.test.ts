import { describe, expect, it } from 'vitest';
import type { Deal, SiteId } from '@/lib/types';
import { SITE_ORDER, buildSiteOptions, countCollectedSites } from '@/lib/filters';

// 기준 시각: 2026-11-27 21:00 KST
const NOW = new Date('2026-11-27T21:00:00+09:00');
const OPEN = '2026-11-30T23:59:00+09:00';
const PAST = '2026-11-27T12:00:00+09:00';

function deal(siteId: SiteId, id: string, endsAt: string | null = OPEN): Deal {
  return {
    id: `${siteId}:${id}`,
    siteId,
    name: `상품 ${id}`,
    brand: null,
    url: `https://example.com/${id}`,
    imageUrl: null,
    originalPrice: 100000,
    salePrice: 50000,
    discountRate: 50,
    displayedDiscountRate: null,
    endsAt,
    endsAtSource: endsAt ? 'product' : null,
    eventName: null,
    eventUrl: null,
    gender: 'women',
    theme: 'outer',
    soldOut: false,
    crawledAt: '2026-11-27T20:00:00+09:00',
  };
}

const DEALS = [
  deal('musinsa', 'a'),
  deal('musinsa', 'b', null),
  deal('musinsa', 'c', PAST),
  deal('29cm', 'd'),
  deal('wconcept', 'e', PAST),
];

function optionOf(siteId: SiteId, includeExpired: boolean) {
  const found = buildSiteOptions(DEALS, includeExpired, NOW).find((option) => option.id === siteId);
  if (!found) throw new Error(`no option for ${siteId}`);
  return found;
}

describe('buildSiteOptions', () => {
  it('9개 사이트를 고정 순서로 모두 돌려준다', () => {
    expect(buildSiteOptions(DEALS, false, NOW).map((option) => option.id)).toEqual(SITE_ORDER);
    expect(buildSiteOptions([], false, NOW)).toHaveLength(SITE_ORDER.length);
  });

  it('종료된 할인을 숨길 때는 진행 중인 것만 센다 (종료 시각을 모르면 진행 중)', () => {
    expect(optionOf('musinsa', false)).toMatchObject({ count: 2, total: 3, emptyReason: null });
    expect(optionOf('29cm', false)).toMatchObject({ count: 1, total: 1, emptyReason: null });
  });

  it('"종료된 할인 보기"를 켜면 종료된 것까지 센다', () => {
    expect(optionOf('musinsa', true).count).toBe(3);
    expect(optionOf('wconcept', true)).toMatchObject({ count: 1, emptyReason: null });
  });

  it('수집된 할인이 없는 사이트는 고를 수 없고 이유를 알려 준다', () => {
    expect(optionOf('naver', false)).toMatchObject({ count: 0, total: 0, emptyReason: '수집된 할인이 없습니다' });
    expect(optionOf('naver', true).emptyReason).toBe('수집된 할인이 없습니다');
  });

  it('종료된 할인만 있는 사이트는 그 이유를 따로 알려 준다', () => {
    const option = optionOf('wconcept', false);
    expect(option.count).toBe(0);
    expect(option.total).toBe(1);
    expect(option.emptyReason).toBe('진행 중인 할인이 없습니다 (종료된 할인만 있음)');
  });

  it('5,000개도 금방 센다 (SC-005)', () => {
    const many = Array.from({ length: 5000 }, (_, i) => deal(SITE_ORDER[i % 3], String(i), i % 5 === 0 ? PAST : OPEN));
    const started = performance.now();
    const options = buildSiteOptions(many, false, NOW);
    expect(performance.now() - started).toBeLessThan(200);
    expect(options.reduce((sum, option) => sum + option.count, 0)).toBe(4000);
  });
});

describe('countCollectedSites', () => {
  it('할인이 하나라도 수집된 사이트 수 (종료된 것만 있어도 수집된 것으로 본다)', () => {
    expect(countCollectedSites(buildSiteOptions(DEALS, false, NOW))).toBe(3);
    expect(countCollectedSites(buildSiteOptions([], false, NOW))).toBe(0);
  });
});

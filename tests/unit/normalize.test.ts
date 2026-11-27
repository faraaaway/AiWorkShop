import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal, Gender, RawDeal, Theme } from '@/lib/types';
import { GENDERS, THEMES } from '@/lib/types';

/**
 * classify.ts and discount.ts are owned by sibling tasks. They are replaced here so these tests
 * check only what normalize.ts does with them: which arguments it passes and that it stores the
 * results unchanged. The last describe block runs the Musinsa sample through the real modules.
 */
type ClassifyGender = (
  rawGender: string | null | undefined,
  rawCategory: string | null | undefined,
  name: string,
) => Gender;
type ClassifyTheme = (rawCategory: string | null | undefined, name: string) => Theme;
type ComputeDiscountRate = (
  originalPrice: number | null | undefined,
  salePrice: number,
  displayedRate: number | null | undefined,
) => number | null;

const mocks = vi.hoisted(() => ({
  classifyGender: vi.fn<ClassifyGender>(),
  classifyTheme: vi.fn<ClassifyTheme>(),
  computeDiscountRate: vi.fn<ComputeDiscountRate>(),
}));

vi.mock('@/lib/classify', () => ({
  classifyGender: mocks.classifyGender,
  classifyTheme: mocks.classifyTheme,
}));
vi.mock('@/lib/discount', () => ({
  computeDiscountRate: mocks.computeDiscountRate,
}));

import { normalizeDeal, normalizeDeals } from '@/lib/normalize';

const CRAWLED_AT = '2026-11-27T21:00:00+09:00';
const MAX_RATE = 99;
const PERCENT = 100;

/** The rule written in data-model.md "Deal.discountRate", used as the stand-in implementation. */
const referenceDiscountRate: ComputeDiscountRate = (originalPrice, salePrice, displayedRate) => {
  const rate =
    typeof originalPrice === 'number'
      ? Math.floor(((originalPrice - salePrice) * PERCENT) / originalPrice)
      : (displayedRate ?? null);
  return rate !== null && rate >= 0 && rate <= MAX_RATE ? rate : null;
};

/** Real RawDeal captured from the Musinsa adapter. */
const MUSINSA_RAW: RawDeal = {
  siteProductId: '7108774',
  name: '[10주년기획] © 모두의 Comfortemp® 미드웨이트 패딩_5 COLOR',
  brand: '디미트리블랙',
  url: 'https://www.musinsa.com/products/7108774',
  imageUrl:
    'https://image.msscdn.net/images/goods_img/20260819/7108774/7108774_17950559711884_500.jpg',
  originalPrice: 133400,
  salePrice: 69900,
  displayedDiscountRate: 48,
  endsAt: null,
  rawCategory: '아우터',
  rawGender: '남녀공용',
  soldOut: false,
  event: {
    name: '무진장 26 겨울 블랙프라이데이 · 시그니처특가',
    url: 'https://www.musinsa.com/campaign/mujinjangsale/special#signatureItem',
    endsAt: '2026-12-03T00:00:00+09:00',
  },
};

function makeRaw(overrides: Partial<RawDeal> = {}): RawDeal {
  return {
    siteProductId: '1001',
    name: '울 블렌드 코트',
    url: 'https://shop.example.com/products/1001',
    salePrice: 60000,
    ...overrides,
  };
}

/** A value an adapter could only produce by breaking the RawDeal type (bad JSON, bad cast). */
function badRaw(fields: Record<string, unknown>): RawDeal {
  return { ...makeRaw(), ...fields } as unknown as RawDeal;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function expectDeal(deal: Deal | null): Deal {
  expect(deal).not.toBeNull();
  if (deal === null) throw new Error('Deal이 버려졌습니다');
  return deal;
}

beforeEach(() => {
  mocks.classifyGender.mockReset().mockReturnValue('women');
  mocks.classifyTheme.mockReset().mockReturnValue('outer');
  mocks.computeDiscountRate.mockReset().mockImplementation(referenceDiscountRate);
});

describe('normalizeDeal', () => {
  it('turns the real Musinsa RawDeal into a full Deal', () => {
    mocks.classifyGender.mockReturnValue('unisex');

    const deal = normalizeDeal(MUSINSA_RAW, 'musinsa', CRAWLED_AT);

    expect(deal).toEqual({
      id: 'musinsa:7108774',
      siteId: 'musinsa',
      name: '[10주년기획] © 모두의 Comfortemp® 미드웨이트 패딩_5 COLOR',
      brand: '디미트리블랙',
      url: 'https://www.musinsa.com/products/7108774',
      imageUrl:
        'https://image.msscdn.net/images/goods_img/20260819/7108774/7108774_17950559711884_500.jpg',
      originalPrice: 133400,
      salePrice: 69900,
      discountRate: 47,
      displayedDiscountRate: 48,
      endsAt: '2026-12-03T00:00:00+09:00',
      endsAtSource: 'event',
      eventName: '무진장 26 겨울 블랙프라이데이 · 시그니처특가',
      eventUrl: 'https://www.musinsa.com/campaign/mujinjangsale/special#signatureItem',
      gender: 'unisex',
      theme: 'outer',
      soldOut: false,
      crawledAt: CRAWLED_AT,
    } satisfies Deal);
  });

  it('asks the shared functions with the cleaned values', () => {
    normalizeDeal(MUSINSA_RAW, 'musinsa', CRAWLED_AT);

    expect(mocks.computeDiscountRate).toHaveBeenCalledWith(133400, 69900, 48);
    expect(mocks.classifyGender).toHaveBeenCalledWith('남녀공용', '아우터', MUSINSA_RAW.name);
    expect(mocks.classifyTheme).toHaveBeenCalledWith('아우터', MUSINSA_RAW.name);
  });

  it('stores whatever the classifiers and the discount function return', () => {
    mocks.classifyGender.mockReturnValue('unclassified');
    mocks.classifyTheme.mockReturnValue('unclassified');
    mocks.computeDiscountRate.mockReturnValue(null);

    const deal = expectDeal(normalizeDeal(makeRaw({ originalPrice: 100000 }), '29cm', CRAWLED_AT));

    expect(deal.gender).toBe('unclassified');
    expect(deal.theme).toBe('unclassified');
    expect(deal.discountRate).toBeNull();
  });

  it('fills every optional field with null/false when the adapter gave only the required ones', () => {
    const deal = normalizeDeal(makeRaw(), 'zigzag', CRAWLED_AT);

    expect(deal).toEqual({
      id: 'zigzag:1001',
      siteId: 'zigzag',
      name: '울 블렌드 코트',
      brand: null,
      url: 'https://shop.example.com/products/1001',
      imageUrl: null,
      originalPrice: null,
      salePrice: 60000,
      discountRate: null,
      displayedDiscountRate: null,
      endsAt: null,
      endsAtSource: null,
      eventName: null,
      eventUrl: null,
      gender: 'women',
      theme: 'outer',
      soldOut: false,
      crawledAt: CRAWLED_AT,
    } satisfies Deal);
    expect(mocks.computeDiscountRate).toHaveBeenCalledWith(null, 60000, null);
    expect(mocks.classifyGender).toHaveBeenCalledWith(null, null, '울 블렌드 코트');
    expect(mocks.classifyTheme).toHaveBeenCalledWith(null, '울 블렌드 코트');
  });

  it('trims strings and builds the id from the trimmed product id', () => {
    const raw = makeRaw({
      siteProductId: '  A-77 ',
      name: '\t 캐시미어 니트 \n',
      brand: '  브랜드  ',
      url: '  https://shop.example.com/p/A-77 ',
      imageUrl: ' https://img.example.com/a.jpg ',
      rawCategory: '  여성 > 니트 ',
      rawGender: ' 여성 ',
      event: { name: '  블프 특가 ', url: ' https://shop.example.com/event/1 ', endsAt: null },
    });

    const deal = expectDeal(normalizeDeal(raw, 'wconcept', CRAWLED_AT));

    expect(deal.id).toBe('wconcept:A-77');
    expect(deal.name).toBe('캐시미어 니트');
    expect(deal.brand).toBe('브랜드');
    expect(deal.url).toBe('https://shop.example.com/p/A-77');
    expect(deal.imageUrl).toBe('https://img.example.com/a.jpg');
    expect(deal.eventName).toBe('블프 특가');
    expect(deal.eventUrl).toBe('https://shop.example.com/event/1');
    expect(mocks.classifyGender).toHaveBeenCalledWith('여성', '여성 > 니트', '캐시미어 니트');
    expect(mocks.classifyTheme).toHaveBeenCalledWith('여성 > 니트', '캐시미어 니트');
  });

  it('stores blank brand, image, category, gender and event texts as null', () => {
    const raw = makeRaw({
      brand: '   ',
      imageUrl: '',
      rawCategory: ' ',
      rawGender: '',
      event: { name: '  ', url: '', endsAt: null },
    });

    const deal = expectDeal(normalizeDeal(raw, 'ably', CRAWLED_AT));

    expect(deal.brand).toBeNull();
    expect(deal.imageUrl).toBeNull();
    expect(deal.eventName).toBeNull();
    expect(deal.eventUrl).toBeNull();
    expect(mocks.classifyGender).toHaveBeenCalledWith(null, null, '울 블렌드 코트');
  });

  it.each([
    ['blank', '   '],
    ['relative path', '/products/1001'],
    ['protocol-relative', '//shop.example.com/products/1001'],
    ['no scheme', 'shop.example.com/products/1001'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['ftp scheme', 'ftp://shop.example.com/products/1001'],
  ])('drops the deal when url is not an absolute http(s) URL (%s)', (_label, url) => {
    expect(normalizeDeal(makeRaw({ url }), 'musinsa', CRAWLED_AT)).toBeNull();
  });

  it('accepts plain http product URLs', () => {
    const deal = expectDeal(
      normalizeDeal(makeRaw({ url: 'http://shop.example.com/p/1' }), 'posty', CRAWLED_AT),
    );

    expect(deal.url).toBe('http://shop.example.com/p/1');
  });

  it.each([
    ['relative path', '/images/a.jpg'],
    ['protocol-relative', '//img.example.com/a.jpg'],
    ['data URI', 'data:image/png;base64,AAAA'],
  ])('keeps the deal but stores imageUrl null when it is not absolute http(s) (%s)', (_l, imageUrl) => {
    const deal = expectDeal(normalizeDeal(makeRaw({ imageUrl }), 'musinsa', CRAWLED_AT));

    expect(deal.imageUrl).toBeNull();
  });

  it('stores eventUrl null when it is not an absolute http(s) URL but keeps the event name', () => {
    const raw = makeRaw({ event: { name: '블프 특가', url: '/event/1', endsAt: null } });

    const deal = expectDeal(normalizeDeal(raw, 'musinsa', CRAWLED_AT));

    expect(deal.eventName).toBe('블프 특가');
    expect(deal.eventUrl).toBeNull();
  });

  it('rounds prices to whole won before computing the discount', () => {
    const raw = makeRaw({ originalPrice: 99999.6, salePrice: 59999.5, displayedDiscountRate: 40 });

    const deal = expectDeal(normalizeDeal(raw, 'naver', CRAWLED_AT));

    expect(deal.originalPrice).toBe(100000);
    expect(deal.salePrice).toBe(60000);
    expect(mocks.computeDiscountRate).toHaveBeenCalledWith(100000, 60000, 40);
    expect(deal.discountRate).toBe(40);
  });

  it.each([
    ['zero', 0],
    ['negative', -1000],
    ['rounds down to zero', 0.4],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('drops the deal when salePrice is not a positive finite number (%s)', (_label, salePrice) => {
    expect(normalizeDeal(makeRaw({ salePrice }), 'musinsa', CRAWLED_AT)).toBeNull();
  });

  it.each([
    ['price text', '69,900원'],
    ['numeric text', '69900'],
    ['null', null],
    ['undefined', undefined],
  ])('drops the deal when salePrice is not a number (%s)', (_label, salePrice) => {
    expect(normalizeDeal(badRaw({ salePrice }), 'musinsa', CRAWLED_AT)).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('keeps the deal but stores originalPrice null when it is unusable (%s)', (_l, originalPrice) => {
    const raw = makeRaw({ originalPrice, displayedDiscountRate: 30 });

    const deal = expectDeal(normalizeDeal(raw, 'musinsa', CRAWLED_AT));

    expect(deal.originalPrice).toBeNull();
    expect(mocks.computeDiscountRate).toHaveBeenCalledWith(null, 60000, 30);
    expect(deal.discountRate).toBe(30);
  });

  it('stores originalPrice null when it is not a number at all', () => {
    const deal = expectDeal(
      normalizeDeal(badRaw({ originalPrice: '133,400' }), 'musinsa', CRAWLED_AT),
    );

    expect(deal.originalPrice).toBeNull();
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['text', '48%'],
  ])('stores displayedDiscountRate null when it is not a finite number (%s)', (_label, rate) => {
    const deal = expectDeal(
      normalizeDeal(badRaw({ displayedDiscountRate: rate }), 'musinsa', CRAWLED_AT),
    );

    expect(deal.displayedDiscountRate).toBeNull();
    expect(mocks.computeDiscountRate).toHaveBeenCalledWith(null, 60000, null);
  });

  it('keeps a finite displayedDiscountRate exactly as the site showed it', () => {
    const raw = makeRaw({ originalPrice: 100000, displayedDiscountRate: 41 });

    const deal = expectDeal(normalizeDeal(raw, 'musinsa', CRAWLED_AT));

    expect(deal.displayedDiscountRate).toBe(41);
    expect(deal.discountRate).toBe(40);
  });

  it('prefers the product end time and rewrites it to the +09:00 form', () => {
    const raw = makeRaw({
      endsAt: '2026-11-30T14:59:00Z',
      event: {
        name: '블프',
        url: 'https://shop.example.com/event/1',
        endsAt: '2026-12-03T00:00:00+09:00',
      },
    });

    const deal = expectDeal(normalizeDeal(raw, 'musinsa', CRAWLED_AT));

    expect(deal.endsAt).toBe('2026-11-30T23:59:00+09:00');
    expect(deal.endsAtSource).toBe('product');
  });

  it.each([
    ['unreadable text', '11월 말까지'],
    ['blank', '  '],
    ['null', null],
  ])('falls back to the event end time when the product one is %s', (_label, endsAt) => {
    const raw = makeRaw({
      endsAt,
      event: { name: '블프', url: 'https://shop.example.com/event/1', endsAt: '2026-12-02T15:00:00Z' },
    });

    const deal = expectDeal(normalizeDeal(raw, 'musinsa', CRAWLED_AT));

    expect(deal.endsAt).toBe('2026-12-03T00:00:00+09:00');
    expect(deal.endsAtSource).toBe('event');
  });

  it('stores endsAt and endsAtSource null when neither end time can be read', () => {
    const raw = makeRaw({
      endsAt: '곧 종료',
      event: { name: '블프', url: 'https://shop.example.com/event/1', endsAt: '상시' },
    });

    const deal = expectDeal(normalizeDeal(raw, 'musinsa', CRAWLED_AT));

    expect(deal.endsAt).toBeNull();
    expect(deal.endsAtSource).toBeNull();
    expect(deal.eventName).toBe('블프');
  });

  it('does not read a non-string end time as an instant', () => {
    const deal = expectDeal(normalizeDeal(badRaw({ endsAt: 20261130 }), 'musinsa', CRAWLED_AT));

    expect(deal.endsAt).toBeNull();
    expect(deal.endsAtSource).toBeNull();
  });

  it('marks soldOut only when the adapter said exactly true', () => {
    const soldOut = expectDeal(normalizeDeal(makeRaw({ soldOut: true }), 'musinsa', CRAWLED_AT));
    const notSoldOut = expectDeal(normalizeDeal(makeRaw({ soldOut: false }), 'musinsa', CRAWLED_AT));
    const truthyText = expectDeal(normalizeDeal(badRaw({ soldOut: 'true' }), 'musinsa', CRAWLED_AT));

    expect(soldOut.soldOut).toBe(true);
    expect(notSoldOut.soldOut).toBe(false);
    expect(truthyText.soldOut).toBe(false);
  });

  it.each([
    ['blank siteProductId', { siteProductId: '   ' }],
    ['missing siteProductId', { siteProductId: undefined }],
    ['numeric siteProductId', { siteProductId: 7108774 }],
    ['blank name', { name: '' }],
    ['missing name', { name: null }],
    ['missing url', { url: undefined }],
  ])('drops the deal on %s', (_label, fields) => {
    expect(normalizeDeal(badRaw(fields), 'musinsa', CRAWLED_AT)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'deal'],
    ['an empty object', {}],
    ['an array', []],
  ])('returns null instead of throwing when the RawDeal itself is %s', (_label, value) => {
    expect(normalizeDeal(value as unknown as RawDeal, 'musinsa', CRAWLED_AT)).toBeNull();
  });

  it('ignores an event that is not an object', () => {
    const deal = expectDeal(normalizeDeal(badRaw({ event: '블프 특가' }), 'musinsa', CRAWLED_AT));

    expect(deal.eventName).toBeNull();
    expect(deal.eventUrl).toBeNull();
    expect(deal.endsAt).toBeNull();
  });

  it('does not mutate the RawDeal', () => {
    const raw = deepFreeze(structuredClone(MUSINSA_RAW));

    normalizeDeal(raw, 'musinsa', CRAWLED_AT);

    expect(raw).toEqual(MUSINSA_RAW);
  });
});

describe('normalizeDeals', () => {
  it('returns an empty list for an empty input', () => {
    expect(normalizeDeals([], 'musinsa', CRAWLED_AT)).toEqual([]);
  });

  it('drops bad RawDeals and keeps the rest in order', () => {
    const raws = [
      makeRaw({ siteProductId: '1' }),
      makeRaw({ siteProductId: '2', salePrice: 0 }),
      null as unknown as RawDeal,
      makeRaw({ siteProductId: '3', url: '/relative' }),
      makeRaw({ siteProductId: '4' }),
    ];

    const deals = normalizeDeals(raws, 'queenit', CRAWLED_AT);

    expect(deals.map((deal) => deal.id)).toEqual(['queenit:1', 'queenit:4']);
  });

  it('keeps only the lowest salePrice when the same product appears in several events', () => {
    const raws = [
      makeRaw({ siteProductId: '1', salePrice: 70000 }),
      makeRaw({ siteProductId: '2', salePrice: 30000 }),
      makeRaw({
        siteProductId: '1',
        salePrice: 65000,
        event: { name: '타임특가', url: 'https://shop.example.com/event/2', endsAt: null },
      }),
      makeRaw({ siteProductId: '1', salePrice: 68000 }),
    ];

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(deals).toHaveLength(2);
    expect(deals.map((deal) => deal.id)).toEqual(['musinsa:1', 'musinsa:2']);
    expect(deals[0]?.salePrice).toBe(65000);
    expect(deals[0]?.eventName).toBe('타임특가');
  });

  it('keeps the entry that has an end time when duplicate prices tie', () => {
    const raws = [
      makeRaw({ siteProductId: '1', brand: '종료 모름' }),
      makeRaw({ siteProductId: '1', brand: '종료 있음', endsAt: '2026-11-30T23:59:00+09:00' }),
    ];

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.brand).toBe('종료 있음');
    expect(deals[0]?.endsAt).toBe('2026-11-30T23:59:00+09:00');
  });

  it('does not let a later entry without an end time replace a tied one that has it', () => {
    const raws = [
      makeRaw({ siteProductId: '1', brand: '종료 있음', endsAt: '2026-11-30T23:59:00+09:00' }),
      makeRaw({ siteProductId: '1', brand: '종료 모름' }),
    ];

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.brand).toBe('종료 있음');
  });

  it.each([
    ['both have an end time', '2026-11-30T23:59:00+09:00', '2026-12-03T00:00:00+09:00'],
    ['neither has an end time', null, null],
  ])('keeps the first seen entry on a full tie (%s)', (_label, firstEndsAt, secondEndsAt) => {
    const raws = [
      makeRaw({ siteProductId: '1', brand: '첫 번째', endsAt: firstEndsAt }),
      makeRaw({ siteProductId: '1', brand: '두 번째', endsAt: secondEndsAt }),
    ];

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.brand).toBe('첫 번째');
  });

  it('prefers the lower price over having an end time', () => {
    const raws = [
      makeRaw({ siteProductId: '1', salePrice: 60000, endsAt: '2026-11-30T23:59:00+09:00' }),
      makeRaw({ siteProductId: '1', salePrice: 59000 }),
    ];

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.salePrice).toBe(59000);
    expect(deals[0]?.endsAt).toBeNull();
  });

  it('treats product ids that differ only by surrounding spaces as the same product', () => {
    const raws = [
      makeRaw({ siteProductId: ' 1 ', salePrice: 60000 }),
      makeRaw({ siteProductId: '1', salePrice: 50000 }),
    ];

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(deals).toHaveLength(1);
    expect(deals[0]?.salePrice).toBe(50000);
  });

  it('stamps every deal with the site and the crawl time', () => {
    const deals = normalizeDeals(
      [makeRaw({ siteProductId: '1' }), makeRaw({ siteProductId: '2' })],
      '4910',
      CRAWLED_AT,
    );

    expect(deals.map((deal) => deal.siteId)).toEqual(['4910', '4910']);
    expect(deals.map((deal) => deal.crawledAt)).toEqual([CRAWLED_AT, CRAWLED_AT]);
  });

  it('does not mutate the input list or its items', () => {
    const original = [MUSINSA_RAW, makeRaw({ siteProductId: '7108774', salePrice: 1000 })];
    const raws = deepFreeze(structuredClone(original));

    const deals = normalizeDeals(raws, 'musinsa', CRAWLED_AT);

    expect(raws).toEqual(original);
    expect(deals).not.toBe(raws);
  });

  it('returns an empty list instead of throwing when the input is not a list', () => {
    expect(normalizeDeals(null as unknown as RawDeal[], 'musinsa', CRAWLED_AT)).toEqual([]);
  });
});

describe('normalizeDeal with the real discount and classify modules', () => {
  beforeEach(async () => {
    const discount = await vi.importActual<{ computeDiscountRate: ComputeDiscountRate }>(
      '@/lib/discount',
    );
    const classify = await vi.importActual<{
      classifyGender: ClassifyGender;
      classifyTheme: ClassifyTheme;
    }>('@/lib/classify');
    mocks.computeDiscountRate.mockImplementation(discount.computeDiscountRate);
    mocks.classifyGender.mockImplementation(classify.classifyGender);
    mocks.classifyTheme.mockImplementation(classify.classifyTheme);
  });

  it('computes 47% for the Musinsa sample although the site displays 48%', () => {
    const deal = expectDeal(normalizeDeal(MUSINSA_RAW, 'musinsa', CRAWLED_AT));

    expect(deal.discountRate).toBe(47);
    expect(deal.displayedDiscountRate).toBe(48);
    expect(deal.endsAt).toBe('2026-12-03T00:00:00+09:00');
    expect(deal.endsAtSource).toBe('event');
    expect(deal.theme).toBe('outer');
    expect(GENDERS).toContain(deal.gender);
    expect(THEMES).toContain(deal.theme);
  });

  it('classifies an unambiguous women outer product', () => {
    const raw = makeRaw({ rawGender: '여성', rawCategory: '아우터', name: '울 블렌드 코트' });

    const deal = expectDeal(normalizeDeal(raw, 'wconcept', CRAWLED_AT));

    expect(deal.gender).toBe('women');
    expect(deal.theme).toBe('outer');
  });
});

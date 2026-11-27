import { describe, expect, it } from 'vitest';

import { GENDERS, SITE_IDS, THEMES, type Deal, type SiteId } from '@/lib/types';

import sampleDeals from '../../fixtures/sample-deals.json';

// ---------- Fixture facts (documented expectations) ----------

const EXPECTED_COUNT = 40;
/** "Now" of the fixture: every deal was crawled at this moment (KST). */
const CRAWLED_AT = '2026-11-27T21:00:00+09:00';
const TODAY_KST = '2026-11-27';
const TODAY_END = '2026-11-27T23:59:00+09:00';
const EXPIRED_DATES: readonly string[] = ['2026-11-24', '2026-11-25', '2026-11-26'];
const UPCOMING_FIRST_DATE = '2026-11-28';
const UPCOMING_LAST_DATE = '2026-12-06';

const EXPECTED_EXPIRED = 4;
const EXPECTED_ENDING_TODAY = 5;
const EXPECTED_NO_END = 4;
const MIN_UPCOMING = 20;
const EXPECTED_SOLD_OUT = 3;
const EXPECTED_NULL_RATE = 2;
const EXPECTED_NULL_IMAGE = 2;
const MIN_COMPARE_PAIRS = 2;
const MIN_PER_MAIN_SITE = 3;
const MIN_RATE = 10;
const MAX_RATE = 80;
/** "several" deals at or above each headline threshold. */
const MIN_DEALS_PER_THRESHOLD = 3;
const RATE_THRESHOLDS: readonly number[] = [30, 50, 70];
/** Site-displayed rate is shown separately only when it is more than this far off. */
const DISPLAYED_RATE_TOLERANCE = 1;

const MAIN_SITES: readonly SiteId[] = ['musinsa', '29cm', 'zigzag'];

/** The two deals whose site-displayed rate intentionally disagrees with the computed one. */
const DISPLAYED_RATE_MISMATCH_IDS: readonly string[] = ['queenit:8200771', 'wconcept:303998456'];
/** The two deals without a usable discount rate. */
const NULL_RATE_NO_ORIGINAL_ID = 'naver:9540031826';
const NULL_RATE_OUT_OF_RANGE_ID = 'posty:1198450';

const SITE_HOST_SUFFIX: Readonly<Record<SiteId, string>> = {
  musinsa: 'musinsa.com',
  '29cm': '29cm.co.kr',
  wconcept: 'wconcept.co.kr',
  naver: 'naver.com',
  zigzag: 'zigzag.kr',
  ably: 'a-bly.com',
  queenit: 'queenit.kr',
  posty: 'posty.kr',
  '4910': '4910.kr',
};

const DEAL_KEYS: readonly (keyof Deal)[] = [
  'id',
  'siteId',
  'name',
  'brand',
  'url',
  'imageUrl',
  'originalPrice',
  'salePrice',
  'discountRate',
  'displayedDiscountRate',
  'endsAt',
  'endsAtSource',
  'eventName',
  'eventUrl',
  'gender',
  'theme',
  'soldOut',
  'crawledAt',
];

const ISO_KST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/;
const PLACEHOLDER_IMAGE = /^https:\/\/placehold\.co\/600x600\?text=[A-Za-z0-9+]+$/;

// ---------- Helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isOneOf(options: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && options.includes(value);
}

function isDeal(value: unknown): value is Deal {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    isOneOf(SITE_IDS, value.siteId) &&
    typeof value.name === 'string' &&
    isStringOrNull(value.brand) &&
    typeof value.url === 'string' &&
    isStringOrNull(value.imageUrl) &&
    isNumberOrNull(value.originalPrice) &&
    typeof value.salePrice === 'number' &&
    Number.isFinite(value.salePrice) &&
    isNumberOrNull(value.discountRate) &&
    isNumberOrNull(value.displayedDiscountRate) &&
    isStringOrNull(value.endsAt) &&
    (value.endsAtSource === null || isOneOf(['product', 'event'], value.endsAtSource)) &&
    isStringOrNull(value.eventName) &&
    isStringOrNull(value.eventUrl) &&
    isOneOf(GENDERS, value.gender) &&
    isOneOf(THEMES, value.theme) &&
    typeof value.soldOut === 'boolean' &&
    typeof value.crawledAt === 'string'
  );
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function hostMatches(url: string, suffix: string): boolean {
  const { hostname } = new URL(url);
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/** Calendar date in KST; valid because every timestamp carries the +09:00 offset. */
function kstDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Same formula as data-model.md: floor((original - sale) / original * 100). */
function computeRate(originalPrice: number, salePrice: number): number {
  return Math.floor(((originalPrice - salePrice) / originalPrice) * 100);
}

function countBy<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.filter(predicate).length;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

// ---------- Load ----------

const rawDeals: unknown = sampleDeals;
const rawList: readonly unknown[] = Array.isArray(rawDeals) ? rawDeals : [];
const deals: readonly Deal[] = rawList.filter(isDeal);

// ---------- Tests ----------

describe('fixtures/sample-deals.json', () => {
  describe('shape', () => {
    it('is an array of exactly 40 deals', () => {
      expect(Array.isArray(rawDeals)).toBe(true);
      expect(rawList).toHaveLength(EXPECTED_COUNT);
    });

    it('has every Deal field, and no other field, on every object', () => {
      const expectedKeys = sorted(DEAL_KEYS);
      for (const item of rawList) {
        expect(isRecord(item)).toBe(true);
        if (isRecord(item)) {
          expect(sorted(Object.keys(item)), `keys of ${String(item.id)}`).toEqual(expectedKeys);
        }
      }
    });

    it('has the right type and valid enum values in every field', () => {
      const invalidIds = rawList
        .filter((item) => !isDeal(item))
        .map((item) => (isRecord(item) ? String(item.id) : 'non-object'));
      expect(invalidIds).toEqual([]);
      expect(deals).toHaveLength(EXPECTED_COUNT);
    });

    it('uses only enum values from SITE_IDS, GENDERS and THEMES', () => {
      for (const deal of deals) {
        expect(SITE_IDS, deal.id).toContain(deal.siteId);
        expect(GENDERS, deal.id).toContain(deal.gender);
        expect(THEMES, deal.id).toContain(deal.theme);
      }
    });

    it('has non-empty names and brands (brand may be null)', () => {
      for (const deal of deals) {
        expect(deal.name.trim().length, deal.id).toBeGreaterThan(0);
        if (deal.brand !== null) {
          expect(deal.brand.trim().length, deal.id).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('identity', () => {
    it('has unique ids', () => {
      const ids = deals.map((deal) => deal.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('prefixes every id with its siteId followed by a product id', () => {
      for (const deal of deals) {
        const prefix = `${deal.siteId}:`;
        expect(deal.id.startsWith(prefix), deal.id).toBe(true);
        expect(deal.id.length, deal.id).toBeGreaterThan(prefix.length);
      }
    });
  });

  describe('coverage of sites, genders and themes', () => {
    it('contains every site', () => {
      const present = new Set(deals.map((deal) => deal.siteId));
      expect(sorted([...present])).toEqual(sorted(SITE_IDS));
    });

    it('contains at least 3 deals for musinsa, 29cm and zigzag', () => {
      for (const siteId of MAIN_SITES) {
        const count = countBy(deals, (deal) => deal.siteId === siteId);
        expect(count, siteId).toBeGreaterThanOrEqual(MIN_PER_MAIN_SITE);
      }
    });

    it('contains every gender, including unclassified', () => {
      const present = new Set(deals.map((deal) => deal.gender));
      expect(sorted([...present])).toEqual(sorted(GENDERS));
    });

    it('contains every theme, including unclassified', () => {
      const present = new Set(deals.map((deal) => deal.theme));
      expect(sorted([...present])).toEqual(sorted(THEMES));
    });
  });

  describe('prices and discount rates', () => {
    it('has a positive whole-KRW salePrice and a null or positive originalPrice', () => {
      for (const deal of deals) {
        expect(Number.isInteger(deal.salePrice), deal.id).toBe(true);
        expect(deal.salePrice, deal.id).toBeGreaterThan(0);
        if (deal.originalPrice !== null) {
          expect(Number.isInteger(deal.originalPrice), deal.id).toBe(true);
          expect(deal.originalPrice, deal.id).toBeGreaterThan(0);
        }
      }
    });

    it('spreads discountRate over 10..80 as whole percents', () => {
      const rates = deals.flatMap((deal) => (deal.discountRate === null ? [] : [deal.discountRate]));
      for (const rate of rates) {
        expect(Number.isInteger(rate)).toBe(true);
        expect(rate).toBeGreaterThanOrEqual(MIN_RATE);
        expect(rate).toBeLessThanOrEqual(MAX_RATE);
      }
      expect(Math.min(...rates)).toBe(MIN_RATE);
      expect(Math.max(...rates)).toBe(MAX_RATE);
    });

    it('has several deals at or above 30%, 50% and 70%', () => {
      for (const threshold of RATE_THRESHOLDS) {
        const count = countBy(deals, (deal) => deal.discountRate !== null && deal.discountRate >= threshold);
        expect(count, `>= ${threshold}%`).toBeGreaterThanOrEqual(MIN_DEALS_PER_THRESHOLD);
      }
    });

    it('has exactly 2 deals with a null discountRate, one of them without originalPrice', () => {
      const nullRate = deals.filter((deal) => deal.discountRate === null);
      expect(sorted(nullRate.map((deal) => deal.id))).toEqual(
        sorted([NULL_RATE_NO_ORIGINAL_ID, NULL_RATE_OUT_OF_RANGE_ID]),
      );
      expect(nullRate).toHaveLength(EXPECTED_NULL_RATE);

      const withoutOriginal = deals.filter((deal) => deal.originalPrice === null);
      expect(withoutOriginal.map((deal) => deal.id)).toEqual([NULL_RATE_NO_ORIGINAL_ID]);
    });

    it('keeps a null discountRate consistent with the normalize rules', () => {
      for (const deal of deals.filter((item) => item.discountRate === null)) {
        expect(deal.displayedDiscountRate, deal.id).toBeNull();
        if (deal.originalPrice !== null) {
          // A list price below the sale price gives a rate outside 0..99, which is stored as null.
          const computed = computeRate(deal.originalPrice, deal.salePrice);
          expect(computed < 0 || computed > 99, deal.id).toBe(true);
        }
      }
    });

    it('computes discountRate as floor((original - sale) / original * 100) wherever it is set', () => {
      for (const deal of deals.filter((item) => item.discountRate !== null)) {
        expect(deal.originalPrice, deal.id).not.toBeNull();
        if (deal.originalPrice !== null) {
          expect(deal.discountRate, deal.id).toBe(computeRate(deal.originalPrice, deal.salePrice));
        }
      }
    });

    it('has exactly 2 deals whose displayed rate is more than 1%p away from discountRate', () => {
      const mismatched = deals.filter(
        (deal) =>
          deal.discountRate !== null &&
          deal.displayedDiscountRate !== null &&
          Math.abs(deal.displayedDiscountRate - deal.discountRate) > DISPLAYED_RATE_TOLERANCE,
      );
      expect(sorted(mismatched.map((deal) => deal.id))).toEqual(sorted(DISPLAYED_RATE_MISMATCH_IDS));
    });

    it('keeps the displayed rate within 1%p of discountRate for every other deal', () => {
      const others = deals.filter((deal) => !DISPLAYED_RATE_MISMATCH_IDS.includes(deal.id));
      for (const deal of others) {
        if (deal.discountRate !== null && deal.displayedDiscountRate !== null) {
          const gap = Math.abs(deal.displayedDiscountRate - deal.discountRate);
          expect(gap, deal.id).toBeLessThanOrEqual(DISPLAYED_RATE_TOLERANCE);
        }
      }
    });
  });

  describe('sale end times', () => {
    const now = Date.parse(CRAWLED_AT);
    const withEnd = deals.flatMap((deal) => (deal.endsAt === null ? [] : [{ id: deal.id, endsAt: deal.endsAt }]));
    const expired = withEnd.filter((deal) => Date.parse(deal.endsAt) < now);
    const endingToday = withEnd.filter((deal) => kstDate(deal.endsAt) === TODAY_KST);
    const upcoming = withEnd.filter((deal) => kstDate(deal.endsAt) > TODAY_KST);

    it('writes every timestamp as ISO 8601 with the +09:00 offset', () => {
      for (const deal of deals) {
        expect(deal.crawledAt, deal.id).toMatch(ISO_KST);
        expect(Number.isNaN(Date.parse(deal.crawledAt)), deal.id).toBe(false);
        if (deal.endsAt !== null) {
          expect(deal.endsAt, deal.id).toMatch(ISO_KST);
          expect(Number.isNaN(Date.parse(deal.endsAt)), deal.id).toBe(false);
        }
      }
    });

    it('was crawled at 2026-11-27T21:00:00+09:00 for every deal', () => {
      expect(new Set(deals.map((deal) => deal.crawledAt))).toEqual(new Set([CRAWLED_AT]));
    });

    it('has 4 already expired deals that ended on 2026-11-24..26', () => {
      expect(expired).toHaveLength(EXPECTED_EXPIRED);
      for (const deal of expired) {
        expect(EXPIRED_DATES, deal.id).toContain(kstDate(deal.endsAt));
      }
    });

    it('has 5 deals ending today at 23:59 KST', () => {
      expect(endingToday).toHaveLength(EXPECTED_ENDING_TODAY);
      for (const deal of endingToday) {
        expect(deal.endsAt, deal.id).toBe(TODAY_END);
      }
    });

    it('has many deals ending 2026-11-28..2026-12-06', () => {
      expect(upcoming.length).toBeGreaterThanOrEqual(MIN_UPCOMING);
      for (const deal of upcoming) {
        const date = kstDate(deal.endsAt);
        expect(date >= UPCOMING_FIRST_DATE && date <= UPCOMING_LAST_DATE, deal.id).toBe(true);
      }
    });

    it('has 4 deals without an end time', () => {
      const noEnd = deals.filter((deal) => deal.endsAt === null);
      expect(noEnd).toHaveLength(EXPECTED_NO_END);
      for (const deal of noEnd) {
        expect(deal.endsAtSource, deal.id).toBeNull();
      }
    });

    it('places every deal in exactly one end-time bucket', () => {
      const bucketed = expired.length + endingToday.length + upcoming.length + EXPECTED_NO_END;
      expect(bucketed).toBe(EXPECTED_COUNT);
    });

    it('sets endsAtSource exactly when endsAt is set, mixing product and event', () => {
      for (const deal of deals) {
        expect(deal.endsAtSource === null, deal.id).toBe(deal.endsAt === null);
      }
      expect(countBy(deals, (deal) => deal.endsAtSource === 'product')).toBeGreaterThan(0);
      expect(countBy(deals, (deal) => deal.endsAtSource === 'event')).toBeGreaterThan(0);
    });

    it('names the event and links to it for every event-sourced end time', () => {
      for (const deal of deals.filter((item) => item.endsAtSource === 'event')) {
        expect(deal.eventName, deal.id).not.toBeNull();
        expect(deal.eventUrl, deal.id).not.toBeNull();
      }
    });

    it('sets eventName and eventUrl together, with an absolute https eventUrl', () => {
      for (const deal of deals) {
        expect(deal.eventName === null, deal.id).toBe(deal.eventUrl === null);
        if (deal.eventName !== null) {
          expect(deal.eventName.trim().length, deal.id).toBeGreaterThan(0);
        }
        if (deal.eventUrl !== null) {
          expect(isHttpsUrl(deal.eventUrl), deal.id).toBe(true);
          expect(hostMatches(deal.eventUrl, SITE_HOST_SUFFIX[deal.siteId]), deal.id).toBe(true);
        }
      }
    });
  });

  describe('UI states', () => {
    it('has exactly 3 sold-out deals', () => {
      expect(countBy(deals, (deal) => deal.soldOut)).toBe(EXPECTED_SOLD_OUT);
    });

    it('has exactly 2 deals without an image and placeholder images elsewhere', () => {
      expect(countBy(deals, (deal) => deal.imageUrl === null)).toBe(EXPECTED_NULL_IMAGE);
      for (const deal of deals) {
        if (deal.imageUrl !== null) {
          expect(deal.imageUrl, deal.id).toMatch(PLACEHOLDER_IMAGE);
        }
      }
    });

    it('links every deal to an absolute https product URL on its own site', () => {
      for (const deal of deals) {
        expect(isHttpsUrl(deal.url), deal.id).toBe(true);
        expect(hostMatches(deal.url, SITE_HOST_SUFFIX[deal.siteId]), deal.id).toBe(true);
      }
    });
  });

  describe('price comparison pairs', () => {
    it('has at least 2 products sold on two different sites at different sale prices', () => {
      const productKeys = new Set(
        deals.flatMap((deal) => (deal.brand === null ? [] : [`${deal.brand}|${deal.name}`])),
      );
      const comparable = [...productKeys].filter((key) => {
        const group = deals.filter((deal) => deal.brand !== null && `${deal.brand}|${deal.name}` === key);
        const sites = new Set(group.map((deal) => deal.siteId));
        const prices = new Set(group.map((deal) => deal.salePrice));
        return group.length >= 2 && sites.size === group.length && prices.size === group.length;
      });
      expect(comparable.length).toBeGreaterThanOrEqual(MIN_COMPARE_PAIRS);
    });
  });
});

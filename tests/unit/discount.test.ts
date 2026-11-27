import { describe, expect, it } from 'vitest';

import { computeDiscountRate, isDisplayedRateDifferent } from '@/lib/discount';

const MAX_RATE = 99;

describe('computeDiscountRate — original price known', () => {
  it('floors (original - sale) / original to a whole percent', () => {
    expect(computeDiscountRate(100000, 70000, null)).toBe(30);
    expect(computeDiscountRate(59000, 39900, null)).toBe(32); // 32.37...
    expect(computeDiscountRate(30000, 10000, null)).toBe(66); // 66.66...
  });

  it('floors 47.6% to 47 for the real 133400 -> 69900 case even though the site displays 48', () => {
    expect(computeDiscountRate(133400, 69900, 48)).toBe(47);
  });

  it('returns 0 when the sale price equals the original price', () => {
    const rate = computeDiscountRate(50000, 50000, null);

    expect(rate).toBe(0);
    expect(Object.is(rate, -0)).toBe(false);
  });

  it('returns 0 for a discount smaller than 1%', () => {
    expect(computeDiscountRate(100000, 99001, null)).toBe(0);
  });

  it('returns 99 at the upper boundary', () => {
    expect(computeDiscountRate(100, 1, null)).toBe(MAX_RATE);
    expect(computeDiscountRate(100000, 1000, null)).toBe(MAX_RATE);
  });

  it('floors 99.9% to 99 instead of rounding up to 100', () => {
    expect(computeDiscountRate(1000, 1, null)).toBe(MAX_RATE);
    expect(computeDiscountRate(10000000, 1, null)).toBe(MAX_RATE);
  });

  it('is exact for every whole percent (no floating point loss such as 29 -> 28)', () => {
    // Naive `(100 - 71) / 100 * 100` is 28.999999999999996 in IEEE 754.
    expect(computeDiscountRate(100, 71, null)).toBe(29);

    for (let percent = 0; percent <= MAX_RATE; percent += 1) {
      expect(computeDiscountRate(100, 100 - percent, null), `100 -> ${100 - percent}`).toBe(percent);
      expect(computeDiscountRate(10000, 10000 - percent * 100, null), `10000 -> ${10000 - percent * 100}`).toBe(
        percent,
      );
      expect(computeDiscountRate(1900, 1900 - percent * 19, null), `1900 -> ${1900 - percent * 19}`).toBe(percent);
    }
  });

  it('handles tiny prices', () => {
    expect(computeDiscountRate(1, 1, null)).toBe(0);
    expect(computeDiscountRate(2, 1, null)).toBe(50);
    expect(computeDiscountRate(3, 1, null)).toBe(66);
    expect(computeDiscountRate(3, 2, null)).toBe(33);
    expect(computeDiscountRate(10, 1, null)).toBe(90);
  });

  it('returns null when the sale price is higher than the original price', () => {
    expect(computeDiscountRate(10000, 10001, null)).toBeNull();
    expect(computeDiscountRate(10000, 25000, null)).toBeNull();
  });

  it('does not fall back to the displayed rate when the computed rate is out of range', () => {
    expect(computeDiscountRate(10000, 12000, 20)).toBeNull();
  });

  it('prefers the computed rate over the displayed rate', () => {
    expect(computeDiscountRate(100000, 70000, 50)).toBe(30);
  });
});

describe('computeDiscountRate — original price missing', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['zero', 0],
    ['negative', -10000],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('uses the displayed rate when the original price is %s', (_label, originalPrice) => {
    expect(computeDiscountRate(originalPrice, 69900, 48)).toBe(48);
  });

  it('accepts the displayed boundaries 0 and 99', () => {
    expect(computeDiscountRate(null, 69900, 0)).toBe(0);
    expect(computeDiscountRate(null, 69900, MAX_RATE)).toBe(MAX_RATE);
  });

  it('floors a fractional displayed rate', () => {
    expect(computeDiscountRate(null, 69900, 47.6)).toBe(47);
    expect(computeDiscountRate(null, 69900, 99.9)).toBe(MAX_RATE);
    expect(computeDiscountRate(null, 69900, 0.9)).toBe(0);
  });

  it('never returns negative zero for a displayed rate of -0', () => {
    const rate = computeDiscountRate(null, 69900, -0);

    expect(rate).toBe(0);
    expect(Object.is(rate, -0)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['100', 100],
    ['150', 150],
    ['-1', -1],
    ['-0.5', -0.5],
  ])('returns null when the displayed rate is %s', (_label, displayedRate) => {
    expect(computeDiscountRate(null, 69900, displayedRate)).toBeNull();
    expect(computeDiscountRate(undefined, 69900, displayedRate)).toBeNull();
  });

  it('returns null when both the original price and the displayed rate are omitted', () => {
    expect(computeDiscountRate(undefined, 69900, undefined)).toBeNull();
  });
});

describe('computeDiscountRate — invalid sale price', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('returns null when the sale price is %s, with or without an original price', (_label, salePrice) => {
    expect(computeDiscountRate(100000, salePrice, 30)).toBeNull();
    expect(computeDiscountRate(null, salePrice, 30)).toBeNull();
  });
});

describe('isDisplayedRateDifferent', () => {
  it('is false when the rates are equal', () => {
    expect(isDisplayedRateDifferent(30, 30)).toBe(false);
    expect(isDisplayedRateDifferent(0, 0)).toBe(false);
  });

  it('is false when the rates differ by exactly 1 (133400 -> 69900: computed 47, displayed 48)', () => {
    expect(isDisplayedRateDifferent(47, 48)).toBe(false);
    expect(isDisplayedRateDifferent(48, 47)).toBe(false);
  });

  it('is false when the rates differ by less than 1', () => {
    expect(isDisplayedRateDifferent(47, 47.6)).toBe(false);
  });

  it('is true when the rates differ by more than 1 in either direction', () => {
    expect(isDisplayedRateDifferent(47, 49)).toBe(true);
    expect(isDisplayedRateDifferent(49, 47)).toBe(true);
    expect(isDisplayedRateDifferent(47, 48.5)).toBe(true);
    expect(isDisplayedRateDifferent(0, 99)).toBe(true);
  });

  it('is false when either rate is null', () => {
    expect(isDisplayedRateDifferent(null, 48)).toBe(false);
    expect(isDisplayedRateDifferent(47, null)).toBe(false);
    expect(isDisplayedRateDifferent(null, null)).toBe(false);
  });

  it('is false when either rate is not a finite number', () => {
    expect(isDisplayedRateDifferent(Number.NaN, 48)).toBe(false);
    expect(isDisplayedRateDifferent(47, Number.NaN)).toBe(false);
    expect(isDisplayedRateDifferent(47, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isDisplayedRateDifferent(Number.NEGATIVE_INFINITY, 48)).toBe(false);
  });

  it('agrees with computeDiscountRate for the real 133400 -> 69900 product', () => {
    const displayedRate = 48;
    const discountRate = computeDiscountRate(133400, 69900, displayedRate);

    expect(isDisplayedRateDifferent(discountRate, displayedRate)).toBe(false);
  });
});

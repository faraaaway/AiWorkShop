import { describe, expect, it } from 'vitest';

import {
  GENDER_LABELS,
  SITE_LABELS,
  SITE_STATE_LABELS,
  THEME_LABELS,
  UNKNOWN_LABEL,
  formatDiscountRate,
  formatPrice,
} from '@/lib/labels';
import { GENDERS, SITE_IDS, SITE_STATES, THEMES } from '@/lib/types';

function expectLabelForEveryId(ids: readonly string[], labels: Readonly<Record<string, string>>): void {
  for (const id of ids) {
    const label = labels[id];
    expect(typeof label, `label for "${id}"`).toBe('string');
    expect(label.trim().length, `label for "${id}"`).toBeGreaterThan(0);
  }
  expect(Object.keys(labels).sort()).toEqual([...ids].sort());
}

describe('label maps', () => {
  it('has a non-empty label for every site id and no extra keys', () => {
    expectLabelForEveryId(SITE_IDS, SITE_LABELS);
  });

  it('has a non-empty label for every gender and no extra keys', () => {
    expectLabelForEveryId(GENDERS, GENDER_LABELS);
  });

  it('has a non-empty label for every theme and no extra keys', () => {
    expectLabelForEveryId(THEMES, THEME_LABELS);
  });

  it('has a non-empty label for every site state and no extra keys', () => {
    expectLabelForEveryId(SITE_STATES, SITE_STATE_LABELS);
  });

  it('uses the agreed Korean display names for the sites', () => {
    expect(SITE_LABELS).toEqual({
      musinsa: '무신사',
      '29cm': '29CM',
      wconcept: 'W컨셉',
      naver: '네이버쇼핑',
      zigzag: '지그재그',
      ably: '에이블리',
      queenit: '퀸잇',
      posty: '포스티',
      '4910': '4910',
      attrangs: '아뜨랑스',
    });
  });

  it('uses the agreed Korean labels for genders', () => {
    expect(GENDER_LABELS).toEqual({
      men: '남성',
      women: '여성',
      unisex: '공용',
      unclassified: '미분류',
    });
  });

  it('uses the agreed Korean labels for themes', () => {
    expect(THEME_LABELS).toEqual({
      outer: '아우터',
      top: '상의',
      knit: '니트',
      bottom: '하의',
      dress: '원피스·스커트',
      setup: '셋업',
      shoes: '신발',
      bag_acc: '가방·잡화',
      inner_home: '이너·홈웨어',
      etc: '기타',
      unclassified: '미분류',
    });
  });

  it('uses the agreed Korean labels for site states', () => {
    expect(SITE_STATE_LABELS).toEqual({
      ok: '정상',
      failed: '실패',
      suspect_layout: '실패(구조 변경 의심)',
      blocked: '차단됨',
      login_required: '로그인 필요',
      disabled: '꺼짐',
      not_implemented: '준비 중',
      never_run: '미실행',
    });
  });

  it('exposes the unknown label', () => {
    expect(UNKNOWN_LABEL).toBe('알 수 없음');
  });
});

describe('formatPrice', () => {
  it('formats a price with thousands separators and the won suffix', () => {
    expect(formatPrice(129000)).toBe('129,000원');
  });

  it('groups every three digits for large prices', () => {
    expect(formatPrice(1234567)).toBe('1,234,567원');
  });

  it('does not add a separator below one thousand', () => {
    expect(formatPrice(999)).toBe('999원');
  });

  it('formats zero as a real price, not as unknown', () => {
    expect(formatPrice(0)).toBe('0원');
  });

  it('rounds fractional amounts to whole won', () => {
    expect(formatPrice(1999.6)).toBe('2,000원');
  });

  it('returns the unknown label for null', () => {
    expect(formatPrice(null)).toBe(UNKNOWN_LABEL);
  });

  it('returns the unknown label for non-finite numbers', () => {
    expect(formatPrice(Number.NaN)).toBe(UNKNOWN_LABEL);
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe(UNKNOWN_LABEL);
  });
});

describe('formatDiscountRate', () => {
  it('formats a rate with the percent sign', () => {
    expect(formatDiscountRate(45)).toBe('45%');
  });

  it('formats zero as a real rate, not as unknown', () => {
    expect(formatDiscountRate(0)).toBe('0%');
  });

  it('rounds fractional rates to a whole percent', () => {
    expect(formatDiscountRate(44.6)).toBe('45%');
  });

  it('returns the unknown label for null', () => {
    expect(formatDiscountRate(null)).toBe(UNKNOWN_LABEL);
  });

  it('returns the unknown label for non-finite numbers', () => {
    expect(formatDiscountRate(Number.NaN)).toBe(UNKNOWN_LABEL);
  });
});

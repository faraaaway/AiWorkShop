/**
 * Korean display labels and value formatters shared by the UI and the API layer.
 * Every label map is keyed by the enumerations in `@/lib/types`, so adding an id
 * there without a label here is a compile error.
 */
import type { Gender, SiteId, SiteState, Theme } from '@/lib/types';

/** Shown wherever a value could not be read from the site. Never guess a value instead. */
export const UNKNOWN_LABEL = '알 수 없음';

export const SITE_LABELS: Readonly<Record<SiteId, string>> = {
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
};

export const GENDER_LABELS: Readonly<Record<Gender, string>> = {
  men: '남성',
  women: '여성',
  unisex: '공용',
  unclassified: '미분류',
};

export const THEME_LABELS: Readonly<Record<Theme, string>> = {
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
};

export const SITE_STATE_LABELS: Readonly<Record<SiteState, string>> = {
  ok: '정상',
  failed: '실패',
  suspect_layout: '실패(구조 변경 의심)',
  blocked: '차단됨',
  login_required: '로그인 필요',
  disabled: '꺼짐',
  not_implemented: '준비 중',
  never_run: '미실행',
};

const PRICE_SUFFIX = '원';
const PERCENT_SUFFIX = '%';
const THOUSANDS_SEPARATOR = ',';
/** Matches every position that is followed by a multiple of three digits. */
const THOUSANDS_BOUNDARY = /\B(?=(\d{3})+(?!\d))/g;

function isKnownNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

/** Groups digits by hand so the output does not depend on the runtime's ICU data. */
function groupThousands(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded)).replace(THOUSANDS_BOUNDARY, THOUSANDS_SEPARATOR);
  return `${sign}${digits}`;
}

/** `129000` -> `'129,000원'`; `null` (or a non-finite number) -> `UNKNOWN_LABEL`. */
export function formatPrice(value: number | null): string {
  if (!isKnownNumber(value)) {
    return UNKNOWN_LABEL;
  }
  return `${groupThousands(value)}${PRICE_SUFFIX}`;
}

/** `45` -> `'45%'`; `null` (or a non-finite number) -> `UNKNOWN_LABEL`. */
export function formatDiscountRate(value: number | null): string {
  if (!isKnownNumber(value)) {
    return UNKNOWN_LABEL;
  }
  return `${Math.round(value)}${PERCENT_SUFFIX}`;
}

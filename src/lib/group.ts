// 같은 상품 묶기 (T049, FR-013·FR-019 — Stretch). 저장하지 않고 화면이 요청할 때 계산한다.
// 규칙: specs/001-bf-deal-tracker/data-model.md "Stretch: ProductGroup".
import { SITE_IDS } from '@/lib/types';
import type { Deal, SiteId } from '@/lib/types';
import { isExpired } from '@/lib/time';

/** 묶음이 되려면 같은 키가 이 수 이상의 사이트에 있어야 한다. */
const MIN_SITES = 2;
const KEY_SEPARATOR = '|';

/** 글자·숫자가 아닌 것(공백, 특수문자, 이모지)은 모두 낱말 경계로 본다. */
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/u;
const DIGITS_ONLY = /^\d+$/;
/** `6color`, `7컬러`처럼 붙여 쓴 색상 개수 */
const COLOR_COUNT_TOKEN = /^\d+(?:colors?|colours?|컬러|색상)$/;

// 낱말 하나가 통째로 일치할 때만 지운다 ("블랙진", "redwing"은 그대로 둔다).
const COLOR_WORDS: ReadonlySet<string> = new Set([
  '블랙', '검정', '화이트', '흰색', '아이보리', '크림', '오트밀', '베이지', '브라운', '카멜', '그레이', '회색',
  '멜란지', '차콜', '네이비', '남색', '블루', '스카이블루', '소라', '카키', '올리브', '그린', '민트', '레드',
  '버건디', '와인', '핑크', '퍼플', '라벤더', '옐로우', '오렌지', '실버', '골드',
  'black', 'white', 'ivory', 'cream', 'oatmeal', 'beige', 'brown', 'camel', 'gray', 'grey', 'melange',
  'charcoal', 'navy', 'blue', 'skyblue', 'khaki', 'olive', 'green', 'mint', 'red', 'burgundy', 'wine',
  'pink', 'purple', 'lavender', 'yellow', 'orange', 'silver', 'gold',
]);
/** 색상 바로 앞에 있을 때만 색상 표기로 본다 ("라이트 다운 자켓"의 라이트는 상품명). */
const SHADE_WORDS: ReadonlySet<string> = new Set(['다크', '라이트', '딥', '페일', 'dark', 'light', 'deep', 'pale']);
const SIZE_WORDS: ReadonlySet<string> = new Set([
  'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl', 'free', 'f', 'os', 'onesize',
  '프리', '프리사이즈', '원사이즈',
]);
const COLOR_COUNT_WORDS: ReadonlySet<string> = new Set(['color', 'colors', 'colour', 'colours', '컬러', '색상']);

/** 한 사이트의 가격 한 줄. */
export interface GroupOffer {
  /** 그 사이트에서 이 상품으로 묶인 것 중 가장 싼 것 (판매 중인 것 우선) */
  deal: Deal;
  /**
   * 판매 중이면서 묶음 안에서 가장 싼가 (같은 값이면 여러 곳이 true).
   * 판매 중인 곳이 한 곳뿐이면 비교할 값이 없으므로 어디에도 달지 않는다.
   */
  isLowest: boolean;
  /** 이 사이트에서 색상·사이즈만 달라 하나로 합친 상품 수 */
  variantCount: number;
}

/** 2개 사이트 이상에서 파는 같은 상품. */
export interface ProductGroup {
  /** `정규화한 브랜드|정규화한 상품명` */
  key: string;
  /** 화면에 보일 브랜드·상품명 (가장 앞선 사이트의 표기 그대로) */
  brand: string;
  name: string;
  imageUrl: string | null;
  /** 사이트당 한 줄. 판매 중인 것 먼저, 그 안에서 싼 순서 */
  offers: GroupOffer[];
  /** 판매 중인 것 중 최저가. 모두 품절이면 품절 포함 최저가 */
  minSalePrice: number;
  /** minSalePrice와 같은 기준의 최고가 */
  maxSalePrice: number;
  /** maxSalePrice − minSalePrice */
  priceGap: number;
  /** 지금 판매 중(품절 아님)인 사이트 수 */
  onSaleCount: number;
  /** 묶음에 속한 모든 Deal의 id (사이트별 대표가 아닌 것도 포함) */
  memberIds: string[];
}

function tokenize(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().split(NOT_LETTER_OR_DIGIT).filter((token) => token !== '');
}

/** 색상·사이즈·색상 개수 표기인가. 앞뒤 낱말을 봐야 하는 것이 있어 위치로 받는다. */
function isNoiseAt(tokens: readonly string[], index: number): boolean {
  const token = tokens[index];
  if (COLOR_WORDS.has(token) || SIZE_WORDS.has(token)) return true;
  if (COLOR_COUNT_WORDS.has(token) || COLOR_COUNT_TOKEN.test(token)) return true;
  const next = tokens[index + 1];
  if (next === undefined) return false;
  if (SHADE_WORDS.has(token) && COLOR_WORDS.has(next)) return true;
  // "5 color"의 5. 뒤에 색상 개수 낱말이 없으면 모델 번호일 수 있으니 남긴다.
  return DIGITS_ONLY.test(token) && COLOR_COUNT_WORDS.has(next);
}

function dropNoise(tokens: readonly string[]): string[] {
  return tokens.filter((_, index) => !isNoiseAt(tokens, index));
}

/** 상품명이 브랜드명으로 시작하면 그 부분을 뺀다 (일부 사이트는 상품명 앞에 브랜드를 붙인다). */
function dropLeadingBrand(nameTokens: readonly string[], brandTokens: readonly string[]): readonly string[] {
  const startsWithBrand =
    brandTokens.length > 0 && brandTokens.every((token, index) => nameTokens[index] === token);
  return startsWithBrand ? nameTokens.slice(brandTokens.length) : nameTokens;
}

/** 브랜드 비교용: 소문자, 공백·특수문자 제거. 모르면 빈 문자열. */
export function normalizeBrand(brand: string | null): string {
  return tokenize(brand ?? '').join('');
}

/** 상품명 비교용: 소문자, 공백·특수문자·색상·사이즈 표기 제거. 모델 번호 같은 숫자는 남긴다. */
export function normalizeProductName(name: string): string {
  return dropNoise(tokenize(name)).join('');
}

/**
 * 같은 상품인지 가르는 키. 브랜드를 모르거나 정규화한 상품명이 비면 null — 그런 상품은 묶지 않는다
 * (상품명만으로 묶으면 다른 상품이 한데 묶인다).
 */
export function groupKey(deal: Pick<Deal, 'brand' | 'name'>): string | null {
  const brandTokens = tokenize(deal.brand ?? '');
  if (brandTokens.length === 0) return null;
  const name = dropNoise(dropLeadingBrand(tokenize(deal.name), brandTokens)).join('');
  if (name === '') return null;
  return `${brandTokens.join('')}${KEY_SEPARATOR}${name}`;
}

function siteRank(siteId: SiteId): number {
  return SITE_IDS.indexOf(siteId);
}

/** 판매 중 먼저 → 싼 순 → 사이트 고정 순서 → id (항상 같은 순서가 나오도록). */
function compareDeals(a: Deal, b: Deal): number {
  return (
    Number(a.soldOut) - Number(b.soldOut) ||
    a.salePrice - b.salePrice ||
    siteRank(a.siteId) - siteRank(b.siteId) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function bestPerSite(members: readonly Deal[]): { deal: Deal; variantCount: number }[] {
  const bySite = new Map<SiteId, Deal[]>();
  for (const deal of members) {
    bySite.set(deal.siteId, [...(bySite.get(deal.siteId) ?? []), deal]);
  }
  return [...bySite.values()]
    .map((deals) => ({ deal: [...deals].sort(compareDeals)[0], variantCount: deals.length }))
    .sort((a, b) => compareDeals(a.deal, b.deal));
}

function buildGroup(key: string, members: readonly Deal[]): ProductGroup | null {
  const perSite = bestPerSite(members);
  if (perSite.length < MIN_SITES) return null;

  const onSale = perSite.filter((entry) => !entry.deal.soldOut);
  const prices = (onSale.length > 0 ? onSale : perSite).map((entry) => entry.deal.salePrice);
  const minSalePrice = Math.min(...prices);
  const maxSalePrice = Math.max(...prices);
  const first = perSite[0].deal;

  return {
    key,
    brand: first.brand ?? '',
    name: first.name,
    imageUrl: perSite.find((entry) => entry.deal.imageUrl !== null)?.deal.imageUrl ?? null,
    offers: perSite.map((entry) => ({
      ...entry,
      isLowest: onSale.length >= MIN_SITES && !entry.deal.soldOut && entry.deal.salePrice === minSalePrice,
    })),
    minSalePrice,
    maxSalePrice,
    priceGap: maxSalePrice - minSalePrice,
    onSaleCount: onSale.length,
    memberIds: members.map((deal) => deal.id),
  };
}

/** 가격 차이가 큰 묶음 먼저 → 싼 묶음 → 키. */
function compareGroups(a: ProductGroup, b: ProductGroup): number {
  return (
    b.priceGap - a.priceGap ||
    a.minSalePrice - b.minSalePrice ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/**
 * 브랜드와 상품명이 같은 상품을 사이트를 넘어 묶는다. 2개 사이트 이상에 있는 것만 돌려준다.
 * 종료된 할인은 뺀다 (지금 살 수 없는 값을 최저가로 보여 주지 않는다). 받은 배열은 바꾸지 않는다.
 */
export function groupDeals(deals: readonly Deal[], now: Date = new Date()): ProductGroup[] {
  const buckets = new Map<string, Deal[]>();
  for (const deal of deals) {
    if (isExpired(deal.endsAt, now)) continue;
    const key = groupKey(deal);
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(deal);
    else buckets.set(key, [deal]);
  }

  const groups: ProductGroup[] = [];
  for (const [key, members] of buckets) {
    const group = buildGroup(key, members);
    if (group) groups.push(group);
  }
  return groups.sort(compareGroups);
}

/** 상품 id → 그 상품이 속한 묶음. 목록 카드에 "가격 비교" 링크를 달 때 쓴다. */
export function indexGroupsByDealId(groups: readonly ProductGroup[]): Map<string, ProductGroup> {
  const index = new Map<string, ProductGroup>();
  for (const group of groups) {
    for (const id of group.memberIds) index.set(id, group);
  }
  return index;
}

import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';

/**
 * 29CM — 29 DAY(이구데이) 캠페인.
 *
 * 캠페인 페이지는 Framer로 만든 화면이라 HTML에 기획전 번호가 없다. 화면이 부르는 JSON API를 직접 읽는다.
 *   1) collections?collectionIds=<id,…>                          → 기획전 제목·기간, 카테고리 그룹 목록
 *   2) keyword-collections/<id>/product-groups/<groupId>/products → 상품 목록 (한 번에 최대 100개)
 * 원본 예시는 fixtures/sites/29cm/ 참고.
 *
 * 기획전 번호는 API로 찾을 수 없어 아래 CAMPAIGN에 직접 적는다.
 * 캠페인 페이지가 바뀌면(예: 11-29 본행사 오픈) 브라우저 개발자도구 Network 탭에서
 * `collections?collectionIds=` 요청을 찾아 번호를 고친다.
 */
const CAMPAIGN = {
  name: '29 DAY',
  url: 'https://www.29cm.co.kr/content/campaign/2026/11/29-day/teasing',
  collectionIds: [30759],
};

const API = 'https://content-api.29cm.co.kr/api/v4/framers/proxy/content-api/api';
const PRODUCT_PAGE = 'https://www.29cm.co.kr/products/';
const ALL_GROUP_TITLE = '전체';
const PAGE_SIZE = 100;
const MAX_PAGES_PER_GROUP = 3;

type Json = Record<string, unknown>;
type DealEvent = NonNullable<RawDeal['event']>;

export interface Cm29Collection {
  id: number;
  title: string;
  endsAt: string | null;
  groups: { id: number; title: string }[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** 129000, "129,000원" → 129000. 읽지 못하면 null */
function toWon(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const digits = v.replace(/[^\d]/g, '');
  return digits === '' ? null : Number(digits);
}

/** API 응답 `{ result, data }`에서 data를 꺼낸다. 실패 응답이면 null */
function unwrap(raw: unknown): unknown {
  let body = raw;
  if (typeof raw === 'string') {
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(body) || body.result !== 'SUCCESS') return null;
  return body.data ?? null;
}

/** "여성의류 > 아우터 > 무스탕" — 상품의 첫 번째(대표) 카테고리 */
function categoryPath(categories: unknown): string | null {
  const first = list(categories)[0];
  if (!first) return null;
  const names = [first.largeName, first.mediumName, first.smallName].map(str).filter((n): n is string => n !== null);
  return names.length > 0 ? names.join(' > ') : null;
}

/** collections 응답 → 기획전 목록 */
export function parse29cmCollections(raw: unknown): Cm29Collection[] {
  const data = unwrap(raw);
  const collections: Cm29Collection[] = [];
  for (const c of list(data)) {
    const id = num(c.collectionId);
    const title = str(c.title);
    if (id === null || !title) continue;
    const groups = list(c.productGroupList).flatMap((g) => {
      const groupId = num(g.collectionProductGroupId);
      const groupTitle = str(g.title);
      return groupId !== null && groupTitle ? [{ id: groupId, title: groupTitle }] : [];
    });
    collections.push({ id, title, endsAt: str(c.displayEndAt), groups });
  }
  return collections;
}

/**
 * products 응답 → RawDeal[].
 * - salePrice·displayedDiscountRate는 목록과 상품 페이지가 보여 주는 값(`lastSalePrice`·`lastSalePercent`, 쿠폰 포함).
 * - 성별 필드는 따로 없다. "여성의류" 같은 대분류가 rawCategory 맨 앞에 들어 있다.
 * - 상품별 종료 시각은 없어 endsAt은 null (기획전 종료 시각은 event.endsAt).
 */
export function parse29cm(raw: unknown, context: { event?: DealEvent | null } = {}): RawDeal[] {
  const data = unwrap(raw);
  if (!isObj(data)) return [];

  const deals: RawDeal[] = [];
  for (const p of list(data.resultList)) {
    const productId = num(p.productId);
    const name = str(p.productName);
    const saleInfo = isObj(p.saleInfo) ? p.saleInfo : {};
    const salePrice = toWon(p.lastSalePrice) ?? toWon(saleInfo.totalSellPrice);
    if (productId === null || !name || salePrice === null) continue;

    deals.push({
      siteProductId: String(productId),
      name,
      brand: isObj(p.frontBrand) ? str(p.frontBrand.nameKor) : null,
      url: `${PRODUCT_PAGE}${productId}`,
      imageUrl: str(p.imageUrl),
      originalPrice: toWon(p.consumerPrice),
      salePrice,
      displayedDiscountRate: num(p.lastSalePercent) ?? num(saleInfo.totalSaleRate),
      endsAt: null,
      rawCategory: categoryPath(p.frontCategories),
      rawGender: null,
      soldOut: p.soldOut === true,
      event: context.event ?? null,
    });
  }
  return deals;
}

/** products 응답에 다음 페이지가 있는지 */
export function has29cmNextPage(raw: unknown): boolean {
  const data = unwrap(raw);
  return isObj(data) && data.hasNext === true;
}

async function crawl(ctx: CrawlContext): Promise<RawDeal[]> {
  let used = 0;
  const canRequest = () => used < cm29.maxRequests && !ctx.signal.aborted;
  const getJson = (url: string) => {
    used += 1;
    return ctx.fetchJson(url);
  };

  // 1) 행사 목록
  const collections = parse29cmCollections(
    await getJson(`${API}/v4/collections?collectionIds=${CAMPAIGN.collectionIds.join(',')}`),
  );
  if (collections.length === 0) {
    ctx.log('29CM: 기획전 정보를 읽지 못함');
    return [];
  }

  // 2) 기획전의 카테고리 그룹마다 상품 목록
  const deals: RawDeal[] = [];
  for (const collection of collections) {
    const event: DealEvent = {
      name: `${CAMPAIGN.name} · ${collection.title}`,
      url: CAMPAIGN.url,
      endsAt: collection.endsAt,
    };
    // "전체"는 다른 그룹과 상품이 겹치므로, 다른 그룹이 있으면 건너뛴다.
    const categoryGroups = collection.groups.filter((g) => g.title !== ALL_GROUP_TITLE);
    const groups = categoryGroups.length > 0 ? categoryGroups : collection.groups;

    for (const group of groups) {
      let count = 0;
      for (let page = 0; page < MAX_PAGES_PER_GROUP && canRequest(); page += 1) {
        const json = await getJson(
          `${API}/v5/keyword-collections/${collection.id}/product-groups/${group.id}/products?sort=NEW&page=${page}&size=${PAGE_SIZE}`,
        );
        const found = parse29cm(json, { event });
        deals.push(...found);
        count += found.length;
        if (!has29cmNextPage(json)) break;
      }
      ctx.log(`29CM: ${collection.title} / ${group.title} ${count}개`);
    }
  }
  return deals;
}

export const cm29: SiteAdapter = {
  id: '29cm',
  displayName: '29CM',
  homeUrl: 'https://www.29cm.co.kr',
  // content-api.29cm.co.kr JSON은 stealth 없이 응답하고, robots.txt도 허용한다(2026-11-27 확인).
  stealth: false,
  obeyRobots: true,
  maxRequests: 30,
  crawl,
};

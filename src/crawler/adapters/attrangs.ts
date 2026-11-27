import * as cheerio from 'cheerio';
import type { CrawlContext, FetchHtmlOptions, RawDeal, SiteAdapter, SiteId } from '@/lib/types';

/**
 * 아뜨랑스 (attrangs.co.kr) — "블프특가" 기획전. Owner: Crawl C (T058).
 *
 * 렌더링(`--dump html`)은 30초 안에 끝나지 않아, 원본 HTML만 받아 cheerio로 읽는다.
 *   1) 첫 화면            → 메뉴의 "블프특가" 링크 = 행사 페이지 (`/shop/list.php?cate=<번호>`)
 *   2) 행사 페이지        → 원본 HTML에는 BEST 영역 상품 64개만 들어 있다
 *   3) 행사 페이지가 스크롤할 때 부르는 주소
 *      `/shop/list.php?mode=loadHTML&page=<n>&limit=<개수>&cate=<번호>` → 상품 `<li>` 조각.
 *      목록이 끝나면 빈 응답이 온다. (2026-11-27 확인: limit=48이 그대로 적용되고 10번째 페이지가 비어 있었다)
 * 세 주소 모두 robots.txt에서 허용된다. 원본 예시는 fixtures/sites/attrangs/ 참고.
 *
 * 사이트가 주지 않아 비워 두는 값:
 * - endsAt / event.endsAt: 목록·행사 페이지 어디에도 행사 기간이 없다.
 * - brand: 상품 칸의 `.point`("아르떼", "올데이,다다이득" 등)는 자체제작 라인·태그 묶음이라 브랜드로 쓰지 않는다.
 * - rawCategory: 목록에 상품 분류가 없다(상품명으로 Core가 분류).
 * 아뜨랑스는 여성 의류 전용 쇼핑몰이고 상품별 성별 표기가 없어서 rawGender는 모두 '여성'으로 넣는다.
 */

const SITE_ID: SiteId = 'attrangs';
const RAW_HTML: FetchHtmlOptions = { raw: true };

const ORIGIN = 'https://attrangs.co.kr';
const HOME_URL = `${ORIGIN}/`;
const PRODUCT_PAGE = `${ORIGIN}/shop/view.php?index_no=`;

/** 첫 화면 메뉴에서 행사 링크를 알아보는 문구 */
const EVENT_LINK_TEXT = /블프|블랙\s*프라이데이|black\s*friday/i;
/** 사이트 화면은 16개씩 부르지만, 요청 횟수를 줄이려고 한 번에 48개씩 받는다. */
const PAGE_SIZE = 48;
/** 목록 끝(빈 응답)을 못 만나도 여기서 멈춘다. */
const MAX_PAGES = 12;
const SITE_GENDER = '여성';

type DealEvent = NonNullable<RawDeal['event']>;

export interface AttrangsEvent {
  /** 메뉴에 적힌 행사 이름 (예: "블프특가🧨") */
  name: string;
  /** 행사 페이지 절대 URL */
  url: string;
  /** 행사 카테고리 번호 (`cate`) */
  cate: string;
}

const clean = (text: string | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** "49,900", "49,900원" → 49900. 숫자가 없으면 null */
function toWon(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits === '' ? null : Number(digits);
}

function toAbsoluteUrl(href: string | undefined): string | null {
  const value = clean(href);
  if (value === '') return null;
  try {
    return new URL(value, HOME_URL).href;
  } catch {
    return null;
  }
}

/** 행사 페이지에서 스크롤할 때 불러오는 상품 조각 주소 */
export function attrangsMoreUrl(cate: string, page: number): string {
  return `${ORIGIN}/shop/list.php?mode=loadHTML&page=${page}&limit=${PAGE_SIZE}&cate=${encodeURIComponent(cate)}`;
}

/** 첫 화면 HTML → 메뉴의 블프 행사 링크. 없으면 null */
export function parseAttrangsEvent(html: string): AttrangsEvent | null {
  if (typeof html !== 'string' || html.trim() === '') return null;
  const $ = cheerio.load(html);
  for (const anchor of $('a[href*="/shop/list.php"]').toArray()) {
    const name = clean($(anchor).text());
    if (!EVENT_LINK_TEXT.test(name)) continue;
    const url = toAbsoluteUrl($(anchor).attr('href'));
    const cate = url ? new URL(url).searchParams.get('cate') : null;
    if (url && cate && /^\d+$/.test(cate)) return { name, url, cate };
  }
  return null;
}

/**
 * 행사 페이지 HTML 또는 상품 조각 HTML → RawDeal[].
 * 상품 한 칸은 `li.goods-form-list[data-idx]`이고, 가격 줄은 `49%` · ~~`99,000`~~ · `49,900` 순서다.
 * 할인가를 읽지 못한 칸은 버리고, 할인율·정가는 표시가 없으면 null로 둔다.
 * 한 문서 안에 같은 상품이 두 번 나오면 처음 것만 남긴다.
 */
export function parseAttrangs(html: string, context: { event?: DealEvent | null } = {}): RawDeal[] {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const $ = cheerio.load(html);
  const deals: RawDeal[] = [];
  const seen = new Set<string>();

  for (const element of $('li.goods-form-list[data-idx]').toArray()) {
    const item = $(element);
    const id = clean(item.attr('data-idx'));
    if (!/^\d+$/.test(id) || seen.has(id)) continue;

    const image = item.find('.prdimg img').first();
    const nameLink = item.find('p.name a').first();
    const name = clean(nameLink.text()) || clean(image.attr('alt'));

    const price = item.find('.info .price').first();
    const salePrice = toWon(price.find('.attprice').first().text());
    if (name === '' || salePrice === null || salePrice <= 0) continue;

    let displayedDiscountRate: number | null = null;
    let originalPrice: number | null = null;
    for (const span of price.find('span').toArray()) {
      const text = clean($(span).text());
      const percent = /^(\d{1,3})\s*%$/.exec(text);
      if (percent) {
        displayedDiscountRate ??= Number(percent[1]);
      } else if (/line-through/i.test($(span).attr('style') ?? '')) {
        originalPrice ??= toWon(text);
      }
    }

    seen.add(id);
    deals.push({
      siteProductId: id,
      name,
      brand: null,
      url: toAbsoluteUrl(nameLink.attr('href') ?? item.find('.prdimg a').first().attr('href')) ?? `${PRODUCT_PAGE}${id}`,
      // 목록에 실제로 보이는 썸네일. data-oriimg는 수 MB짜리 움직이는 GIF라 쓰지 않는다.
      imageUrl: toAbsoluteUrl(image.attr('src') ?? image.attr('data-oriimg')),
      originalPrice,
      salePrice,
      displayedDiscountRate,
      endsAt: null,
      rawCategory: null,
      rawGender: SITE_GENDER,
      // 수집 당시 목록에 품절 상품이 없어 실제 표시는 확인하지 못했다. 찜 목록 틀이 쓰는 클래스 이름으로만 본다.
      soldOut: item.find('.soldout, .soldoutbox').length > 0,
      event: context.event ?? null,
    });
  }
  return deals;
}

async function crawl(ctx: CrawlContext): Promise<RawDeal[]> {
  const canRequest = () => ctx.requestsLeft > 0 && !ctx.signal.aborted;

  // 1) 첫 화면 메뉴에서 행사 페이지 찾기
  const found = parseAttrangsEvent(await ctx.fetchHtml(HOME_URL, RAW_HTML));
  if (!found) {
    ctx.log('아뜨랑스: 첫 화면에서 블프 행사 메뉴를 찾지 못함');
    return [];
  }
  const event: DealEvent = { name: found.name, url: found.url, endsAt: null };

  const byId = new Map<string, RawDeal>();
  const add = (deals: RawDeal[]): number => {
    let fresh = 0;
    for (const deal of deals) {
      if (byId.has(deal.siteProductId)) continue;
      byId.set(deal.siteProductId, deal);
      fresh += 1;
    }
    return fresh;
  };

  // 2) 행사 페이지 (BEST 영역)
  if (canRequest()) {
    const best = parseAttrangs(await ctx.fetchHtml(found.url, RAW_HTML), { event });
    add(best);
    ctx.log(`아뜨랑스: ${found.name} 행사 페이지 ${best.length}개`);
  }

  // 3) 스크롤 목록 — 빈 응답이 올 때까지
  let previousIds = '';
  for (let page = 1; page <= MAX_PAGES && canRequest(); page += 1) {
    const deals = parseAttrangs(await ctx.fetchHtml(attrangsMoreUrl(found.cate, page), RAW_HTML), { event });
    if (deals.length === 0) break;
    const ids = deals.map((deal) => deal.siteProductId).join(',');
    if (ids === previousIds) break; // 같은 페이지가 반복되면 끝으로 본다
    previousIds = ids;
    const fresh = add(deals);
    ctx.log(`아뜨랑스: 목록 ${page}쪽 ${deals.length}개 (새 상품 ${fresh}개)`);
    if (deals.length < PAGE_SIZE) break; // 마지막 쪽
  }

  return [...byId.values()];
}

export const attrangs: SiteAdapter = {
  id: SITE_ID,
  displayName: '아뜨랑스',
  homeUrl: ORIGIN,
  stealth: true,
  obeyRobots: true,
  // 첫 화면 1 + 행사 페이지 1 + 목록 최대 12쪽
  maxRequests: 15,
  crawl,
};

import * as cheerio from 'cheerio';
import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';

/**
 * W컨셉 — 어게인 더블유위크 프로모션.
 *
 * 프로모션 페이지 HTML에는 행사 구성과 상품 번호(itemCd)만 들어 있고, 상품 이름·가격은 인증 키가 필요한
 * API로 따로 불러와서 Obscura로는 렌더링되지 않는다. 그래서 두 단계로 읽는다.
 *   1) 프로모션 페이지  → 내장 데이터(`self.__next_f` 안의 promotionPayload)에서 지금 진행 중인 회차의 상품 번호
 *   2) 상품 상세 페이지 → 서버가 그려 준 HTML에서 이름·브랜드·정가·할인율·할인가 (상품 1개당 요청 1번)
 * 원본 예시는 fixtures/sites/wconcept/ 참고.
 */
const PROMOTION_URL = 'https://display.wconcept.co.kr/rn/promotion/163';
const PRODUCT_PAGE = 'https://www.wconcept.co.kr/Product/';
const PRODUCT_MODULE_TYPE = 'COLLECTION';
/** 응답의 날짜는 시간대 표시 없는 한국 시각이다 */
const KST = '+09:00';
/** "끝없음"으로 쓰이는 종료일(2999-12-31) */
const NO_END_YEAR = 2999;

type Json = Record<string, unknown>;
type DealEvent = NonNullable<RawDeal['event']>;

export interface WconceptPromotion {
  name: string;
  endsAt: string | null;
  /** 지금 진행 중인 회차들 */
  rounds: { title: string; endsAt: string | null; itemCds: string[] }[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** 129000, "129,000원" → 129000. 읽지 못하면 null */
function toWon(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/[^\d]/g, '');
  return digits === '' ? null : Number(digits);
}

/** "2026-11-27T23:59:59" → "2026-11-27T23:59:59+09:00". 끝없음(2999년)이면 null */
function toKstIso(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return null;
  if (Number(s.slice(0, 4)) >= NO_END_YEAR) return null;
  return /[+-]\d{2}:\d{2}$|Z$/.test(s) ? s : `${s}${KST}`;
}

const timeOf = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);

/** HTML의 `self.__next_f.push([1,"…"])` 조각들을 이어 붙인 문자열에서 `"key":{…}` 객체를 꺼낸다 */
function embeddedObject(html: string, key: string): Json | null {
  let text = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      text += JSON.parse(m[1]) as string;
    } catch {
      // 깨진 조각은 건너뛴다
    }
  }
  const marker = `"${key}":`;
  const at = text.indexOf(marker);
  if (at < 0) return null;

  const start = at + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(text.slice(start, i + 1));
          return isObj(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    } else if (depth === 0 && !/\s/.test(c)) return null;
  }
  return null;
}

const itemCdsOf = (products: unknown): string[] =>
  list(products).flatMap((p) => {
    const cd = str(p.itemCd);
    return cd ? [cd] : [];
  });

/** 프로모션 페이지 HTML → 프로모션 정보와 `now` 시점에 진행 중인 회차의 상품 번호 */
export function parseWconceptPromotion(html: string, now: Date): WconceptPromotion | null {
  const payload = embeddedObject(html, 'promotionPayload');
  if (!payload || !isObj(payload.promotion)) return null;
  const name = str(payload.promotion.title);
  if (!name) return null;
  const promotionEndsAt = toKstIso(payload.promotion.displayEndDate);

  const nowMs = now.getTime();
  const isOpen = (startsAt: unknown, endsAt: string | null) => {
    const start = timeOf(toKstIso(startsAt));
    const end = timeOf(endsAt);
    return (start === null || start <= nowMs) && (end === null || nowMs <= end);
  };

  const rounds: WconceptPromotion['rounds'] = [];
  for (const content of list(payload.contents)) {
    if (content.moduleType !== PRODUCT_MODULE_TYPE) continue;
    const title = str(content.mainTitle) ?? name;
    for (const mod of list(content.modules)) {
      // 날짜별 회차가 있으면 지금 진행 중인 회차만, 없으면 모듈의 상품 목록 전체
      const parts = Array.isArray(mod.schedules) ? list(mod.schedules) : [mod];
      for (const part of parts) {
        const endsAt = toKstIso(part.displayEndDate) ?? promotionEndsAt;
        const itemCds = itemCdsOf(part.productList);
        if (itemCds.length > 0 && isOpen(part.displayStartDate, endsAt)) rounds.push({ title, endsAt, itemCds });
      }
    }
  }
  return { name, endsAt: promotionEndsAt, rounds };
}

/**
 * 상품 상세 페이지 HTML → RawDeal 0개 또는 1개.
 * - salePrice·displayedDiscountRate는 페이지가 크게 보여 주는 값(쿠폰 포함 가격).
 * - 카테고리·성별·품절 여부는 이 영역에서 읽지 못해 null / false로 둔다.
 */
export function parseWconcept(
  html: string,
  context: { itemCd: string; event?: DealEvent | null },
): RawDeal[] {
  const $ = cheerio.load(html);
  const name = str($('.h_group h3.product').first().text());
  const salePrice = toWon($('.price_wrap .offer_price').first().text());
  if (!name || salePrice === null) return [];

  const rateText = $('.price_wrap .discount_rate').first().text().match(/(\d+)\s*%/);
  const image = str($('meta[property="og:image"]').attr('content'));

  return [
    {
      siteProductId: context.itemCd,
      name,
      brand: str($('.h_group h2.brand a').first().text()),
      url: `${PRODUCT_PAGE}${context.itemCd}`,
      imageUrl: image?.startsWith('//') ? `https:${image}` : image,
      originalPrice: toWon($('.price_wrap .discounted_price del').first().text()),
      salePrice,
      displayedDiscountRate: rateText ? Number(rateText[1]) : null,
      endsAt: null,
      rawCategory: null,
      rawGender: null,
      soldOut: false,
      event: context.event ?? null,
    },
  ];
}

async function crawl(ctx: CrawlContext): Promise<RawDeal[]> {
  // 1) 행사 목록: 프로모션 페이지에서 지금 진행 중인 회차
  const promotion = parseWconceptPromotion(await ctx.fetchHtml(PROMOTION_URL, { waitSec: 1 }), new Date());
  if (!promotion) {
    ctx.log('W컨셉: 프로모션 정보를 읽지 못함');
    return [];
  }

  // 2) 회차의 상품마다 상세 페이지 (요청 상한까지만)
  const deals: RawDeal[] = [];
  const seen = new Set<string>();
  let used = 1;
  for (const round of promotion.rounds) {
    const event: DealEvent = { name: `${promotion.name} · ${round.title}`, url: PROMOTION_URL, endsAt: round.endsAt };
    for (const itemCd of round.itemCds) {
      if (seen.has(itemCd)) continue;
      if (used >= wconcept.maxRequests || ctx.signal.aborted) return deals;
      seen.add(itemCd);
      used += 1;
      deals.push(...parseWconcept(await ctx.fetchHtml(`${PRODUCT_PAGE}${itemCd}`, { waitSec: 1 }), { itemCd, event }));
    }
    ctx.log(`W컨셉: ${round.title} ${round.itemCds.length}개 중 ${deals.length}개 읽음`);
  }
  return deals;
}

export const wconcept: SiteAdapter = {
  id: 'wconcept',
  displayName: 'W컨셉',
  homeUrl: 'https://www.wconcept.co.kr',
  stealth: false,
  // display.wconcept.co.kr/robots.txt는 허용 목록에 없는 봇에게 Disallow: / 이다.
  // 2026-11-27 담당자 결정으로 끔. 켜면 Obscura가 "Blocked by robots.txt"로 거부해 수집되지 않는다.
  obeyRobots: false,
  maxRequests: 30,
  crawl,
};

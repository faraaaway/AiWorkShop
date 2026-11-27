// 퀸잇 수집기 (T045) — 기획전(/collection/<id>) 페이지의 상품 카드.
// 홈 배너는 클릭 핸들러라 기획전 주소가 HTML에 없다. 그래서 직접 확인한 기획전 주소 목록
// (QUEENIT_SEED_COLLECTIONS)만 돈다.
import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';
import { LoginRequiredError } from '@/lib/errors';
import { absoluteUrl, collectCards, fetchScrolled, leafTexts, looksLikeLoginPage, toPercent, toWon } from './crawlb-shared';

const HOME = 'https://web.queenit.kr';
const LINK_SELECTOR = 'a[href^="/product/"]';
const CARD_PARENT_LEVELS = 1;
const MAX_PAGES = 4;
/** 첫 시도(기본 25초)에서 상품을 못 모았을 때 다시 읽으며 기다리는 시간(초). */
const RETRY_WAIT_SEC = 40;

/** 2026-11-27 홈 메인 배너가 연결하던 겨울 특가 기획전. 시즌이 바뀌면 여기만 고친다. */
export const QUEENIT_SEED_COLLECTIONS = [`${HOME}/collection/COLL261006221807d8979`];

type QueenitEvent = NonNullable<RawDeal['event']>;

/** 접근성용 숨김 문구 "62,910원, 할인율 78%, 할인 전 298,000원" 을 숫자로. */
function parsePriceSentence(text: string): { sale: number | null; rate: number | null; original: number | null } {
  const sale = /^\s*([\d,]+)\s*원/.exec(text);
  const rate = /할인율\s*(\d{1,3})\s*%/.exec(text);
  const original = /할인 전\s*([\d,]+)\s*원/.exec(text);
  return {
    sale: sale ? toWon(sale[1]) : null,
    rate: rate ? Number(rate[1]) : null,
    original: original ? toWon(original[1]) : null,
  };
}

/** 기획전 HTML(스크롤 수집본) → RawDeal[]. 순수 함수. */
export function parseQueenit(html: string, pageUrl: string = HOME, event: QueenitEvent | null = null): RawDeal[] {
  const deals: RawDeal[] = [];
  for (const { href, $ } of collectCards(html, LINK_SELECTOR, CARD_PARENT_LEVELS)) {
    const id = /^\/product\/([0-9a-zA-Z]+)/.exec(href)?.[1];
    if (!id) continue;

    const leaves = leafTexts($);
    const sentence = $('[data-visually-hidden]').first().text() || leaves.find((t) => /원,\s*할인율/.test(t)) || '';
    const parsed = parsePriceSentence(sentence);
    let { sale, rate } = parsed;
    const { original } = parsed;
    if (sale === null) {
      // 숨김 문구가 없으면 화면 표시("77%" 다음 "76,500")에서 읽는다.
      const rateAt = leaves.findIndex((t) => toPercent(t) !== null);
      const priceText = rateAt >= 0 ? leaves[rateAt + 1] : leaves.find((t) => toWon(t) !== null);
      sale = toWon(priceText);
      if (rate === null && rateAt >= 0) rate = toPercent(leaves[rateAt]);
    }
    const name = $('[class*="ProductItemProductName"]').first().text().replace(/\s+/g, ' ').trim();
    if (!name || sale === null) continue;

    const brand = $('[class*="ProductItemBrand"]').first().text().replace(/\s+/g, ' ').trim();
    deals.push({
      siteProductId: id,
      name,
      brand: brand || null,
      url: `${HOME}/product/${id}`,
      imageUrl: absoluteUrl($('img').first().attr('src'), pageUrl),
      originalPrice: original,
      salePrice: sale,
      displayedDiscountRate: rate,
      endsAt: null,
      rawCategory: null,
      rawGender: null,
      soldOut: leaves.some((t) => /품절|일시품절|SOLD\s*OUT/i.test(t)),
      event,
    });
  }
  return deals;
}

export const queenit: SiteAdapter = {
  id: 'queenit',
  displayName: '퀸잇',
  homeUrl: HOME,
  stealth: true,
  // robots.txt가 목록에 없는 봇을 전부 막는다(User-agent: * / Disallow: /). 소유자 결정으로 끔(2026-11-27).
  obeyRobots: false,
  maxRequests: 30,

  async crawl(ctx: CrawlContext): Promise<RawDeal[]> {
    const deals: RawDeal[] = [];
    for (const url of QUEENIT_SEED_COLLECTIONS.slice(0, MAX_PAGES)) {
      if (ctx.signal.aborted) break;
      const html = await fetchScrolled(ctx, url, LINK_SELECTOR, CARD_PARENT_LEVELS);
      if (looksLikeLoginPage(html)) throw new LoginRequiredError();

      // 기획전 이름·종료 시각은 페이지에 글자로 나오지 않는다(배너 이미지 안). 모르는 값은 비운다.
      const event: QueenitEvent = { name: '퀸잇 기획전', url, endsAt: null };
      let found = parseQueenit(html, url, event);
      ctx.log(`queenit ${url} → ${found.length}개`);

      // 상품 목록이 늦게 뜨면 기다리는 동안 카드를 하나도 못 모을 때가 있다(2026-11-28 실수집에서
      // 같은 주소가 19개 → 0개 → 19개). 0개면 더 길게 기다려 한 번만 다시 읽는다.
      if (found.length === 0 && ctx.requestsLeft > 0 && !ctx.signal.aborted) {
        const retryHtml = await fetchScrolled(ctx, url, LINK_SELECTOR, CARD_PARENT_LEVELS, RETRY_WAIT_SEC);
        if (looksLikeLoginPage(retryHtml)) throw new LoginRequiredError();
        found = parseQueenit(retryHtml, url, event);
        ctx.log(`queenit ${url} 다시 읽기 → ${found.length}개`);
      }
      deals.push(...found);
    }
    return deals;
  },
};

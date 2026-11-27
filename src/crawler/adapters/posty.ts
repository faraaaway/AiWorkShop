// 포스티 수집기 (T046) — 홈에서 블프 기획전(/events/cms/<uuid>) 주소를 읽고, 기획전마다 상품 카드를 모은다.
import * as cheerio from 'cheerio';
import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';
import { LoginRequiredError } from '@/lib/errors';
import {
  absoluteUrl,
  collectCards,
  fetchScrolled,
  leafTexts,
  looksLikeLoginPage,
  msToKstIso,
  readNextData,
  toPercent,
  toWon,
} from './crawlb-shared';

const HOME = 'https://posty.kr';
const LINK_SELECTOR = 'a[href^="/products/"]';
const CARD_PARENT_LEVELS = 0;
const MAX_EVENTS = 5;

/** 홈 기획전 배너 중 블프 행사로 볼 문구. */
const BF_KEYWORDS = /블프|블랙\s*프라이데이|BLACK\s*FRIDAY/i;
/** 의류가 아닌 기획전(배너 문구 기준)은 건너뛴다. */
const NOT_CLOTHING = /뷰티|리빙|디바이스/;

/** 홈 기획전 목록에서 이번에 돌 블프 의류 기획전만 고른다. */
export function pickPostyEvents(links: PostyEventLink[], max: number = MAX_EVENTS): PostyEventLink[] {
  return links.filter((e) => BF_KEYWORDS.test(e.title) && !NOT_CLOTHING.test(e.title)).slice(0, max);
}

type PostyEvent = NonNullable<RawDeal['event']>;

export interface PostyEventLink {
  url: string;
  title: string;
}

/** 홈 HTML → 기획전 주소와 배너 문구. 같은 주소는 문구가 있는 첫 번째만. */
export function parsePostyEventLinks(homeHtml: string): PostyEventLink[] {
  const $ = cheerio.load(homeHtml);
  const byUrl = new Map<string, string>();
  $('a[href*="/events/cms/"]').each((_, a) => {
    const raw = absoluteUrl($(a).attr('href'), HOME);
    if (!raw) return;
    const url = raw.split('#')[0].split('?')[0];
    const title = $(a).text().replace(/\s+/g, ' ').trim();
    if (!byUrl.has(url) || (!byUrl.get(url) && title)) byUrl.set(url, title);
  });
  return [...byUrl].map(([url, title]) => ({ url, title }));
}

/** 기획전 페이지의 __NEXT_DATA__에서 제목과 종료 시각(밀리초)을 읽는다. */
export function parsePostyEventInfo(html: string, pageUrl: string): PostyEvent | null {
  const data = readNextData(html) as { props?: { pageProps?: { title?: unknown; date_ended?: unknown } } } | null;
  const props = data?.props?.pageProps;
  if (!props) return null;
  const name = typeof props.title === 'string' ? props.title.trim() : '';
  if (!name) return null;
  const ended = typeof props.date_ended === 'number' && props.date_ended > 0 ? props.date_ended : null;
  return { name, url: pageUrl, endsAt: ended === null ? null : msToKstIso(ended) };
}

/** 기획전(또는 홈) HTML → RawDeal[]. 순수 함수. event를 안 주면 페이지에서 읽는다. */
export function parsePosty(html: string, pageUrl: string = HOME, event?: PostyEvent | null): RawDeal[] {
  const pageEvent = event === undefined ? parsePostyEventInfo(html, pageUrl) : event;
  const deals: RawDeal[] = [];

  for (const { href, $ } of collectCards(html, LINK_SELECTOR, CARD_PARENT_LEVELS)) {
    const id = /^\/products\/(\d+)/.exec(href)?.[1];
    if (!id) continue;

    // 카드 글자 순서: [배지…] 브랜드, 상품명, "쿠폰할인가", "85%", "39,900", 평점, 리뷰 수
    const leaves = leafTexts($);
    const name = ($('img[alt]').first().attr('alt') ?? '').replace(/\s+/g, ' ').trim();
    const nameAt = name ? leaves.indexOf(name) : -1;
    if (!name || nameAt < 0) continue;

    const after = leaves.slice(nameAt + 1);
    const rateAt = after.findIndex((t) => toPercent(t) !== null);
    const rate = rateAt >= 0 ? toPercent(after[rateAt]) : null;
    const sale = rateAt >= 0 ? toWon(after[rateAt + 1]) : toWon(after.find((t) => toWon(t) !== null));
    if (sale === null) continue;

    const brand = nameAt > 0 ? leaves[nameAt - 1] : '';
    deals.push({
      siteProductId: id,
      name,
      brand: brand && toWon(brand) === null ? brand : null,
      url: `${HOME}/products/${id}`,
      imageUrl: absoluteUrl($('img[alt]').first().attr('src'), pageUrl),
      originalPrice: null, // 카드에는 할인율과 할인가만 나온다
      salePrice: sale,
      displayedDiscountRate: rate,
      endsAt: null,
      rawCategory: null,
      rawGender: null,
      soldOut: leaves.some((t) => /품절|SOLD\s*OUT/i.test(t)),
      event: pageEvent,
    });
  }
  return deals;
}

export const posty: SiteAdapter = {
  id: 'posty',
  displayName: '포스티',
  homeUrl: HOME,
  stealth: true,
  // robots.txt가 목록에 없는 봇을 전부 막는다(User-agent: * / Disallow: /). 소유자 결정으로 끔(2026-11-27).
  obeyRobots: false,
  maxRequests: 30,

  async crawl(ctx: CrawlContext): Promise<RawDeal[]> {
    const homeHtml = await ctx.fetchHtml(HOME, { waitSec: 6 });
    if (looksLikeLoginPage(homeHtml)) throw new LoginRequiredError();

    const events = pickPostyEvents(parsePostyEventLinks(homeHtml));
    ctx.log(`posty 블프 기획전 ${events.length}개`);

    const deals: RawDeal[] = [];
    for (const event of events) {
      if (ctx.signal.aborted) break;
      const html = await fetchScrolled(ctx, event.url, LINK_SELECTOR, CARD_PARENT_LEVELS);
      if (looksLikeLoginPage(html)) throw new LoginRequiredError();
      const found = parsePosty(html, event.url);
      ctx.log(`posty ${event.url} → ${found.length}개`);
      deals.push(...found);
    }
    return deals;
  },
};

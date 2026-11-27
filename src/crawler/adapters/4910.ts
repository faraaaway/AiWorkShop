// 4910 수집기 (T047) — 홈에 걸린 세일 상품 카드(/goods/<id>).
// 홈 탭과 "전체보기"는 버튼이라 행사 페이지 주소가 HTML에 없다. 홈 한 장을 스크롤하며 모은다.
import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';
import { LoginRequiredError } from '@/lib/errors';
import { absoluteUrl, collectCards, fetchScrolled, leafTexts, looksLikeLoginPage, toPercent, toWon } from './crawlb-shared';

const HOME = 'https://4910.kr';
const LINK_SELECTOR = 'a[href^="/goods/"]';
const CARD_PARENT_LEVELS = 0;

/** 홈 HTML(스크롤 수집본) → RawDeal[]. 순수 함수. 할인율이 표시된 카드만 행사 상품으로 본다. */
export function parse4910(html: string, pageUrl: string = HOME): RawDeal[] {
  const deals: RawDeal[] = [];
  for (const { href, $ } of collectCards(html, LINK_SELECTOR, CARD_PARENT_LEVELS)) {
    const id = /^\/goods\/(\d+)/.exec(href)?.[1];
    if (!id) continue;

    // 카드 글자 순서: [N 배지] 브랜드, 상품명, "48%", "68,970", 쿠폰, 무료배송, 관심·리뷰
    const leaves = leafTexts($);
    const rateAt = leaves.findIndex((t) => toPercent(t) !== null);
    if (rateAt < 1) continue;
    const sale = toWon(leaves[rateAt + 1]);
    const name = leaves[rateAt - 1];
    if (sale === null || !name) continue;

    const brand = rateAt >= 2 ? leaves[rateAt - 2] : '';
    deals.push({
      siteProductId: id,
      name,
      brand: brand || null,
      url: `${HOME}/goods/${id}`,
      imageUrl: absoluteUrl($('img').first().attr('src'), pageUrl),
      originalPrice: null, // 카드에는 할인율과 할인가만 나온다
      salePrice: sale,
      displayedDiscountRate: toPercent(leaves[rateAt]),
      endsAt: null,
      rawCategory: null,
      rawGender: null,
      soldOut: leaves.some((t) => /품절|SOLD\s*OUT/i.test(t)),
      event: null,
    });
  }
  return deals;
}

export const site4910: SiteAdapter = {
  id: '4910',
  displayName: '4910',
  homeUrl: HOME,
  stealth: true,
  // robots.txt가 목록에 없는 봇을 전부 막는다(User-agent: * / Disallow: /). 소유자 결정으로 끔(2026-11-27).
  obeyRobots: false,
  maxRequests: 30,

  async crawl(ctx: CrawlContext): Promise<RawDeal[]> {
    const html = await fetchScrolled(ctx, HOME, LINK_SELECTOR, CARD_PARENT_LEVELS);
    if (looksLikeLoginPage(html)) throw new LoginRequiredError();
    const deals = parse4910(html, HOME);
    ctx.log(`4910 홈 → ${deals.length}개`);
    return deals;
  },
};

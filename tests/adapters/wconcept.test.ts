import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CrawlContext } from '@/lib/types';
import { parseWconcept, parseWconceptPromotion, wconcept } from '@/crawler/adapters/wconcept';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/sites/wconcept/${name}`, import.meta.url), 'utf8');

const promotionHtml = fixture('promotion-163.html');
const productHtml = fixture('product-309024809.html');

describe('parseWconceptPromotion', () => {
  it('프로모션 이름·종료 시각과 지금 진행 중인 회차의 상품 번호를 읽는다', () => {
    const promotion = parseWconceptPromotion(promotionHtml, new Date('2026-11-27T22:00:00+09:00'));
    expect(promotion?.name).toBe('어게인 더블유위크');
    expect(promotion?.endsAt).toBe('2026-11-30T10:00:59+09:00');
    expect(promotion?.rounds).toHaveLength(1);
    expect(promotion?.rounds[0].title).toBe('이번 시즌의 발견');
    expect(promotion?.rounds[0].endsAt).toBe('2026-11-27T23:59:59+09:00');
    expect(promotion?.rounds[0].itemCds).toHaveLength(9);
    expect(promotion?.rounds[0].itemCds.slice(0, 2)).toEqual(['309024809', '307425000']);
  });

  it('날짜가 바뀌면 그날의 회차를 고른다', () => {
    const next = parseWconceptPromotion(promotionHtml, new Date('2026-11-28T12:00:00+09:00'));
    expect(next?.rounds).toHaveLength(1);
    expect(next?.rounds[0].endsAt).toBe('2026-11-28T23:59:59+09:00');
    expect(next?.rounds[0].itemCds).toHaveLength(10);
    expect(next?.rounds[0].itemCds[0]).toBe('308312312');
  });

  it('행사가 끝난 뒤에는 회차가 없다', () => {
    expect(parseWconceptPromotion(promotionHtml, new Date('2026-12-05T12:00:00+09:00'))?.rounds).toEqual([]);
  });

  it('내장 데이터가 없으면 null', () => {
    expect(parseWconceptPromotion('<html><body>차단</body></html>', new Date())).toBeNull();
  });
});

describe('parseWconcept', () => {
  it('상품 페이지 값을 그대로 옮긴다', () => {
    // 2026-11-27 프로모션 화면 표시: "지지피엑스 러블리 부클 반팔 니트 가디건 (GQDCK009D) 77% 24,605"
    expect(parseWconcept(productHtml, { itemCd: '309024809' })).toEqual([
      {
        siteProductId: '309024809',
        name: '러블리 부클 반팔 니트 가디건 (GQDCK009D)',
        brand: '지지피엑스',
        url: 'https://www.wconcept.co.kr/Product/309024809',
        imageUrl: 'https://product-image.wconcept.co.kr/productimg/image/img2/09/309024809_UM80204.jpg',
        originalPrice: 109000,
        salePrice: 24605,
        displayedDiscountRate: 77,
        endsAt: null,
        rawCategory: null,
        rawGender: null,
        soldOut: false,
        event: null,
      },
    ]);
  });

  it('넘겨받은 기획전을 붙인다', () => {
    const event = { name: '기획전', url: 'https://display.wconcept.co.kr/x', endsAt: null };
    expect(parseWconcept(productHtml, { itemCd: '309024809', event })[0].event).toBe(event);
  });

  it('할인 표시가 없는 상품은 정가·할인율이 null', () => {
    const html =
      '<div class="h_group"><h3 class="product">정가 상품</h3></div>' +
      '<div class="price_wrap"><span class="offer_price"> 59,000 <span class="unit_price">원</span></span></div>';
    const [deal] = parseWconcept(html, { itemCd: '1' });
    expect(deal.salePrice).toBe(59000);
    expect(deal.originalPrice).toBeNull();
    expect(deal.displayedDiscountRate).toBeNull();
    expect(deal.brand).toBeNull();
    expect(deal.imageUrl).toBeNull();
  });

  it('이름이나 가격을 못 찾으면 빈 배열', () => {
    expect(parseWconcept('<html><body>로그인</body></html>', { itemCd: '1' })).toEqual([]);
  });
});

describe('wconcept.crawl', () => {
  function fakeContext() {
    const urls: string[] = [];
    const ctx: CrawlContext = {
      fetchHtml: async (url: string) => {
        urls.push(url);
        return url.includes('/rn/promotion/') ? promotionHtml : productHtml;
      },
      fetchJson: async () => {
        throw new Error('fetchJson은 쓰지 않는다');
      },
      evalPage: async () => {
        throw new Error('evalPage는 쓰지 않는다');
      },
      log: () => {},
      signal: new AbortController().signal,
    };
    return { ctx, urls };
  }

  it('프로모션 페이지 → 상품 페이지 순서로 읽고 요청 상한을 지킨다', async () => {
    const { ctx, urls } = fakeContext();
    const deals = await wconcept.crawl(ctx);

    expect(urls[0]).toBe('https://display.wconcept.co.kr/rn/promotion/163');
    expect(urls.length).toBeLessThanOrEqual(wconcept.maxRequests);
    expect(urls.slice(1).every((u) => /^https:\/\/www\.wconcept\.co\.kr\/Product\/\d+$/.test(u))).toBe(true);
    // 실행 시각에 따라 진행 중인 회차가 달라진다(행사 종료 뒤에는 0개)
    expect(deals).toHaveLength(urls.length - 1);
    for (const d of deals) {
      expect(d.event?.name).toBe('어게인 더블유위크 · 이번 시즌의 발견');
      expect(d.event?.url).toBe('https://display.wconcept.co.kr/rn/promotion/163');
    }
  });

  it('프로모션 정보를 못 읽으면 빈 배열', async () => {
    const { ctx } = fakeContext();
    ctx.fetchHtml = async () => '<html><body></body></html>';
    expect(await wconcept.crawl(ctx)).toEqual([]);
  });
});

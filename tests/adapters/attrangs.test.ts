import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attrangs, attrangsMoreUrl, parseAttrangs, parseAttrangsEvent } from '@/crawler/adapters/attrangs';
import { createFakeContext } from '../helpers/fakeContext';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../fixtures/sites/attrangs/${name}`, import.meta.url), 'utf8');

const home = fixture('home.html');
const eventPage = fixture('list-cate2357.html');
const morePage = fixture('more-cate2357-limit48-page1.html');

const HOME_URL = 'https://attrangs.co.kr/';
const EVENT_URL = 'https://attrangs.co.kr/shop/list.php?cate=2357';

describe('parseAttrangsEvent', () => {
  it('첫 화면 메뉴에서 블프 행사 링크를 찾는다', () => {
    expect(parseAttrangsEvent(home)).toEqual({ name: '블프특가🧨', url: EVENT_URL, cate: '2357' });
  });

  it('행사 메뉴가 없으면 null', () => {
    expect(parseAttrangsEvent('<a href="/shop/list.php?cate=10">원피스</a>')).toBeNull();
    expect(parseAttrangsEvent('<a href="/event/bf.php">블랙프라이데이</a>')).toBeNull();
    expect(parseAttrangsEvent('')).toBeNull();
  });
});

describe('parseAttrangs', () => {
  const best = parseAttrangs(eventPage);
  const more = parseAttrangs(morePage);

  it('행사 페이지에서 BEST 64개, 목록 조각에서 48개를 읽는다', () => {
    expect(best).toHaveLength(64);
    expect(more).toHaveLength(48);
    expect(new Set(best.map((d) => d.siteProductId)).size).toBe(64);
    expect(new Set(more.map((d) => d.siteProductId)).size).toBe(48);
  });

  it('사이트 값을 그대로 옮긴다', () => {
    expect(best[0]).toEqual({
      siteProductId: '169049',
      name: '(국내제작)(MADE) 헤이디 핀턱 7부 퍼프 소매 미니 원피스',
      brand: null,
      url: 'https://attrangs.co.kr/shop/view.php?index_no=169049',
      imageUrl: 'https://atimg.sonyunara.com/files/attrangs/goods/169049/list13_69b95d1d74e55.gif?v=1',
      originalPrice: 99000,
      salePrice: 49900,
      displayedDiscountRate: 49,
      endsAt: null,
      rawCategory: null,
      rawGender: '여성',
      soldOut: false,
      event: null,
    });
    expect(more[0]).toMatchObject({
      siteProductId: '151412',
      name: '[1만5천장 돌파✨] (MADE/2기장/와이드명작/늘어짐없는탄탄핏)Day Jeans No.8 프리미엄 워싱 2기장 와이드 겨울데님 진',
      imageUrl: 'https://atimg.sonyunara.com/files/attrangs/goods/151412/list13_6a6ff0b0690ca.webp?v=1',
      originalPrice: 69000,
      salePrice: 19900,
      displayedDiscountRate: 71,
    });
    expect(more[47]).toMatchObject({ siteProductId: '75667', originalPrice: 50000, salePrice: 19900, displayedDiscountRate: 60 });
  });

  it('필수 필드가 모두 있고 가격은 숫자(원), 주소는 절대 경로다', () => {
    for (const d of [...best, ...more]) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://attrangs.co.kr/shop/view.php?index_no=${d.siteProductId}`);
      expect(d.imageUrl).toMatch(/^https:\/\/atimg\.sonyunara\.com\/.+\.(webp|gif|jpg|png)(\?|$)/);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.rawGender).toBe('여성');
    }
  });

  it('정가·할인가·표시 할인율이 서로 맞는다 (표시 할인율은 계산값과 1%p 이내)', () => {
    for (const d of [...best, ...more]) {
      expect(d.originalPrice).not.toBeNull();
      expect(d.displayedDiscountRate).not.toBeNull();
      const original = d.originalPrice as number;
      const computed = ((original - d.salePrice) / original) * 100;
      expect(original).toBeGreaterThan(d.salePrice);
      expect(Math.abs((d.displayedDiscountRate as number) - computed)).toBeLessThan(1);
    }
  });

  it('넘겨받은 기획전을 모든 상품에 붙인다', () => {
    const event = { name: '블프특가🧨', url: EVENT_URL, endsAt: null };
    expect(parseAttrangs(morePage, { event }).every((d) => d.event === event)).toBe(true);
  });

  it('할인율·정가 표시가 없으면 null, 할인가를 못 읽은 칸은 버린다', () => {
    const item = (id: string, price: string) =>
      `<li class="goods-form-list" data-idx="${id}"><div class="prdimg"><a href="/shop/view.php?index_no=${id}">` +
      `<img src="//atimg.sonyunara.com/x/${id}.webp" alt="대체 이름 ${id}"></a></div>` +
      `<div class="info"><div class="price">${price}</div><p class="name"><a href="/shop/view.php?index_no=${id}"> 상품  ${id} </a></p></div></li>`;
    const deals = parseAttrangs(
      [
        item('1', '<div class="attprice">12,900</div>'),
        item('2', '<span>30%</span><span style="text-decoration:line-through">20,000</span>'),
        item('3', '<div class="attprice">가격문의</div>'),
        item('1', '<div class="attprice">99,900</div>'),
        item('4', '<span>30%</span><span style="text-decoration:line-through">20,000</span><div class="attprice">14,000</div><div class="soldout"></div>'),
      ].join(''),
    );
    expect(deals.map((d) => d.siteProductId)).toEqual(['1', '4']);
    expect(deals[0]).toMatchObject({
      name: '상품 1',
      salePrice: 12900,
      originalPrice: null,
      displayedDiscountRate: null,
      imageUrl: 'https://atimg.sonyunara.com/x/1.webp',
      soldOut: false,
    });
    expect(deals[1]).toMatchObject({ salePrice: 14000, originalPrice: 20000, displayedDiscountRate: 30, soldOut: true });
  });

  it('빈 응답(목록 끝)이나 상품 칸이 없는 HTML은 빈 배열', () => {
    expect(parseAttrangs('')).toEqual([]);
    expect(parseAttrangs('  \n')).toEqual([]);
    expect(parseAttrangs('<html><body><p>점검 중</p></body></html>')).toEqual([]);
  });
});

describe('attrangs.crawl', () => {
  const pages = (extra: Record<string, string> = {}) => (url: string) => {
    const table: Record<string, string> = {
      [HOME_URL]: home,
      [EVENT_URL]: eventPage,
      [attrangsMoreUrl('2357', 1)]: morePage,
      ...extra,
    };
    return table[url] ?? '';
  };

  it('첫 화면 → 행사 페이지 → 목록 순서로 읽고, 빈 응답에서 멈춘다', async () => {
    const ctx = createFakeContext({ fetchHtml: pages() });
    const deals = await attrangs.crawl(ctx);

    expect(ctx.urls).toEqual([HOME_URL, EVENT_URL, attrangsMoreUrl('2357', 1), attrangsMoreUrl('2357', 2)]);
    // BEST 64개 + 목록 48개 중 겹치는 38개를 뺀 74개
    expect(deals).toHaveLength(74);
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(74);
    expect(deals.every((d) => d.event?.name === '블프특가🧨' && d.event.url === EVENT_URL && d.event.endsAt === null)).toBe(true);
    expect(deals.every((d) => d.endsAt === null)).toBe(true);
  });

  it('목록 주소는 사이트가 스크롤할 때 쓰는 GET 주소다', () => {
    expect(attrangsMoreUrl('2357', 3)).toBe(
      'https://attrangs.co.kr/shop/list.php?mode=loadHTML&page=3&limit=48&cate=2357',
    );
  });

  it('48개보다 적게 온 쪽을 마지막으로 본다', async () => {
    const lastPage = '<li class="goods-form-list" data-idx="9"><div class="info"><div class="price">' +
      '<div class="attprice">9,900</div></div><p class="name"><a href="/shop/view.php?index_no=9">마지막 상품</a></p></div></li>';
    const ctx = createFakeContext({ fetchHtml: pages({ [attrangsMoreUrl('2357', 2)]: lastPage }) });
    const deals = await attrangs.crawl(ctx);

    expect(ctx.urls).toHaveLength(4);
    expect(deals).toHaveLength(75);
    expect(deals.at(-1)).toMatchObject({ siteProductId: '9', name: '마지막 상품', salePrice: 9900 });
  });

  it('같은 쪽이 반복되면 멈춘다', async () => {
    const ctx = createFakeContext({ fetchHtml: (url) => pages()(url) || morePage });
    const deals = await attrangs.crawl(ctx);

    expect(ctx.urls).toEqual([HOME_URL, EVENT_URL, attrangsMoreUrl('2357', 1), attrangsMoreUrl('2357', 2)]);
    expect(deals).toHaveLength(74);
  });

  it('행사 메뉴를 못 찾으면 요청 한 번으로 끝내고 빈 배열을 돌려준다', async () => {
    const ctx = createFakeContext({ fetchHtml: () => '<html><body><a href="/shop/list.php?cate=1">신상</a></body></html>' });
    expect(await attrangs.crawl(ctx)).toEqual([]);
    expect(ctx.urls).toEqual([HOME_URL]);
    expect(ctx.logs.join('\n')).toContain('행사 메뉴를 찾지 못함');
  });

  it('요청 상한 안에서 멈추고 그때까지 모은 것을 돌려준다', async () => {
    const ctx = createFakeContext({ fetchHtml: pages(), maxRequests: 2 });
    const deals = await attrangs.crawl(ctx);

    expect(ctx.urls).toEqual([HOME_URL, EVENT_URL]);
    expect(deals).toHaveLength(64);
  });

  it('요청 수가 어댑터 상한(maxRequests)을 넘지 않는다', async () => {
    // 매번 다른 48개를 돌려줘 목록이 끝나지 않는 상황
    let call = 0;
    const endless = () => {
      call += 1;
      return Array.from({ length: 48 }, (_, i) => {
        const id = call * 1000 + i;
        return `<li class="goods-form-list" data-idx="${id}"><div class="info"><div class="price"><div class="attprice">10,000</div></div>` +
          `<p class="name"><a href="/shop/view.php?index_no=${id}">상품 ${id}</a></p></div></li>`;
      }).join('');
    };
    const ctx = createFakeContext({
      fetchHtml: (url) => (url.includes('mode=loadHTML') ? endless() : pages()(url)),
      maxRequests: attrangs.maxRequests,
    });
    await attrangs.crawl(ctx);

    expect(ctx.urls.length).toBeLessThanOrEqual(attrangs.maxRequests);
    expect(ctx.urls.length).toBe(14); // 첫 화면 1 + 행사 페이지 1 + 목록 12쪽
  });

  it('어댑터 기본 설정', () => {
    expect(attrangs).toMatchObject({
      id: 'attrangs',
      displayName: '아뜨랑스',
      homeUrl: 'https://attrangs.co.kr',
      stealth: true,
      obeyRobots: true,
    });
  });
});

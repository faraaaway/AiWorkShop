import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CrawlContext } from '@/lib/types';
import { musinsa, parseMusinsa, parseMusinsaCampaign, parseMusinsaModule } from '@/crawler/adapters/musinsa';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/sites/musinsa/${name}`, import.meta.url), 'utf8'));

const meta = fixture('meta.json');
const moduleJson = fixture('module-signatureItem.json');
const goods = fixture('goods-signatureItem-outer.json');

describe('parseMusinsa', () => {
  const deals = parseMusinsa(goods);

  it('fixture에서 10개 이상 읽는다', () => {
    expect(deals.length).toBeGreaterThanOrEqual(10);
    expect(deals).toHaveLength(13);
  });

  it('필수 필드가 모두 있고 가격은 숫자(원)다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://www.musinsa.com/products/${d.siteProductId}`);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.imageUrl).toMatch(/^https:\/\//);
    }
  });

  it('사이트 값을 그대로 옮긴다', () => {
    expect(deals[0]).toEqual({
      siteProductId: '7108774',
      name: '[10주년기획] © 모두의 Comfortemp® 미드웨이트 패딩_5 COLOR',
      brand: '디미트리블랙',
      url: 'https://www.musinsa.com/products/7108774',
      imageUrl: 'https://image.msscdn.net/images/goods_img/20260819/7108774/7108774_17950559711884_500.jpg',
      originalPrice: 133400,
      salePrice: 69900,
      displayedDiscountRate: 48,
      endsAt: null,
      rawCategory: null,
      rawGender: '남녀공용',
      soldOut: false,
      event: null,
    });
  });

  it('성별 코드를 사이트 표기로 바꾼다', () => {
    const genderOf = (id: string) => deals.find((d) => d.siteProductId === id)?.rawGender;
    expect(genderOf('5532467')).toBe('남성');
    expect(genderOf('7104788')).toBe('여성');
    expect(genderOf('7108774')).toBe('남녀공용');
  });

  it('쿠폰 할인 상품은 상품 페이지에 보이는 쿠폰적용가를 쓴다', () => {
    // 2026-11-27 상품 페이지 표시: "쿠폰적용가 279,000원 37% 175,770원"
    const couponItem = deals.find((d) => d.siteProductId === '7438393');
    expect(couponItem?.originalPrice).toBe(279000);
    expect(couponItem?.salePrice).toBe(175770);
    expect(couponItem?.displayedDiscountRate).toBe(37);
  });

  it('넘겨받은 카테고리와 기획전을 모든 상품에 붙인다', () => {
    const event = { name: '기획전', url: 'https://www.musinsa.com/campaign/x', endsAt: '2026-12-03T00:00:00+09:00' };
    const tagged = parseMusinsa(goods, { rawCategory: '아우터', event });
    expect(tagged.every((d) => d.rawCategory === '아우터' && d.event === event)).toBe(true);
  });

  it('모르는 성별 코드·빠진 값은 null, 필수 값이 없는 상품은 버린다', () => {
    const raw = {
      meta: { result: 'SUCCESS' },
      data: {
        goodsList: [
          { goodsNo: 1, goodsName: '뷰티 상품', price: '12,900원', gender: 16 },
          { goodsNo: 2, goodsName: '가격 없음' },
          { goodsName: '번호 없음', price: 1000 },
        ],
      },
    };
    expect(parseMusinsa(raw)).toEqual([
      {
        siteProductId: '1',
        name: '뷰티 상품',
        brand: null,
        url: 'https://www.musinsa.com/products/1',
        imageUrl: null,
        originalPrice: null,
        salePrice: 12900,
        displayedDiscountRate: null,
        endsAt: null,
        rawCategory: null,
        rawGender: null,
        soldOut: false,
        event: null,
      },
    ]);
  });

  it('goodsStatus가 SOLD_OUT이면 품절', () => {
    // 2026-11-27 실수집: 상품 4459087이 SOLD_OUT이었고 상품 페이지에도 "품절"로 표시됨
    const raw = {
      meta: { result: 'SUCCESS' },
      data: {
        goodsList: [
          { goodsNo: 4459087, goodsName: '품절 상품', finalPrice: 134800, goodsStatus: 'SOLD_OUT' },
          { goodsNo: 7122634, goodsName: '판매 중', finalPrice: 29900, goodsStatus: 'ON_SALE' },
        ],
      },
    };
    expect(parseMusinsa(raw).map((d) => d.soldOut)).toEqual([true, false]);
  });

  it('구조가 다르거나 실패 응답이면 빈 배열', () => {
    expect(parseMusinsa(null)).toEqual([]);
    expect(parseMusinsa('<html>차단</html>')).toEqual([]);
    expect(parseMusinsa({ meta: { result: 'FAIL' }, data: null })).toEqual([]);
    expect(parseMusinsa({ data: {} })).toEqual([]);
  });
});

describe('parseMusinsaCampaign', () => {
  it('캠페인 이름·종료 시각과 "특가" 탭의 모듈을 읽는다', () => {
    const campaign = parseMusinsaCampaign(meta);
    expect(campaign?.name).toBe('무진장 26 겨울 블랙프라이데이');
    expect(campaign?.endsAt).toBe('2026-12-03T00:00:00+09:00');
    expect(campaign?.modules).toHaveLength(16);
    expect(campaign?.modules[1]).toEqual({
      uuid: '01a1a6e2-798c-7774-9b13-295239702aae',
      title: '시그니처특가',
      focusId: 'signatureItem',
    });
  });

  it('읽지 못하면 null', () => {
    expect(parseMusinsaCampaign({ meta: { result: 'SUCCESS' }, data: {} })).toBeNull();
  });
});

describe('parseMusinsaModule', () => {
  it('모듈 종류·제목·종료 시각과 탭별 상품 주소를 읽는다', () => {
    const mod = parseMusinsaModule(moduleJson);
    expect(mod?.type).toBe('GOODS_MIXED');
    expect(mod?.title).toBe('시그니처특가');
    expect(mod?.focusId).toBe('signatureItem');
    expect(mod?.endsAt).toBe('2026-12-03T00:00:00+09:00');
    expect(mod?.tabs.map((t) => t.name)).toEqual(['전체', '아우터', '상의', '바지']);
    expect(mod?.tabs[1].goodsUrl).toBe(
      'https://api.musinsa.com/api2/cpcms/cpcms/v3/MUSINSA/mujinjangwinter2026/modules/01a1a6e2-798c-7774-9b13-295239702aae/tabs/01a1a6e2-7983-7c19-98a6-2757a261b464/goods?startIndex=0&offset=36&countryCode=KR&locale=ko-KR&targetDate=202611272200',
    );
  });
});

describe('musinsa.crawl', () => {
  function fakeContext() {
    const urls: string[] = [];
    const ctx: CrawlContext = {
      fetchHtml: async () => {
        throw new Error('fetchHtml은 쓰지 않는다');
      },
      fetchJson: async <T,>(url: string) => {
        urls.push(url);
        if (url.endsWith('/meta')) return meta as T;
        if (url.includes('/goods?')) return goods as T;
        // 시그니처특가만 상품 모듈, 나머지는 쿠폰 모듈인 것으로 흉내
        if (url.includes('/modules/01a1a6e2-798c')) return moduleJson as T;
        return { meta: { result: 'SUCCESS' }, data: { moduleType: 'LINK_COUPON', content: {} } } as T;
      },
      evalPage: async () => {
        throw new Error('evalPage는 쓰지 않는다');
      },
      log: () => {},
      signal: new AbortController().signal,
    };
    return { ctx, urls };
  }

  it('행사 → 모듈 → 카테고리 탭 순서로 읽고 카테고리·기획전을 채운다', async () => {
    const { ctx, urls } = fakeContext();
    const deals = await musinsa.crawl(ctx);

    expect(urls[0]).toBe('https://api.musinsa.com/api2/cpcms/cpcms/v3/MUSINSA/mujinjangwinter2026/meta');
    expect(urls.length).toBeLessThanOrEqual(musinsa.maxRequests);
    // "전체" 탭은 건너뛰고 아우터·상의·바지 3개 탭 × 13개
    expect(urls.filter((u) => u.includes('/goods?'))).toHaveLength(3);
    expect(deals).toHaveLength(39);
    expect(deals[0].rawCategory).toBe('아우터');
    expect(deals[0].event).toEqual({
      name: '무진장 26 겨울 블랙프라이데이 · 시그니처특가',
      url: 'https://www.musinsa.com/campaign/mujinjangsale/special#signatureItem',
      endsAt: '2026-12-03T00:00:00+09:00',
    });
  });

  it('캠페인 정보를 못 읽으면 빈 배열', async () => {
    const { ctx } = fakeContext();
    ctx.fetchJson = async <T,>() => ({ meta: { result: 'FAIL' }, data: null }) as T;
    expect(await musinsa.crawl(ctx)).toEqual([]);
  });
});

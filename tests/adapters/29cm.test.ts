import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CrawlContext } from '@/lib/types';
import { cm29, has29cmNextPage, parse29cm, parse29cmCollections } from '@/crawler/adapters/29cm';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/sites/29cm/${name}`, import.meta.url), 'utf8'));

const collections = fixture('collections.json');
const products = fixture('products-outer.json');

describe('parse29cm', () => {
  const deals = parse29cm(products);

  it('fixture에서 10개 이상 읽는다', () => {
    expect(deals.length).toBeGreaterThanOrEqual(10);
    expect(deals).toHaveLength(20);
  });

  it('필수 필드가 모두 있고 가격은 숫자(원)다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://www.29cm.co.kr/products/${d.siteProductId}`);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.originalPrice).toBeGreaterThanOrEqual(d.salePrice);
      expect(d.imageUrl).toMatch(/^https:\/\//);
      expect(d.rawCategory).toMatch(/^여성의류 > 아우터 > /);
    }
  });

  it('사이트 값을 그대로 옮긴다', () => {
    // 2026-11-27 상품 페이지 표시: "339,000원 28% 243,750원"
    expect(deals[0]).toEqual({
      siteProductId: '4338084',
      name: '[우시은 PICK]Toggle reversible mustang [TIWT06MU01]_Brown',
      brand: '틸아이다이',
      url: 'https://www.29cm.co.kr/products/4338084',
      imageUrl: 'https://img.29cm.co.kr/item/202611/11f1dbd7d4409671b5d9b78d7d8557d8.jpg',
      originalPrice: 339000,
      salePrice: 243750,
      displayedDiscountRate: 28,
      endsAt: null,
      rawCategory: '여성의류 > 아우터 > 무스탕',
      rawGender: null,
      soldOut: false,
      event: null,
    });
  });

  it('카테고리가 여러 개면 첫 번째를 쓴다', () => {
    expect(deals.find((d) => d.siteProductId === '4338075')?.rawCategory).toBe('여성의류 > 아우터 > 하프코트');
  });

  it('넘겨받은 기획전을 모든 상품에 붙인다', () => {
    const event = { name: '기획전', url: 'https://www.29cm.co.kr/x', endsAt: '2026-11-29T23:59:00.000+09:00' };
    expect(parse29cm(products, { event }).every((d) => d.event === event)).toBe(true);
  });

  it('빠진 값은 null, 필수 값이 없는 상품은 버린다', () => {
    const raw = {
      result: 'SUCCESS',
      data: {
        resultList: [
          { productId: 1, productName: '최소 상품', lastSalePrice: '12,900원', soldOut: true },
          { productId: 2, productName: '가격 없음' },
          { productName: '번호 없음', lastSalePrice: 1000 },
        ],
      },
    };
    expect(parse29cm(raw)).toEqual([
      {
        siteProductId: '1',
        name: '최소 상품',
        brand: null,
        url: 'https://www.29cm.co.kr/products/1',
        imageUrl: null,
        originalPrice: null,
        salePrice: 12900,
        displayedDiscountRate: null,
        endsAt: null,
        rawCategory: null,
        rawGender: null,
        soldOut: true,
        event: null,
      },
    ]);
  });

  it('구조가 다르거나 실패 응답이면 빈 배열', () => {
    expect(parse29cm(null)).toEqual([]);
    expect(parse29cm('<html>차단</html>')).toEqual([]);
    expect(parse29cm({ result: 'FAIL', data: null, errorCode: 'AUTHORIZATION_EXCEPTION' })).toEqual([]);
    expect(parse29cm({ result: 'SUCCESS', data: {} })).toEqual([]);
  });
});

describe('parse29cmCollections', () => {
  it('기획전 제목·종료 시각과 카테고리 그룹을 읽는다', () => {
    expect(parse29cmCollections(collections)).toEqual([
      {
        id: 30759,
        title: '최대 ~57+30% 혜택',
        endsAt: '2026-11-29T23:59:00.000+09:00',
        groups: [
          { id: 284266, title: '전체' },
          { id: 284267, title: '아우터' },
          { id: 284268, title: '상의' },
          { id: 284269, title: '하의' },
          { id: 284270, title: '기타' },
        ],
      },
    ]);
  });

  it('읽지 못하면 빈 배열', () => {
    expect(parse29cmCollections({ result: 'FAIL', data: null })).toEqual([]);
  });
});

describe('cm29.crawl', () => {
  function fakeContext() {
    const urls: string[] = [];
    const lastPage = { result: 'SUCCESS', data: { resultList: [], pageNumber: 1, hasNext: false } };
    const ctx: CrawlContext = {
      fetchHtml: async () => {
        throw new Error('fetchHtml은 쓰지 않는다');
      },
      fetchJson: async <T,>(url: string) => {
        urls.push(url);
        if (url.includes('/collections?')) return collections as T;
        // 첫 페이지는 fixture(hasNext: true), 다음 페이지는 빈 마지막 페이지
        return (url.includes('page=0') ? products : lastPage) as T;
      },
      evalPage: async () => {
        throw new Error('evalPage는 쓰지 않는다');
      },
      log: () => {},
      signal: new AbortController().signal,
    };
    return { ctx, urls };
  }

  it('기획전 → 카테고리 그룹 → 페이지 순서로 읽고 기획전을 채운다', async () => {
    const { ctx, urls } = fakeContext();
    const deals = await cm29.crawl(ctx);

    expect(urls[0]).toBe(
      'https://content-api.29cm.co.kr/api/v4/framers/proxy/content-api/api/v4/collections?collectionIds=30759',
    );
    expect(has29cmNextPage(products)).toBe(true);
    // "전체" 그룹은 건너뛰고 4개 그룹 × 2페이지 + 목록 1번
    expect(urls).toHaveLength(9);
    expect(urls.some((u) => u.includes('/product-groups/284266/'))).toBe(false);
    expect(urls.length).toBeLessThanOrEqual(cm29.maxRequests);
    expect(deals).toHaveLength(80);
    expect(deals[0].event).toEqual({
      name: '29 DAY · 최대 ~57+30% 혜택',
      url: 'https://www.29cm.co.kr/content/campaign/2026/11/29-day/teasing',
      endsAt: '2026-11-29T23:59:00.000+09:00',
    });
  });

  it('기획전 정보를 못 읽으면 빈 배열', async () => {
    const { ctx } = fakeContext();
    ctx.fetchJson = async <T,>() => ({ result: 'FAIL', data: null }) as T;
    expect(await cm29.crawl(ctx)).toEqual([]);
  });
});

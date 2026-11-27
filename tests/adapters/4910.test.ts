import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse4910 } from '@/crawler/adapters/4910';

const html = readFileSync('fixtures/sites/4910/home.html', 'utf8');

describe('parse4910', () => {
  const deals = parse4910(html, 'https://4910.kr');

  it('홈 fixture에서 10개 이상 읽는다', () => {
    expect(deals.length).toBeGreaterThanOrEqual(10);
  });

  it('필수 필드가 있고 가격은 숫자(원)다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://4910.kr/goods/${d.siteProductId}`);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.imageUrl).toMatch(/^https:\/\//);
      expect(d.displayedDiscountRate).toBeGreaterThanOrEqual(1);
      expect(d.displayedDiscountRate).toBeLessThanOrEqual(99);
    }
  });

  it('상품 ID가 겹치지 않는다', () => {
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(deals.length);
  });

  it('fixture 첫 카드 값을 그대로 읽는다', () => {
    const card = deals.find((d) => d.siteProductId === '53423835');
    expect(card).toMatchObject({
      brand: '프릭스스토어',
      name: '프릭스스토어 릴렉스핏 나일론 플리스 리버시블 블루종 7컬러 1251248900748',
      salePrice: 68970,
      displayedDiscountRate: 48,
      originalPrice: null,
    });
  });

  it('"N" 신상 배지를 브랜드로 착각하지 않는다', () => {
    for (const d of deals) expect(d.brand).not.toBe('N');
  });

  it('할인율이 없는 카드는 행사 상품으로 보지 않는다', () => {
    const card = '<a href="/goods/1"><img src="https://x/y.jpg"><p>브랜드</p><p>상품</p><p>10,000</p></a>';
    expect(parse4910(`<html><body>${card}</body></html>`)).toEqual([]);
  });

  it('구조를 못 찾으면 빈 배열', () => {
    expect(parse4910('<html><body><p>점검 중</p></body></html>')).toEqual([]);
  });
});

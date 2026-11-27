import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseQueenit } from '@/crawler/adapters/queenit';

const PAGE = 'https://web.queenit.kr/collection/COLL261006221807d8979';
const html = readFileSync('fixtures/sites/queenit/collection.html', 'utf8');

describe('parseQueenit', () => {
  const deals = parseQueenit(html, PAGE, { name: '퀸잇 기획전', url: PAGE, endsAt: null });

  it('기획전 fixture에서 10개 이상 읽는다', () => {
    expect(deals.length).toBeGreaterThanOrEqual(10);
  });

  it('필수 필드가 있고 가격은 숫자(원)다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^[0-9a-f]{32}$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://web.queenit.kr/product/${d.siteProductId}`);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.imageUrl).toMatch(/^https:\/\//);
      expect(d.event?.url).toBe(PAGE);
    }
  });

  it('상품 ID가 겹치지 않는다', () => {
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(deals.length);
  });

  it('fixture 첫 카드 값을 그대로 읽는다', () => {
    const first = deals.find((d) => d.siteProductId === 'bf0637c0bd8327b1aa2b73ee638dfb1c');
    expect(first).toMatchObject({ brand: '몽벨', name: '남성 헤비 패딩 자켓', salePrice: 76500, displayedDiscountRate: 77, originalPrice: null });
  });

  it('할인율은 사이트 표시값(0~99)이거나 null이다', () => {
    for (const d of deals) {
      if (d.displayedDiscountRate == null) continue;
      expect(d.displayedDiscountRate).toBeGreaterThanOrEqual(0);
      expect(d.displayedDiscountRate).toBeLessThanOrEqual(99);
    }
  });

  it('"할인 전" 문구가 있으면 정가도 읽는다', () => {
    const card =
      '<div><a href="/product/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?newWindow=true#top"></a><div>' +
      '<img src="https://image.queenit.kr/x.png">' +
      '<div class="MuiTypography-root MuiTypography-SpecificProductItemBrand">몽벨</div>' +
      '<div class="MuiTypography-root MuiTypography-SpecificProductItemProductName">남성 튜브 테크 자켓</div>' +
      '<span data-visually-hidden="true">62,910원, 할인율 78%, 할인 전 298,000원</span></div></div>';
    expect(parseQueenit(`<html><body>${card}</body></html>`)).toEqual([
      expect.objectContaining({ salePrice: 62910, displayedDiscountRate: 78, originalPrice: 298000, soldOut: false }),
    ]);
  });

  it('구조를 못 찾으면 빈 배열', () => {
    expect(parseQueenit('<html><body><p>점검 중</p></body></html>')).toEqual([]);
  });
});

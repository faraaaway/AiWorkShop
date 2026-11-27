import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePosty, parsePostyEventInfo, parsePostyEventLinks, pickPostyEvents } from '@/crawler/adapters/posty';

const EVENT = 'https://posty.kr/events/cms/5e77cd50-082c-4bce-a6a5-78403928c003';
const eventHtml = readFileSync('fixtures/sites/posty/event.html', 'utf8');
const homeHtml = readFileSync('fixtures/sites/posty/home.html', 'utf8');

describe('parsePostyEventLinks', () => {
  const links = parsePostyEventLinks(homeHtml);

  it('홈에서 기획전 주소를 중복 없이 읽는다', () => {
    expect(links.length).toBeGreaterThanOrEqual(10);
    expect(new Set(links.map((l) => l.url)).size).toBe(links.length);
    for (const l of links) expect(l.url).toMatch(/^https:\/\/posty\.kr\/events\/cms\/[0-9a-f-]{36}$/);
  });

  it('블프 기획전 배너 문구가 붙어 있다', () => {
    const bf = links.find((l) => l.url === EVENT);
    expect(bf?.title).toContain('블프');
  });
});

describe('pickPostyEvents', () => {
  const picked = pickPostyEvents(parsePostyEventLinks(homeHtml));

  it('블프 문구가 있는 기획전만, 최대 5개 고른다', () => {
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(5);
    for (const e of picked) expect(e.title).toMatch(/블프|블랙\s*프라이데이/);
    expect(picked.map((e) => e.url)).toContain(EVENT);
  });

  it('뷰티·리빙 기획전은 뺀다', () => {
    for (const e of picked) expect(e.title).not.toMatch(/뷰티|리빙/);
    expect(pickPostyEvents([{ url: 'https://posty.kr/events/cms/x', title: '블프 할인 종료임박 뷰티&리빙 연합전' }])).toEqual([]);
  });
});

describe('parsePostyEventInfo', () => {
  it('기획전 제목과 종료 시각(KST)을 읽는다', () => {
    expect(parsePostyEventInfo(eventHtml, EVENT)).toEqual({
      name: '[블프] 여성 TOP 브랜드',
      url: EVENT,
      endsAt: '2026-11-29T23:59:59+09:00', // date_ended 1795964399999
    });
  });

  it('정보가 없으면 null', () => {
    expect(parsePostyEventInfo('<html><body></body></html>', EVENT)).toBeNull();
  });
});

describe('parsePosty', () => {
  const deals = parsePosty(eventHtml, EVENT);

  it('기획전 fixture에서 10개 이상 읽는다', () => {
    expect(deals.length).toBeGreaterThanOrEqual(10);
  });

  it('필수 필드가 있고 가격은 숫자(원)다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://posty.kr/products/${d.siteProductId}`);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.imageUrl).toMatch(/^https:\/\//);
      expect(d.event?.name).toBe('[블프] 여성 TOP 브랜드');
    }
  });

  it('상품 ID가 겹치지 않는다', () => {
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(deals.length);
  });

  it('배지 글자를 브랜드·가격으로 착각하지 않는다', () => {
    for (const d of deals) {
      expect(d.brand).not.toMatch(/^(블프|최저가도전|쿠폰할인가|블프 종료시)$/);
      expect(d.name).not.toMatch(/^(블프|쿠폰할인가)$/);
    }
  });

  it('홈 카드 값을 그대로 읽는다', () => {
    const home = parsePosty(homeHtml, 'https://posty.kr', null);
    const card = home.find((d) => d.siteProductId === '165564519');
    expect(card).toMatchObject({
      brand: '올리비아로렌',
      name: '니트 밴딩 패딩 팬츠_VVCDL4WA271',
      salePrice: 39900,
      displayedDiscountRate: 85,
      originalPrice: null,
      event: null,
    });
  });

  it('구조를 못 찾으면 빈 배열', () => {
    expect(parsePosty('<html><body><p>점검 중</p></body></html>')).toEqual([]);
  });
});

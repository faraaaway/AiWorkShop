import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildZigzagProductsRequest,
  orderZigzagGroups,
  parseZigzagEvent,
  parseZigzagEventLinks,
  parseZigzagNextCursor,
  parseZigzagProducts,
  pickZigzagEvents,
  zigzag,
} from '@/crawler/adapters/zigzag';
import { BlockedError, getCrawlErrorKind, RequestLimitError } from '@/lib/errors';
import { createFakeContext } from '../helpers/fakeContext';

const read = (name: string): string =>
  readFileSync(new URL(`../../fixtures/sites/zigzag/${name}`, import.meta.url), 'utf8');

const homeHtml = read('home.html');
const eventHtml = read('event-c8c6aabf.html');
const productsJson: unknown = JSON.parse(read('products-93fa1f0c-group0.json'));
const capturedRequest = JSON.parse(read('products-request.json')) as {
  url: string;
  headers: Record<string, string>;
  body: { query: string; variables: unknown };
};

const EVENT_UUID = 'c8c6aabf-766f-4df2-879f-fea9703ca08b';
const EVENT_URL = `https://zigzag.kr/events/${EVENT_UUID}`;
const PRESET = '93fa1f0c-9604-4ba1-a415-cbfdc35bebcb';
/** fixture를 받은 시각 */
const CAPTURED_AT = new Date('2026-11-28T01:05:00+09:00');
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

interface RawItem {
  shop: unknown;
  product: { catalog_product_id: string; price: number; max_price_with_currency: { price_without_decimal: number } };
}
interface RawList extends Record<string, unknown> {
  item_list: RawItem[];
}
const rawList = (productsJson as { data: { cms_products_preset_product_card_item_list: RawList } }).data
  .cms_products_preset_product_card_item_list;

/** fixture 첫 상품을 바탕으로 일부 값만 바꾼 응답 */
function responseWith(product: Record<string, unknown>, list: Record<string, unknown> = {}): unknown {
  const first = rawList.item_list[0];
  return {
    data: {
      cms_products_preset_product_card_item_list: {
        ...rawList,
        ...list,
        item_list: [{ shop: first.shop, product: { ...first.product, ...product } }],
      },
    },
  };
}

/** __NEXT_DATA__에 조회 결과 하나만 담은 최소 페이지 */
function pageWith(queryKey: unknown[], data: unknown): string {
  const next = { props: { pageProps: { dehydratedState: { queries: [{ queryKey, state: { data } }] } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`;
}

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-28T12:00:00+09:00');

/** 화면 구성만 바꿔 가며 쓰는 최소 기획전 페이지 */
function eventWith(editor: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return pageWith(['getCmsContentEditor', 'x'], { title: '행사', date_ended: 1796482799999, content_editor_json: editor, ...extra });
}

const rail = (preset: string, titles: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  __type: 'ProductRail',
  products_preset_uuid: preset,
  group_header_data: titles,
  ...extra,
});

describe('parseZigzagEventLinks', () => {
  const links = parseZigzagEventLinks(homeHtml);

  it('홈 배너에서 기획전 주소를 읽는다', () => {
    expect(links.length).toBeGreaterThanOrEqual(50);
    for (const link of links) {
      expect(link.uuid).toMatch(UUID);
      expect(link.url).toBe(`https://zigzag.kr/events/${link.uuid}`);
      expect(link.title.length).toBeGreaterThan(0);
    }
  });

  it('같은 기획전은 한 번만, 기획전이 아닌 배너(래플·수험표)는 뺀다', () => {
    expect(new Set(links.map((l) => l.uuid)).size).toBe(links.length);
    expect(links.some((l) => /raffle|suneung/.test(l.url))).toBe(false);
  });

  it('배너 문구 세 줄을 이어 제목으로 쓴다', () => {
    expect(links.find((l) => l.uuid === EVENT_UUID)).toEqual({
      uuid: EVENT_UUID,
      url: EVENT_URL,
      title: '겨울 블프 SPA데이 99% 최저가 골라담기 미쏘 · 스파오 外 최대 30% 쿠폰 + 중복쿠폰까지',
    });
  });

  it('구조를 못 찾으면 빈 배열', () => {
    expect(parseZigzagEventLinks('')).toEqual([]);
    expect(parseZigzagEventLinks('<html><body><p>점검 중</p></body></html>')).toEqual([]);
    expect(parseZigzagEventLinks('<script id="__NEXT_DATA__">{"props":</script>')).toEqual([]);
    expect(parseZigzagEventLinks(pageWith(['banner', 'list'], { item_list: { a: 1 } }))).toEqual([]);
    expect(parseZigzagEventLinks(pageWith(['banner', 'list'], { item_list: [null, 3, { landing_url: 7 }] }))).toEqual([]);
  });

  it('지그재그 기획전 주소가 아닌 배너는 뺀다', () => {
    const banner = (landing_url: string): unknown => ({ landing_url, main_title_first: '블프' });
    const html = pageWith(['banner', 'list'], {
      item_list: [
        banner(`zigzag://open/simple_browser?url=https%3A%2F%2Fexample.com%2Fevents%2F${P1}`),
        banner(`zigzag://open/simple_browser?url=https%3A%2F%2Fstore.zigzag.kr%2Fevents%2F${P2}%23top&features=ct`),
        banner('zigzag://open/simple_browser?url=%E0%A4%A'),
      ],
    });

    expect(parseZigzagEventLinks(html)).toEqual([{ uuid: P2, url: `https://zigzag.kr/events/${P2}`, title: '블프' }]);
  });
});

describe('pickZigzagEvents', () => {
  const links = parseZigzagEventLinks(homeHtml);
  const link = (title: string): { uuid: string; url: string; title: string } => ({ uuid: P1, url: `https://zigzag.kr/events/${P1}`, title });

  it('블프 문구가 있는 기획전만, 의류가 아닌 것은 빼고 고른다', () => {
    const picked = pickZigzagEvents(links, 100);

    expect(picked.length).toBeGreaterThanOrEqual(5);
    expect(picked.some((l) => l.uuid === EVENT_UUID)).toBe(true);
    const titles = picked.map((l) => l.title).join('\n');
    expect(titles).not.toMatch(/뷰티크 블프|라이프 직잭팟|직잭팟 래플|쿠폰 뽑기/);
    expect(titles).not.toContain('밀잇 브랜드위크');
  });

  it('문구별로 고르는 기준', () => {
    const titles = [
      '겨울 블프 SPA데이',
      '라룸 블랙프라이데이 혜택',
      '메리어라운드 BLACK FRIDAY 30% 쿠폰 받기',
      '코코블랑 직잭팟 특가',
      '밀잇 브랜드위크 ~45% 할인',
      '뷰티크 블프 최대혜택 중',
      '라이프 직잭팟 특가',
      '직잭팟 래플 샤넬 플랩백',
      '블프 99% 쿠폰 뽑기',
    ];

    expect(pickZigzagEvents(titles.map(link), 100).map((l) => l.title)).toEqual(titles.slice(0, 4));
  });

  it('최대 개수를 넘지 않고 홈 순서를 지킨다', () => {
    const picked = pickZigzagEvents(links, 3);

    expect(picked).toHaveLength(3);
    expect(picked).toEqual(pickZigzagEvents(links, 100).slice(0, 3));
  });
});

describe('parseZigzagEvent', () => {
  const page = parseZigzagEvent(eventHtml, EVENT_URL, CAPTURED_AT);

  it('기획전 이름과 종료 시각을 읽는다', () => {
    expect(page?.event).toEqual({
      name: '브랜드 직잭팟 특가',
      url: EVENT_URL,
      endsAt: '2026-12-05T23:59:59+09:00',
    });
  });

  it('지금 보이는 상품 모듈의 그룹(탭)을 화면 순서로 읽는다', () => {
    expect(page?.groups).toHaveLength(105);
    expect(page?.groups[0]).toEqual({
      presetUuid: '6dab6548-542b-49ee-82c4-80559ddbce9a',
      groupIndex: 0,
      name: '전체',
      totalCount: 717,
      moduleType: 'ProductRail',
    });
    expect(page?.groups).toContainEqual({
      presetUuid: PRESET,
      groupIndex: 0,
      name: '단독 상품 더보기',
      totalCount: 322,
      moduleType: 'ProductList',
    });
    expect(page?.groups).toContainEqual({
      presetUuid: 'a3f2bf43-43bd-4bee-b6e3-2ed7301c7ed2',
      groupIndex: 6,
      name: '슈즈',
      totalCount: 765,
      moduleType: 'ProductTab',
    });
  });

  it('상품 묶음(preset)이 없는 추천 모듈과 개수를 모르는 그룹을 구분한다', () => {
    for (const group of page?.groups ?? []) expect(group.presetUuid).toMatch(UUID);
    expect(page?.groups).toContainEqual({
      presetUuid: '6dab6548-542b-49ee-82c4-80559ddbce9a',
      groupIndex: 8,
      name: '탑텐',
      totalCount: null,
      moduleType: 'ProductRail',
    });
  });

  it('노출 기간이 지난 모듈은 뺀다', () => {
    const later = parseZigzagEvent(eventHtml, EVENT_URL, new Date('2027-01-10T00:00:00+09:00'));

    expect(later?.event.name).toBe('브랜드 직잭팟 특가');
    expect(later?.groups.some((g) => g.presetUuid === PRESET)).toBe(false);
    expect(later?.groups.length).toBeLessThan(105);
  });

  it('구조를 못 찾으면 null', () => {
    expect(parseZigzagEvent('', EVENT_URL, CAPTURED_AT)).toBeNull();
    expect(parseZigzagEvent('<html><body><p>점검 중</p></body></html>', EVENT_URL, CAPTURED_AT)).toBeNull();
    expect(parseZigzagEvent(homeHtml, EVENT_URL, CAPTURED_AT)).toBeNull();
    expect(parseZigzagEvent('<script id="__NEXT_DATA__">{"props":</script>', EVENT_URL, CAPTURED_AT)).toBeNull();
    expect(parseZigzagEvent(pageWith(['getCmsContentEditor'], { title: '행사' }), EVENT_URL, NOW)).toBeNull();
    expect(parseZigzagEvent(eventWith({ component_map: [], component_relations: [] }), EVENT_URL, NOW)).toBeNull();
  });

  it('화면 구성이 이상해도 던지지 않고 읽을 수 있는 것만 읽는다', () => {
    const broken = eventWith({
      component_map: { a: rail(P1, ['아우터', null, 7, { title: ' 슈즈 ' }, {}]), b: 'x', c: rail(P2, 'nope' as unknown as unknown[]) },
      component_relations: [null, 'a', { uuid: 'b' }, { uuid: 'missing' }, { uuid: '__proto__' }, { uuid: 'c' }, { uuid: 'a', children: { uuid: 'c' } }],
    });

    expect(parseZigzagEvent(broken, EVENT_URL, NOW)?.groups.map((g) => [g.presetUuid, g.groupIndex, g.name])).toEqual([
      [P1, 0, '아우터'],
      [P1, 1, null],
      [P1, 2, null],
      [P1, 3, '슈즈'],
      [P1, 4, null],
    ]);
    expect(parseZigzagEvent(eventWith({ component_map: {}, component_relations: {} }), EVENT_URL, NOW)?.groups).toEqual([]);
  });

  it('종료 시각이 없거나 날짜로 바꿀 수 없으면 null', () => {
    const editor = { component_map: {}, component_relations: [] };

    for (const date_ended of [null, 0, -1, 1e16, Number.MAX_SAFE_INTEGER, '1796482799999']) {
      expect(parseZigzagEvent(eventWith(editor, { date_ended }), EVENT_URL, NOW)?.event.endsAt).toBeNull();
    }
    expect(parseZigzagEvent(eventWith(editor), EVENT_URL, NOW)?.event.endsAt).toBe('2026-12-05T23:59:59+09:00');
  });

  it('상품 묶음이 없는 추천 모듈은 그룹을 만들지 않는다', () => {
    const html = eventWith({
      component_map: {
        rec: rail('display_recommendation', ['추천'], { display_type: 'display_recommendation' }),
        none: { __type: 'ProductRail', group_header_data: ['전체'] },
        ok: rail(P1, ['전체']),
      },
      component_relations: [{ uuid: 'rec' }, { uuid: 'none' }, { uuid: 'ok' }],
    });

    expect(parseZigzagEvent(html, EVENT_URL, NOW)?.groups.map((g) => g.presetUuid)).toEqual([P1]);
    expect(eventHtml).toContain('"products_preset_uuid":"display_recommendation"');
  });

  it('노출 기간: 시작 전·끝난 뒤는 빼고, 경계 시각은 넣고, 한쪽이 null이면 열려 있다', () => {
    const t = NOW.getTime();
    const visible = (range: unknown): number => {
      const html = eventWith({
        component_map: { m: rail(P1, ['전체'], { visible_between: range }) },
        component_relations: [{ uuid: 'm' }],
      });
      return parseZigzagEvent(html, EVENT_URL, NOW)?.groups.length ?? -1;
    };

    expect(visible([t + 1, t + 1000])).toBe(0);
    expect(visible([t - 1000, t - 1])).toBe(0);
    expect(visible([t, t + 1000])).toBe(1);
    expect(visible([t - 1000, t])).toBe(1);
    expect(visible([null, t + 1000])).toBe(1);
    expect(visible([t - 1000, null])).toBe(1);
    expect(visible([null, t - 1])).toBe(0);
    expect(visible(undefined)).toBe(1);
  });

  it('숨겨진 탭 안의 모듈은 보이지 않고, 보이는 탭 안의 모듈은 보인다', () => {
    const t = NOW.getTime();
    const html = eventWith({
      component_map: {
        hiddenTab: { __type: 'TabContent', visible_between: [t - 2000, t - 1000] },
        shownTab: { __type: 'TabContent', visible_between: [t - 1000, t + 1000] },
        inHidden: rail(P1, ['전체']),
        inShown: rail(P2, ['전체']),
      },
      component_relations: [
        { uuid: 'hiddenTab', children: [{ uuid: 'inHidden' }] },
        { uuid: 'shownTab', children: [{ uuid: 'inShown' }] },
      ],
    });

    expect(parseZigzagEvent(html, EVENT_URL, NOW)?.groups.map((g) => g.presetUuid)).toEqual([P2]);
  });

  it('같은 묶음·그룹이 여러 모듈에 있으면 화면에서 먼저 나온 것만 남긴다', () => {
    const html = eventWith({
      component_map: { first: rail(P1, ['먼저', '둘째']), again: { ...rail(P1, ['나중']), __type: 'ProductList' } },
      component_relations: [{ uuid: 'first' }, { uuid: 'again' }],
    });

    expect(parseZigzagEvent(html, EVENT_URL, NOW)?.groups).toEqual([
      { presetUuid: P1, groupIndex: 0, name: '먼저', totalCount: null, moduleType: 'ProductRail' },
      { presetUuid: P1, groupIndex: 1, name: '둘째', totalCount: null, moduleType: 'ProductRail' },
    ]);
  });

  it('그룹별 상품 수는 자리(group_index)를 맞춰 읽고, 이상한 항목은 무시한다', () => {
    const html = eventWith(
      {
        component_map: { m: rail(P1, ['a', 'b', 'c'], { total_count_list: [null, { total_count: 20 }, { total_count: 30 }] }) },
        component_relations: [{ uuid: 'm' }],
      },
      {
        web_rendering_metadata: {
          product_preset_item_count: [
            { uuid: P1, group_index: '2', total_count: 33 },
            { uuid: P1, group_index: null, total_count: 99 },
            { uuid: P1, group_index: '', total_count: 98 },
            { uuid: null, group_index: '0', total_count: 97 },
            { uuid: P1, group_index: '1', total_count: '21' },
            'junk',
          ],
        },
      },
    );

    expect(parseZigzagEvent(html, EVENT_URL, NOW)?.groups.map((g) => g.totalCount)).toEqual([null, 20, 33]);
  });
});

describe('buildZigzagProductsRequest', () => {
  it('실제로 응답을 받은 요청과 같은 주소·헤더·본문을 만든다', () => {
    const request = buildZigzagProductsRequest({ presetUuid: PRESET, groupIndex: 0 });

    expect(request.url).toBe(capturedRequest.url);
    // Content-Type은 ctx.postJson이 붙인다.
    expect({ 'Content-Type': 'application/json', ...request.headers }).toEqual(capturedRequest.headers);
    expect(request.body).toEqual(capturedRequest.body);
  });

  it('다음 쪽 커서와 쪽 크기를 input에 넣는다', () => {
    const request = buildZigzagProductsRequest({ presetUuid: PRESET, groupIndex: 2 }, { after: 'CURSOR', limit: 60 });

    expect(request.body.variables).toEqual({
      input: { products_preset_uuid: PRESET, group_index: 2, after: 'CURSOR', limit: 60 },
    });
  });
});

describe('parseZigzagProducts', () => {
  const event = { name: '브랜드 직잭팟 특가', url: EVENT_URL, endsAt: '2026-12-05T23:59:59+09:00' };
  const deals = parseZigzagProducts(productsJson, { rawCategory: '아우터', event });

  it('fixture에서 10개 이상 읽는다', () => {
    expect(deals).toHaveLength(15);
  });

  it('필수 필드가 있고 가격은 숫자(원)다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://zigzag.kr/catalog/products/${d.siteProductId}`);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.imageUrl).toMatch(/^https:\/\//);
      expect(d.event).toEqual(event);
      expect(d.rawCategory).toBe('아우터');
    }
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(deals.length);
  });

  it('사이트 값을 그대로 옮긴다', () => {
    expect(deals[0]).toEqual({
      siteProductId: '172164329',
      name: '[백지헌PICK/단독컬러💖][신세틱레더] 퍼배색 무스탕_SPJLG4VW01',
      brand: '스파오',
      url: 'https://zigzag.kr/catalog/products/172164329',
      imageUrl:
        'https://cf.product-image.s.zigzag.kr/original/d/2026/10/4/25938_202610041958441695_61981.gif?width=400&height=400&quality=80&format=jpeg',
      originalPrice: 99900,
      salePrice: 62930,
      displayedDiscountRate: 37,
      endsAt: null,
      rawCategory: '아우터',
      rawGender: '여성',
      soldOut: false,
      event,
    });
  });

  it('정가는 줄 그은 가격(max_price)이고, 판매가(price)가 아니다', () => {
    const deal = parseZigzagProducts(
      responseWith({
        price: 53000,
        max_price_with_currency: { currency: 'KRW', decimal: 0, price_without_decimal: 69000 },
        final_price: 32900,
        discount_rate: 52,
      }),
    )[0];

    expect(deal).toMatchObject({ originalPrice: 69000, salePrice: 32900, displayedDiscountRate: 52 });
  });

  it('fixture에도 판매가와 정가가 다른 상품이 있다', () => {
    const different = rawList.item_list.filter(
      (i) => i.product.price !== i.product.max_price_with_currency.price_without_decimal,
    );

    expect(different.length).toBeGreaterThan(0);
    for (const item of different) {
      const deal = deals.find((d) => d.siteProductId === item.product.catalog_product_id);
      expect(deal?.originalPrice).toBe(item.product.max_price_with_currency.price_without_decimal);
    }
  });

  it('기획전·카테고리를 안 주면 null', () => {
    const plain = parseZigzagProducts(productsJson);

    expect(plain[0].rawCategory).toBeNull();
    expect(plain[0].event).toBeNull();
  });

  it('할인율이 없으면 null', () => {
    expect(parseZigzagProducts(responseWith({ discount_rate: 0 }))[0].displayedDiscountRate).toBeNull();
    expect(parseZigzagProducts(responseWith({ discount_rate: null }))[0].displayedDiscountRate).toBeNull();
  });

  it('줄 그은 가격이 없으면 정가는 null이다 (판매가로 대신하지 않는다)', () => {
    const deal = parseZigzagProducts(responseWith({ price: 50000, max_price_with_currency: null }))[0];

    expect(deal.originalPrice).toBeNull();
    expect(deal.salePrice).toBe(62930);
  });

  it('품절은 soldOut, 판매 종료·국내 미판매 상품은 뺀다', () => {
    expect(parseZigzagProducts(responseWith({ sellable_status: 'SOLD_OUT' }))[0].soldOut).toBe(true);
    expect(parseZigzagProducts(responseWith({ sellable_status: 'CLOSED' }))).toEqual([]);
    expect(parseZigzagProducts(responseWith({ sellable_status: 'NOT_SUPPORT_COUNTRY' }))).toEqual([]);
  });

  it('모르는 판매 상태면 상품은 남기되 품절 여부는 비운다', () => {
    for (const sellable_status of ['SOMETHING_NEW', null]) {
      const found = parseZigzagProducts(responseWith({ sellable_status }));

      expect(found).toHaveLength(1);
      expect(found[0].soldOut).toBeUndefined();
    }
  });

  it('상품 번호가 숫자로 와도 읽고, 숫자가 아니면 건너뛴다', () => {
    expect(parseZigzagProducts(responseWith({ catalog_product_id: 172164329 }))[0]).toMatchObject({
      siteProductId: '172164329',
      url: 'https://zigzag.kr/catalog/products/172164329',
    });
    expect(parseZigzagProducts(responseWith({ catalog_product_id: '../cart?x=1' }))).toEqual([]);
    expect(parseZigzagProducts(responseWith({ catalog_product_id: 1.5 }))).toEqual([]);
  });

  it('이미지 주소가 절대 주소가 아니면 null', () => {
    expect(parseZigzagProducts(responseWith({ image_url: '//cf.product-image.s.zigzag.kr/a.jpg' }))[0].imageUrl).toBeNull();
    expect(parseZigzagProducts(responseWith({ image_url: '/a.jpg' }))[0].imageUrl).toBeNull();
    expect(parseZigzagProducts(responseWith({ image_url: null }))[0].imageUrl).toBeNull();
  });

  it('상품 번호·이름·판매가가 없는 항목은 건너뛴다', () => {
    expect(parseZigzagProducts(responseWith({ catalog_product_id: null }))).toEqual([]);
    expect(parseZigzagProducts(responseWith({ title: ' ' }))).toEqual([]);
    expect(parseZigzagProducts(responseWith({ final_price: null }))).toEqual([]);
    expect(parseZigzagProducts(responseWith({ final_price: '62,930' }))).toEqual([]);
  });

  it('오류 응답·빈 응답·이상한 모양이면 빈 배열', () => {
    const wrap = (value: unknown): unknown => ({ data: { cms_products_preset_product_card_item_list: value } });

    expect(parseZigzagProducts({ errors: [{ message: 'Field "limit_count" is not defined' }] })).toEqual([]);
    expect(parseZigzagProducts('')).toEqual([]);
    expect(parseZigzagProducts(null)).toEqual([]);
    expect(parseZigzagProducts('<html></html>')).toEqual([]);
    expect(parseZigzagProducts(wrap(null))).toEqual([]);
    expect(parseZigzagProducts(wrap({ item_list: { 0: {} } }))).toEqual([]);
    expect(parseZigzagProducts(wrap({ item_list: [null, 'x', {}, { product: 'x' }, { product: [] }] }))).toEqual([]);
  });

  it('JSON 문자열로 받아도 읽는다', () => {
    expect(parseZigzagProducts(JSON.stringify(productsJson))).toHaveLength(15);
  });
});

describe('parseZigzagNextCursor', () => {
  it('다음 쪽이 없으면 null', () => {
    expect(parseZigzagNextCursor(productsJson)).toBeNull();
    expect(parseZigzagNextCursor({ errors: [] })).toBeNull();
  });

  it('다음 쪽이 있으면 end_cursor', () => {
    expect(parseZigzagNextCursor(responseWith({}, { has_next_page: true, end_cursor: 'NEXT' }))).toBe('NEXT');
    expect(parseZigzagNextCursor(responseWith({}, { has_next_page: true, end_cursor: '' }))).toBeNull();
  });
});

describe('orderZigzagGroups', () => {
  const group = (presetUuid: string, groupIndex: number, moduleType: string, totalCount: number | null = 10) => ({
    presetUuid,
    groupIndex,
    name: `${moduleType}-${groupIndex}`,
    totalCount,
    moduleType,
  });

  it('카테고리 탭(ProductTab)을 먼저, 그다음 목록·레일 순으로, 묶음마다 한 그룹씩 번갈아 읽는다', () => {
    const ordered = orderZigzagGroups([
      group(P1, 0, 'ProductRail'),
      group(P1, 1, 'ProductRail'),
      group(P2, 0, 'ProductTab'),
      group(P2, 1, 'ProductTab'),
      group(PRESET, 0, 'ProductList'),
      group(EVENT_UUID, 0, 'ProductTab'),
      group(EVENT_UUID, 1, 'ProductTab'),
    ]);

    expect(ordered.map((g) => `${g.moduleType}:${g.presetUuid === P2 ? 'A' : 'B'}${g.groupIndex}`)).toEqual([
      'ProductTab:A0',
      'ProductTab:B0',
      'ProductTab:A1',
      'ProductTab:B1',
      'ProductList:B0',
      'ProductRail:B0',
      'ProductRail:B1',
    ]);
  });

  it('상품이 0개라고 적힌 그룹은 빼고, 개수를 모르는 그룹은 남긴다', () => {
    const ordered = orderZigzagGroups([group(P1, 0, 'ProductTab', 0), group(P1, 1, 'ProductTab', null)]);

    expect(ordered.map((g) => g.groupIndex)).toEqual([1]);
  });

  it('fixture 기획전에서는 카테고리 탭 두 개가 번갈아 나온다', () => {
    const groups = parseZigzagEvent(eventHtml, EVENT_URL, CAPTURED_AT)?.groups ?? [];

    expect(orderZigzagGroups(groups).slice(0, 5).map((g) => g.name)).toEqual(['아우터', '전체 BEST', '아우터', '상의', '직진 BEST']);
  });
});

describe('zigzag.crawl', () => {
  const HOME_URL = 'https://zigzag.kr';
  const EMPTY_PAGE = '<html><head><title></title></head><body><div id="__next"></div></body></html>';
  const SITE_HEADERS = { Origin: 'https://zigzag.kr', Referer: 'https://zigzag.kr/' };
  /** 홈 fixture에서 고르는 블프 기획전은 3개. 그중 fixture가 있는 것만 읽힌다. */
  const pages = (url: string): string => (url === HOME_URL ? homeHtml : url === EVENT_URL ? eventHtml : EMPTY_PAGE);
  const input = (body: unknown): Record<string, unknown> => (body as { variables: { input: Record<string, unknown> } }).variables.input;

  /** 부를 때마다 상품 번호가 다른 상품 count개를 돌려준다. */
  function uniqueProducts(count: number): () => unknown {
    let next = 1;
    const first = rawList.item_list[0];
    return () => ({
      data: {
        cms_products_preset_product_card_item_list: {
          ...rawList,
          item_list: Array.from({ length: count }, () => ({
            shop: first.shop,
            product: { ...first.product, catalog_product_id: String(next++) },
          })),
        },
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(CAPTURED_AT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('등록 정보: robots.txt 예외, 요청 상한 30 이하', () => {
    expect(zigzag).toMatchObject({ id: 'zigzag', displayName: '지그재그', homeUrl: HOME_URL, obeyRobots: false });
    expect(zigzag.maxRequests).toBeLessThanOrEqual(30);
  });

  it('홈 → 블프 기획전 → 그룹별 상품 목록(POST) 순서로 읽는다', async () => {
    const posts: { url: string; body: unknown; headers: unknown }[] = [];
    const htmlOptions: unknown[] = [];
    const ctx = createFakeContext({
      fetchHtml: (url, opts) => {
        htmlOptions.push(opts);
        return pages(url);
      },
      postJson: (url, body, opts) => {
        posts.push({ url, body, headers: opts?.headers });
        return productsJson;
      },
    });

    const deals = await zigzag.crawl(ctx);

    expect(ctx.urls.slice(0, 4)).toEqual([HOME_URL, ...pickZigzagEvents(parseZigzagEventLinks(homeHtml)).map((l) => l.url)]);
    expect(ctx.urls[2]).toBe(EVENT_URL);
    expect(htmlOptions).toEqual([{ raw: true }, { raw: true }, { raw: true }, { raw: true }]);
    expect(posts.length).toBeGreaterThan(0);
    for (const post of posts) {
      expect(post.url).toBe(capturedRequest.url);
      expect(post.headers).toEqual(SITE_HEADERS);
    }
    expect(posts[0].body).toEqual({
      query: capturedRequest.body.query,
      variables: { input: { products_preset_uuid: 'a3f2bf43-43bd-4bee-b6e3-2ed7301c7ed2', group_index: 0, after: null, limit: 50 } },
    });
    expect(deals).toHaveLength(15);
    expect(deals[0]).toMatchObject({
      siteProductId: '172164329',
      salePrice: 62930,
      rawCategory: '아우터',
      event: { name: '브랜드 직잭팟 특가', url: EVENT_URL, endsAt: '2026-12-05T23:59:59+09:00' },
    });
  });

  it('요청 상한을 다 쓰면 멈추고, 넘기지 않는다', async () => {
    const ctx = createFakeContext({ fetchHtml: pages, postJson: () => productsJson });

    const deals = await zigzag.crawl(ctx);

    expect(ctx.urls).toHaveLength(zigzag.maxRequests);
    expect(ctx.requestsLeft).toBe(0);
    expect(deals).toHaveLength(15);
  });

  it('요청 상한이 작으면 그 안에서 읽은 만큼만 돌려준다', async () => {
    const few = createFakeContext({ fetchHtml: pages, postJson: () => productsJson, maxRequests: 6 });
    const none = createFakeContext({ fetchHtml: pages, postJson: () => productsJson, maxRequests: 2 });

    expect(await zigzag.crawl(few)).toHaveLength(15);
    expect(few.urls).toHaveLength(6);
    expect(few.urls.filter((u) => u === capturedRequest.url)).toHaveLength(2);
    expect(await zigzag.crawl(none)).toEqual([]);
    expect(none.urls).toHaveLength(2);
  });

  it('같은 상품이 여러 그룹에 있으면 먼저 읽은 것 하나만 남긴다', async () => {
    const categories: unknown[] = [];
    const ctx = createFakeContext({ fetchHtml: pages, postJson: () => productsJson, maxRequests: 8 });

    const deals = await zigzag.crawl(ctx);
    for (const d of deals) categories.push(d.rawCategory);

    expect(ctx.urls.filter((u) => u === capturedRequest.url)).toHaveLength(4);
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(deals.length);
    expect(deals).toHaveLength(15);
    expect(new Set(categories)).toEqual(new Set(['아우터']));
  });

  it('카테고리 탭이 아닌 그룹(브랜드 레일·목록)의 이름은 rawCategory로 쓰지 않는다', async () => {
    const answers = uniqueProducts(1);
    const sent: Record<string, unknown>[] = [];
    const event = eventWith({
      component_map: {
        brands: rail(P1, ['스파오']),
        more: { ...rail(P1, ['전체', '단독 상품 더보기']), __type: 'ProductList' },
        tabs: { ...rail(P2, ['아우터', '슈즈']), __type: 'ProductTab' },
      },
      component_relations: [{ uuid: 'brands' }, { uuid: 'more' }, { uuid: 'tabs' }],
    });
    const ctx = createFakeContext({
      fetchHtml: (url) => (url === EVENT_URL ? event : pages(url)),
      postJson: (_url, body) => {
        sent.push(input(body));
        return answers();
      },
    });

    const deals = await zigzag.crawl(ctx);

    expect(sent.map((g) => [g.products_preset_uuid, g.group_index])).toEqual([[P2, 0], [P2, 1], [P1, 1], [P1, 0]]);
    expect(deals.map((d) => d.rawCategory)).toEqual(['아우터', '슈즈', null, null]);
    expect(deals.every((d) => d.event?.name === '행사')).toBe(true);
  });

  it('모양이 다른 응답이나 실패한 그룹은 기록하고 건너뛴다', async () => {
    let call = 0;
    const ctx = createFakeContext({
      fetchHtml: pages,
      postJson: () => {
        call += 1;
        if (call === 1) return { errors: [{ message: 'Field "limit" is not defined' }] };
        if (call === 2) throw new Error('빈 응답이 돌아왔습니다');
        return productsJson;
      },
      maxRequests: 8,
    });

    const deals = await zigzag.crawl(ctx);

    expect(deals).toHaveLength(15);
    expect(ctx.urls).toHaveLength(8);
    expect(ctx.logs.filter((l) => /그룹 건너뜀/.test(l))).toHaveLength(2);
  });

  it('그룹이 잇달아 실패하면 더 요청하지 않고 끝낸다', async () => {
    const ctx = createFakeContext({ fetchHtml: pages, postJson: () => ({ errors: [{ message: 'nope' }] }) });

    expect(await zigzag.crawl(ctx)).toEqual([]);
    expect(ctx.urls.filter((u) => u === capturedRequest.url)).toHaveLength(3);
  });

  it('차단(BlockedError)은 잡지 않는다', async () => {
    const ctx = createFakeContext({
      fetchHtml: pages,
      postJson: () => {
        throw new BlockedError('HTTP 403', capturedRequest.url);
      },
    });

    const error: unknown = await zigzag.crawl(ctx).catch((e: unknown) => e);

    expect(getCrawlErrorKind(error)).toBe('blocked');
    expect(ctx.urls.filter((u) => u === capturedRequest.url)).toHaveLength(1);
  });

  it('홈을 읽지 못하면 빈 배열, 요청은 한 번', async () => {
    const ctx = createFakeContext({ fetchHtml: () => EMPTY_PAGE });

    expect(await zigzag.crawl(ctx)).toEqual([]);
    expect(ctx.urls).toEqual([HOME_URL]);
  });

  it('기획전 페이지를 읽지 못하면(모양이 다르거나 요청 실패) 건너뛰고, 하나도 못 읽으면 빈 배열', async () => {
    const ctx = createFakeContext({
      fetchHtml: (url) => {
        if (url === HOME_URL) return homeHtml;
        if (url === EVENT_URL) throw new Error('페이지를 찾을 수 없습니다 (HTTP 404)');
        return EMPTY_PAGE;
      },
    });

    expect(await zigzag.crawl(ctx)).toEqual([]);
    expect(ctx.urls).toHaveLength(4);
    expect(ctx.logs.filter((l) => /기획전 건너뜀/.test(l))).toHaveLength(3);
  });

  it('한 번에 돌려주는 상품 수와 그룹당 상품 수에 상한이 있다', async () => {
    const ctx = createFakeContext({ fetchHtml: pages, postJson: uniqueProducts(150) });

    const deals = await zigzag.crawl(ctx);

    expect(deals).toHaveLength(1500);
    expect(ctx.urls.filter((u) => u === capturedRequest.url)).toHaveLength(15);
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(1500);
  });

  it('상품 수 상한에 닿으면 그룹 중간에서도 자르고 멈춘다', async () => {
    const ctx = createFakeContext({ fetchHtml: pages, postJson: uniqueProducts(70) });

    const deals = await zigzag.crawl(ctx);

    expect(deals).toHaveLength(1500);
    expect(ctx.urls.filter((u) => u === capturedRequest.url)).toHaveLength(22);
  });

  it('읽을 수 있는 기획전이 여럿이면 남은 요청을 고루 나눈다', async () => {
    const ctx = createFakeContext({
      fetchHtml: (url) => (url === HOME_URL ? homeHtml : eventHtml),
      postJson: uniqueProducts(1),
      maxRequests: 11,
    });

    const deals = await zigzag.crawl(ctx);

    const perEvent = ctx.urls.slice(1, 4).map((url) => deals.filter((d) => d.event?.url === url).length);
    expect(ctx.urls).toHaveLength(11);
    expect(perEvent).toEqual([2, 2, 3]);
  });

  it('실패가 이어지지 않으면(중간에 성공하면) 계속 읽는다', async () => {
    let call = 0;
    const answers = uniqueProducts(1);
    const ctx = createFakeContext({
      fetchHtml: pages,
      postJson: () => {
        call += 1;
        return call % 3 === 0 ? answers() : { errors: [{ message: 'nope' }] };
      },
    });

    const deals = await zigzag.crawl(ctx);

    expect(ctx.urls).toHaveLength(zigzag.maxRequests);
    expect(deals).toHaveLength(8);
  });

  it('기획전 페이지의 차단과 요청 상한 오류도 잡지 않는다', async () => {
    const blockedPage = createFakeContext({
      fetchHtml: (url) => {
        if (url === EVENT_URL) throw new BlockedError('captcha', url);
        return pages(url);
      },
      postJson: () => productsJson,
    });
    const overLimit = createFakeContext({
      fetchHtml: pages,
      postJson: () => {
        throw new RequestLimitError(30);
      },
    });

    expect(getCrawlErrorKind(await zigzag.crawl(blockedPage).catch((e: unknown) => e))).toBe('blocked');
    expect(blockedPage.urls).toHaveLength(3);
    expect(getCrawlErrorKind(await zigzag.crawl(overLimit).catch((e: unknown) => e))).toBe('request_limit');
  });

  it('홈 요청 자체가 실패하면(네트워크·HTTP 오류) 오류를 그대로 올려 실행이 실패로 남는다', async () => {
    const ctx = createFakeContext({
      fetchHtml: () => {
        throw new Error('사이트 서버 오류입니다 (HTTP 503)');
      },
    });

    await expect(zigzag.crawl(ctx)).rejects.toThrow('HTTP 503');
    expect(ctx.urls).toEqual([HOME_URL]);
  });

  it('상품을 읽는 중에 중단 신호가 오면 그때까지 읽은 것을 돌려준다', async () => {
    const controller = new AbortController();
    const answers = uniqueProducts(2);
    let call = 0;
    const ctx = createFakeContext({
      fetchHtml: pages,
      postJson: () => {
        call += 1;
        if (call === 2) controller.abort();
        return answers();
      },
      signal: controller.signal,
    });

    expect(await zigzag.crawl(ctx)).toHaveLength(4);
    expect(call).toBe(2);
  });

  it('중단 신호가 오면 더 요청하지 않는다', async () => {
    const controller = new AbortController();
    const ctx = createFakeContext({
      fetchHtml: (url) => {
        if (url === EVENT_URL) controller.abort();
        return pages(url);
      },
      postJson: () => productsJson,
      signal: controller.signal,
    });

    expect(await zigzag.crawl(ctx)).toEqual([]);
    expect(ctx.urls.filter((u) => u === capturedRequest.url)).toHaveLength(0);
  });
});

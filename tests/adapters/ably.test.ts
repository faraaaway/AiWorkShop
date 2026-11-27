import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABLY_EVENT_LIST_URL,
  ably,
  ablyEventApiUrl,
  ablySegmentApiUrl,
  parseAbly,
  parseAblyEvent,
  parseAblyEventList,
  pickAblySaleEvents,
} from '@/crawler/adapters/ably';
import { createFakeContext } from '../helpers/fakeContext';

const fixtureText = (name: string): string =>
  readFileSync(new URL(`../../fixtures/sites/ably/${name}`, import.meta.url), 'utf8');
const fixtureJson = (name: string): unknown => JSON.parse(fixtureText(name));

const eventsPage = fixtureText('events.html');
const winterEvent = fixtureJson('event-25051.json');
const guideEvent = fixtureJson('event-25179.json');
const segmentGoods = fixtureJson('segment-165515.json');

const WINTER = {
  name: '❄️ 에블프 베스트 윈터템 ❄️',
  url: 'https://m.a-bly.com/events/25051',
  endsAt: '2026-12-03T23:59:59+09:00',
};
const GUIDE = {
  name: '에이블리 블프백서🖤',
  url: 'https://m.a-bly.com/events/25179',
  endsAt: '2026-12-03T23:59:59+09:00',
};

/** 상품 페이지 HTML에 __NEXT_DATA__ 하나만 넣은 것 */
const nextPage = (data: unknown): string =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;

const promotionsPage = (promotions: unknown[]): string =>
  nextPage({
    props: { serverQueryClient: { queries: [{ state: { data: { eventPromotions: { promotions } } } }] } },
  });

describe('parseAblyEventList', () => {
  const events = parseAblyEventList(eventsPage);

  it('이벤트 목록 페이지의 __NEXT_DATA__에서 행사를 읽는다', () => {
    // 이벤트 46개 + 기획/세일전 2개 (fixture는 177개 중 일부만 남긴 것)
    expect(events).toHaveLength(48);
    expect(events[0]).toEqual({ sno: '23287', title: '🎥 베니토 LIVE🖤', endsAt: '2026-12-01T23:59:59+09:00' });
    expect(events.find((e) => e.sno === '25051')).toEqual({
      sno: '25051',
      title: '❄️ 에블프 베스트 윈터템 ❄️',
      endsAt: '2026-12-03T23:59:59+09:00',
    });
    expect(new Set(events.map((e) => e.sno)).size).toBe(48);
  });

  it('번호나 제목이 없는 항목은 버리고, 종료 시각을 못 읽으면 null', () => {
    const html = promotionsPage([
      { eventSno: 1, title: ' 블프 특가 ', closedAt: '곧 종료' },
      { eventSno: 2, title: '' },
      { title: '번호 없음' },
      { eventSno: 1, title: '같은 번호' },
      { eventSno: 3, title: '오프셋 있음', closedAt: '2026-12-03T14:59:59Z' },
    ]);
    expect(parseAblyEventList(html)).toEqual([
      { sno: '1', title: '블프 특가', endsAt: null },
      { sno: '3', title: '오프셋 있음', endsAt: '2026-12-03T14:59:59Z' },
    ]);
  });

  it('구조가 다르면 빈 배열', () => {
    expect(parseAblyEventList('')).toEqual([]);
    expect(parseAblyEventList('<html><body><div id="root"></div></body></html>')).toEqual([]);
    expect(parseAblyEventList(nextPage({ props: {} }))).toEqual([]);
    expect(parseAblyEventList('<script id="__NEXT_DATA__">{깨진 JSON</script>')).toEqual([]);
  });
});

describe('pickAblySaleEvents', () => {
  const picked = pickAblySaleEvents(parseAblyEventList(eventsPage));

  it('블프 행사만 고르고, 에이블리가 직접 여는 "에블프" 행사를 앞에 둔다', () => {
    expect(picked).toHaveLength(31);
    expect(picked.slice(0, 7).map((e) => e.sno)).toEqual([
      '25051', // ❄️ 에블프 베스트 윈터템 ❄️
      '25179', // 에이블리 블프백서🖤
      '25223', // 💚 에블프 카테고리 데이 💚
      '25246', // 에블프 도착보장
      '25530', // 브랜드 에블프
      '25546', // 에블프 라이프
      '25549', // 언더웨어 에블프 빅세일
    ]);
    // 그 뒤는 마켓별 블프 행사가 목록 순서대로
    expect(picked.slice(7, 10).map((e) => e.title)).toEqual([
      '로렌하이 블프 30% 쿠폰',
      '언더비 블랙프라이데이',
      '틸트 블프 윈터 신상 특가',
    ]);
    expect(picked.some((e) => e.title === '블랙업 BLACK FRIDAY')).toBe(true);
  });

  it('블프 행사가 없으면 빈 배열', () => {
    expect(pickAblySaleEvents([{ sno: '1', title: '🔔Weekly New', endsAt: null }])).toEqual([]);
  });
});

describe('parseAblyEvent', () => {
  it('행사 이름·주소·종료 시각을 읽는다', () => {
    const event = parseAblyEvent(winterEvent);
    expect(event).toMatchObject({ sno: '25051', isOpen: true, ...WINTER });
  });

  it('상품 블록의 묶음(segment)을 블록마다 하나씩, 같은 제목이 겹치지 않게 돌아가며 고른다', () => {
    const segments = parseAblyEvent(winterEvent)?.segments ?? [];
    // 1바퀴: 블록 순서대로 첫 묶음. "라이징 TOP30"은 블록 5개가 같은 제목이라 한 바퀴에 하나만.
    expect(segments.slice(0, 10)).toEqual([
      { sno: '174408', title: '윈터템 BEST', goodsCount: 35 },
      { sno: '174409', title: '라이징 TOP30', goodsCount: 30 },
      { sno: '165515', title: '패딩/점퍼', goodsCount: 966 },
      { sno: '167439', title: '가디건', goodsCount: 1998 },
      { sno: '174413', title: '슈즈', goodsCount: 29 },
      { sno: '167458', title: '털슈즈', goodsCount: 299 },
      { sno: '167446', title: '후드티', goodsCount: 348 },
      { sno: '167450', title: '기모템', goodsCount: 1372 },
      { sno: '167466', title: '한파 준비', goodsCount: 1113 },
      { sno: '171881', title: '아우터', goodsCount: 42 },
    ]);
    // 2바퀴
    expect(segments.slice(10, 19).map((s) => `${s.sno} ${s.title}`)).toEqual([
      '165513 경량패딩',
      '174410 라이징 TOP30',
      '167440 브이넥',
      '174414 잡화',
      '167460 목도리/장갑',
      '167444 기모템',
      '167449 겨울 반바지',
      '167463 크리스마스 준비',
      '171883 상의',
    ]);
    expect(new Set(segments.map((s) => s.sno)).size).toBe(segments.length);
  });

  it('상품이 20개보다 적은 묶음(룩북·래플 등)은 건너뛴다', () => {
    const segments = parseAblyEvent(winterEvent)?.segments ?? [];
    expect(segments.every((s) => s.goodsCount === null || s.goodsCount >= 20)).toBe(true);
    expect(segments.map((s) => s.sno)).not.toContain('178691'); // 래플 2개
    expect(segments.map((s) => s.sno)).not.toContain('175647'); // LOOK1 1개
    expect(segments.map((s) => s.sno)).not.toContain('171882'); // 잡화 11개
    expect(segments.map((s) => s.sno)).toContain('171880'); // 팬츠 20개
  });

  it('블프백서: 묶음 제목이 블록마다 같아도 종류가 고르게 나온다', () => {
    const event = parseAblyEvent(guideEvent);
    expect(event).toMatchObject({ sno: '25179', isOpen: true, ...GUIDE });
    expect(event?.segments.slice(0, 7).map((s) => `${s.sno} ${s.title}`)).toEqual([
      '170873 아우터',
      '171723 상의',
      '171727 팬츠',
      '171731 스커트&원피스',
      '171734 슈즈&잡화',
      '170883 BEST 여행템',
      '171746 키즈',
    ]);
  });

  it('탭 안에 든 묶음도 찾고, 상품 수를 모르는 묶음은 남긴다', () => {
    const raw = {
      event: {
        sno: 7,
        name: ' 탭 행사 ',
        is_open: false,
        close_date: null,
        segment_meta_data: [{ sno: 11, title: '메타 제목', goods_count: 50 }],
        page_content: JSON.stringify([
          { id: 'a', type: 'imageTool', data: { image: { url: 'https://img.a-bly.com/x.jpg' } } },
          {
            id: 'b',
            type: 'containerTabTool',
            data: { tabs: [{ name: '탭1', children: [{ type: 'productListTwoColumnTool', data: { title: '', segmentSno: 11 } }] }] },
          },
          { id: 'c', type: 'productCarouselTool', data: { chipData: [{ title: ' 새 묶음 ', segmentSno: 12 }, { title: '중복', segmentSno: 11 }] } },
        ]),
      },
    };
    expect(parseAblyEvent(raw)).toEqual({
      sno: '7',
      name: '탭 행사',
      url: 'https://m.a-bly.com/events/7',
      endsAt: null,
      isOpen: false,
      segments: [
        { sno: '11', title: '메타 제목', goodsCount: 50 },
        { sno: '12', title: '새 묶음', goodsCount: null },
      ],
    });
  });

  it('page_content를 못 읽으면 묶음 없이, 행사 정보가 없으면 null', () => {
    expect(parseAblyEvent({ event: { sno: 1, name: '행사', page_content: '<p>본문</p>' } })?.segments).toEqual([]);
    expect(parseAblyEvent({ event: { sno: 1, name: '행사' } })?.segments).toEqual([]);
    expect(parseAblyEvent({ detail: '자격 인증데이터(authentication credentials)가 제공되지 않았습니다.' })).toBeNull();
    expect(parseAblyEvent({ event: { name: '번호 없음' } })).toBeNull();
    expect(parseAblyEvent(null)).toBeNull();
    expect(parseAblyEvent('<html>차단</html>')).toBeNull();
  });
});

describe('parseAbly', () => {
  const deals = parseAbly(segmentGoods);

  it('fixture에서 10개 이상 읽는다', () => {
    expect(deals).toHaveLength(12);
    expect(new Set(deals.map((d) => d.siteProductId)).size).toBe(12);
  });

  it('사이트 값을 그대로 옮긴다', () => {
    expect(deals[0]).toEqual({
      siteProductId: '76578288',
      name: '[블프특가/~한겨울까지❄️/겨울아우터]윈터 아방 롱 패딩 야상(3colors)',
      brand: '코이뮤',
      url: 'https://m.a-bly.com/goods/76578288',
      imageUrl:
        'https://d3ha2047wt6x28.cloudfront.net/cwvPA5vEMd8/pr:GOODS_THUMB/afl:10/czM6Ly9hYmx5LWltYWdlLWxlZ2FjeS9kYXRhL2dvb2RzLzgxNWY1YmExYTQzYWEzNzQxYjJlOTM2NTk3ZTYwNDE5LmdpZg',
      originalPrice: 89000,
      salePrice: 60000,
      displayedDiscountRate: 32,
      endsAt: null,
      rawCategory: '패딩 > 롱패딩',
      rawGender: '여성',
      soldOut: false,
      event: null,
    });
    expect(deals[6]).toMatchObject({
      siteProductId: '30433969',
      brand: '무센트',
      originalPrice: 213900,
      salePrice: 92700,
      displayedDiscountRate: 56,
      rawCategory: '패딩 > 숏패딩',
    });
  });

  it('브랜드는 카드에 보이는 상점 글자에서 읽는다 (브랜드 상품은 판매 마켓이 아니라 브랜드 이름)', () => {
    // fixture 12번째: 카드 표시 "<font color='#6093FC'>브랜드</font> 아디다스", 판매 마켓은 "세컨찬스"
    expect(deals[11]).toMatchObject({ siteProductId: '77565635', brand: '아디다스' });
    // fixture 7번째: 카드 표시 "<font color='#6093FC'>브랜드</font> 무센트"
    expect(deals[6].brand).toBe('무센트');
    const raw = {
      goods: [
        { sno: 1, name: '카드 글자 없음', price: 1000, market: { name: ' 마켓 ' } },
        { sno: 2, name: '배지만 있음', price: 1000, market: { name: '마켓' }, render: { data: { store_text: '<font>브랜드</font> ' } } },
        { sno: 3, name: '둘 다 없음', price: 1000 },
      ],
    };
    expect(parseAbly(raw).map((d) => d.brand)).toEqual(['마켓', '마켓', null]);
  });

  it('필수 필드가 모두 있고 가격은 숫자(원), 주소는 절대 경로다', () => {
    for (const d of deals) {
      expect(d.siteProductId).toMatch(/^\d+$/);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.url).toBe(`https://m.a-bly.com/goods/${d.siteProductId}`);
      expect(d.imageUrl).toMatch(/^https:\/\//);
      expect(Number.isInteger(d.salePrice)).toBe(true);
      expect(d.salePrice).toBeGreaterThan(0);
      expect(d.brand).toBeTruthy();
      expect(d.rawCategory).toBeTruthy();
    }
  });

  it('정가·할인가·표시 할인율이 서로 맞는다 (표시 할인율은 계산값과 1%p 이내)', () => {
    for (const d of deals) {
      const original = d.originalPrice as number;
      const computed = ((original - d.salePrice) / original) * 100;
      expect(original).toBeGreaterThan(d.salePrice);
      expect(Math.abs((d.displayedDiscountRate as number) - computed)).toBeLessThan(1);
    }
  });

  it('분류 이름이 같으면 한 번만, 하나만 있으면 그것만 쓴다', () => {
    // fixture 9번째: category "야상", standard_category "야상"
    expect(deals[8]).toMatchObject({ siteProductId: '77318625', rawCategory: '야상' });
    const raw = {
      goods: [
        { sno: 1, name: '표준 분류만', price: 1000, standard_category: { name: '로퍼' } },
        { sno: 2, name: '분류 없음', price: 1000 },
      ],
    };
    expect(parseAbly(raw).map((d) => d.rawCategory)).toEqual(['로퍼', null]);
  });

  it('넘겨받은 기획전을 모든 상품에 붙인다', () => {
    expect(parseAbly(segmentGoods, { event: WINTER }).every((d) => d.event === WINTER)).toBe(true);
  });

  it('빠진 값은 null, 필수 값이 없는 상품은 버리고, 같은 상품은 한 번만', () => {
    const raw = {
      goods: [
        { sno: 5, name: ' 최소 상품 ', price: 12900 },
        { sno: 6, name: '가격 없음' },
        { name: '번호 없음', price: 1000 },
        { sno: 7, name: '', price: 1000 },
        { sno: 5, name: '중복', price: 9900 },
        { sno: 8, name: '옵션 가격만', linked_option: { price: 20000, original_price: 25000 }, is_soldout: true, discount_rate: 20 },
        { sno: 9, name: '0원', price: 0 },
      ],
    };
    expect(parseAbly(raw)).toEqual([
      {
        siteProductId: '5',
        name: '최소 상품',
        brand: null,
        url: 'https://m.a-bly.com/goods/5',
        imageUrl: null,
        originalPrice: null,
        salePrice: 12900,
        displayedDiscountRate: null,
        endsAt: null,
        rawCategory: null,
        rawGender: '여성',
        soldOut: false,
        event: null,
      },
      expect.objectContaining({
        siteProductId: '8',
        salePrice: 20000,
        originalPrice: 25000,
        displayedDiscountRate: 20,
        soldOut: true,
      }),
    ]);
  });

  it('구조가 다르거나 인증 오류 응답이면 빈 배열', () => {
    expect(parseAbly(null)).toEqual([]);
    expect(parseAbly('<html>차단</html>')).toEqual([]);
    expect(parseAbly({ detail: '자격 인증데이터(authentication credentials)가 제공되지 않았습니다.' })).toEqual([]);
    expect(parseAbly({ goods: '없음' })).toEqual([]);
  });
});

describe('ably.crawl', () => {
  const EVENT_APIS: Record<string, unknown> = {
    [ablyEventApiUrl('25051')]: winterEvent,
    [ablyEventApiUrl('25179')]: guideEvent,
  };

  /** 묶음마다 서로 다른 상품 3개를 돌려준다 (상품 번호 = 묶음 번호 * 10 + n) */
  const distinctGoods = (url: string): unknown => {
    const segmentSno = Number(/segments\/(\d+)\//.exec(url)?.[1]);
    return {
      goods: [0, 1, 2].map((n) => ({ sno: segmentSno * 10 + n, name: `상품 ${segmentSno}-${n}`, price: 10000 + n })),
    };
  };

  const fake = (options: { maxRequests?: number; goods?: (url: string) => unknown; events?: Record<string, unknown> } = {}) =>
    createFakeContext({
      fetchHtml: () => eventsPage,
      fetchJson: (url) => {
        const events = options.events ?? EVENT_APIS;
        if (url in events) return events[url];
        if (url.includes('/webview/events/')) return { detail: '찾을 수 없습니다.' };
        return (options.goods ?? (() => segmentGoods))(url);
      },
      maxRequests: options.maxRequests ?? ably.maxRequests,
    });

  it('사이트가 쓰는 공개 GET 주소를 부른다', () => {
    expect(ABLY_EVENT_LIST_URL).toBe('https://m.a-bly.com/events');
    expect(ablyEventApiUrl('25051')).toBe('https://api.a-bly.com/webview/events/25051/');
    expect(ablySegmentApiUrl('165515')).toBe('https://api.a-bly.com/api/v2/events/segments/165515/?count=30');
  });

  it('행사 목록 → 행사 2개 → 묶음을 행사끼리 번갈아 읽는다', async () => {
    const ctx = fake({ goods: distinctGoods });
    const deals = await ably.crawl(ctx);

    expect(ctx.urls).toEqual([
      ABLY_EVENT_LIST_URL,
      ablyEventApiUrl('25051'),
      ablyEventApiUrl('25179'),
      ablySegmentApiUrl('174408'), // 윈터템 BEST
      ablySegmentApiUrl('170873'), // 블프백서 아우터
      ablySegmentApiUrl('174409'),
      ablySegmentApiUrl('171723'),
      ablySegmentApiUrl('165515'),
      ablySegmentApiUrl('171727'),
      ablySegmentApiUrl('167439'),
      ablySegmentApiUrl('171731'),
      ablySegmentApiUrl('174413'),
      ablySegmentApiUrl('171734'),
      ablySegmentApiUrl('167458'),
      ablySegmentApiUrl('170883'),
      ablySegmentApiUrl('167446'),
    ]);
    expect(ctx.urls.length).toBeLessThanOrEqual(ably.maxRequests);
    expect(deals).toHaveLength(13 * 3);
    expect(deals[0]).toMatchObject({ siteProductId: '1744080', event: WINTER, rawGender: '여성' });
    expect(deals[3]).toMatchObject({ siteProductId: '1708730', event: GUIDE });
    expect(deals.filter((d) => d.event?.url === WINTER.url)).toHaveLength(7 * 3);
    expect(deals.filter((d) => d.event?.url === GUIDE.url)).toHaveLength(6 * 3);
  });

  it('원본 HTML(raw)로 행사 목록을 받는다', async () => {
    const seen: unknown[] = [];
    const ctx = createFakeContext({
      fetchHtml: (_url, opts) => {
        seen.push(opts);
        return eventsPage;
      },
      fetchJson: () => ({ detail: '없음' }),
    });
    await ably.crawl(ctx);
    expect(seen).toEqual([{ raw: true }]);
  });

  it('여러 묶음에 같은 상품이 나오면 처음 것만 남긴다', async () => {
    const ctx = fake();
    const deals = await ably.crawl(ctx);

    expect(ctx.urls).toHaveLength(16);
    expect(deals).toHaveLength(12);
    expect(deals.every((d) => d.event === deals[0].event)).toBe(true);
    expect(deals[0].event).toEqual(WINTER);
    expect(deals.every((d) => d.endsAt === null)).toBe(true);
  });

  it('요청 상한 안에서 멈추고 그때까지 모은 것을 돌려준다', async () => {
    const ctx = fake({ maxRequests: 4, goods: distinctGoods });
    const deals = await ably.crawl(ctx);

    expect(ctx.urls).toEqual([
      ABLY_EVENT_LIST_URL,
      ablyEventApiUrl('25051'),
      ablyEventApiUrl('25179'),
      ablySegmentApiUrl('174408'),
    ]);
    expect(deals).toHaveLength(3);

    const tiny = fake({ maxRequests: 1 });
    expect(await ably.crawl(tiny)).toEqual([]);
    expect(tiny.urls).toEqual([ABLY_EVENT_LIST_URL]);
  });

  it('닫혔거나 묶음이 없는 행사는 건너뛰고 다음 행사를 본다 (행사 조회는 4번까지)', async () => {
    const closed = { event: { sno: 25051, name: '닫힌 행사', is_open: false, page_content: '[]' } };
    const ctx = fake({
      goods: distinctGoods,
      events: {
        [ablyEventApiUrl('25051')]: closed,
        [ablyEventApiUrl('25179')]: { event: { sno: 25179, name: '묶음 없음', is_open: true, page_content: '[]' } },
        [ablyEventApiUrl('25246')]: guideEvent,
      },
    });
    const deals = await ably.crawl(ctx);

    expect(ctx.urls.slice(0, 5)).toEqual([
      ABLY_EVENT_LIST_URL,
      ablyEventApiUrl('25051'),
      ablyEventApiUrl('25179'),
      ablyEventApiUrl('25223'),
      ablyEventApiUrl('25246'),
    ]);
    expect(ctx.urls[5]).toBe(ablySegmentApiUrl('170873'));
    expect(ctx.urls.length).toBeLessThanOrEqual(ably.maxRequests);
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d) => d.event?.name === GUIDE.name)).toBe(true);
  });

  it('행사 목록이 예상과 다른 페이지면 요청 한 번으로 끝내고 빈 배열', async () => {
    const ctx = createFakeContext({ fetchHtml: () => '<html><body><div id="root"></div></body></html>' });
    expect(await ably.crawl(ctx)).toEqual([]);
    expect(ctx.urls).toEqual([ABLY_EVENT_LIST_URL]);
    expect(ctx.logs.join('\n')).toContain('블프 행사를 찾지 못함');
  });

  it('행사 정보를 하나도 못 읽으면 빈 배열', async () => {
    const ctx = fake({ events: {} });
    expect(await ably.crawl(ctx)).toEqual([]);
    expect(ctx.urls).toHaveLength(5); // 목록 1 + 행사 조회 4
    expect(ctx.logs.join('\n')).toContain('상품 묶음이 있는 행사를 찾지 못함');
  });

  it('묶음 응답이 예상과 다르면 빈 배열', async () => {
    const ctx = fake({ goods: () => ({ detail: '자격 인증데이터(authentication credentials)가 제공되지 않았습니다.' }) });
    expect(await ably.crawl(ctx)).toEqual([]);
    expect(ctx.urls.length).toBeLessThanOrEqual(ably.maxRequests);
  });

  it('어댑터 기본 설정', () => {
    expect(ably).toMatchObject({
      id: 'ably',
      displayName: '에이블리',
      homeUrl: 'https://m.a-bly.com',
      stealth: true,
      obeyRobots: false,
      maxRequests: 16,
    });
  });
});

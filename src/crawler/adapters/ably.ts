import type { CrawlContext, FetchHtmlOptions, RawDeal, SiteAdapter, SiteId } from '@/lib/types';
import { readNextData } from './crawlb-shared';

/**
 * 에이블리 (m.a-bly.com) — "에블프"(에이블리 블랙프라이데이) 행사. Owner: Crawl B.
 *
 * 첫 화면·행사 페이지를 렌더링하면 Obscura 0.2.7에서 스크립트가 죽어 오류 화면만 나온다. 그래서 렌더링하지 않고,
 * 사이트가 로그인·헤더 없이 GET으로 부르는 주소만 읽는다 (2026-11-28 확인).
 *   1) https://m.a-bly.com/events (원본 HTML)             → `__NEXT_DATA__`에 진행 중인 행사 목록(번호·제목·종료 시각)
 *   2) https://api.a-bly.com/webview/events/<번호>/        → 행사 이름·종료 시각, 화면 블록(`page_content`)과
 *                                                            그 안의 상품 묶음(segment) 번호·제목
 *   3) https://api.a-bly.com/api/v2/events/segments/<묶음>/?count=30 → 묶음의 상품 목록(인기순)
 * 원본 예시는 fixtures/sites/ably/ 참고.
 *
 * robots.txt(m.a-bly.com)는 이름 없는 봇에게 `Disallow: /`라서 `obeyRobots: false`로 둔다(프로젝트 리드 허용).
 * 대신 한 번 실행에 16번까지만 요청한다. 같은 API의 다른 주소(`/webview/events/segments/<묶음>/goods` 등)는
 * 익명 토큰을 요구하므로 쓰지 않는다.
 *
 * 사이트가 주지 않아 비워 두는 값:
 * - endsAt: 상품별 할인 종료 시각이 없다(카드의 `discount_end_text`는 수집 당시 모두 null). 행사 종료는 event.endsAt.
 * 에이블리는 여성 패션 앱이고 응답에 상품별 성별이 없어서 rawGender는 모두 '여성'으로 넣는다
 * (입점 브랜드의 남녀공용 상품도 '여성'이 된다).
 */

const SITE_ID: SiteId = 'ably';
const RAW_HTML: FetchHtmlOptions = { raw: true };

const ORIGIN = 'https://m.a-bly.com';
const API_ORIGIN = 'https://api.a-bly.com';
const PRODUCT_PAGE = `${ORIGIN}/goods/`;
const EVENT_PAGE = `${ORIGIN}/events/`;
export const ABLY_EVENT_LIST_URL = `${ORIGIN}/events`;

/** 블프 행사 제목. 마켓(쇼핑몰)이 여는 "○○ 블프 특가" 같은 행사도 맞는다. */
const SALE_TITLE = /에블프|블프|블랙\s*프라이데이|black\s*friday/i;
/** 에이블리가 직접 여는 행사 제목 ("에블프 베스트 윈터템", "에이블리 블프백서") — 먼저 읽는다. */
const OWN_SALE_TITLE = /에블프|에이블리\s*(블프|블랙\s*프라이데이)/;

/** 사이트 화면은 10개씩 부르지만, 요청 횟수를 줄이려고 한 번에 30개씩 받는다(30개가 그대로 온다). */
const PAGE_SIZE = 30;
/** 상품이 이보다 적은 묶음(룩북 3~6개, 래플 경품 등)은 요청 한 번 값을 못 해서 건너뛴다. */
const MIN_SEGMENT_GOODS = 20;
/** 요청 상한(maxRequests) 안에서 나눠 쓰기 위한 내부 상한 */
const MAX_EVENTS = 2;
const MAX_EVENT_LOOKUPS = 4;

const SITE_GENDER = '여성';
const KST_OFFSET = '+09:00';
/** API의 시각은 오프셋 없는 한국 시각이다 (행사 25051의 유의사항 문구 "2026.12.03 23:59:59 (KST)"와 같은 값). */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
/** 카드 상점 글자 앞의 "브랜드" 배지 */
const STORE_BADGE = /<font\b[^>]*>[^<]*<\/font>/gi;
const ANY_TAG = /<[^>]*>/g;

type Json = Record<string, unknown>;
type DealEvent = NonNullable<RawDeal['event']>;

export interface AblyEventRef {
  /** 행사 번호 */
  sno: string;
  title: string;
  endsAt: string | null;
}

export interface AblySegment {
  /** 상품 묶음 번호 */
  sno: string;
  /** 화면의 칩 제목 (예: "패딩/점퍼"). 없으면 빈 문자열 */
  title: string;
  /** 묶음의 상품 수. 응답에 없으면 null */
  goodsCount: number | null;
}

export interface AblyEvent {
  sno: string;
  name: string;
  /** 행사 페이지 절대 URL */
  url: string;
  endsAt: string | null;
  isOpen: boolean;
  /** 읽을 순서대로 */
  segments: AblySegment[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** 25051, "25051" → "25051". 숫자가 아니면 null */
function toId(v: unknown): string | null {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? String(v) : null;
  const s = str(v);
  return s !== null && /^\d+$/.test(s) ? s : null;
}

/** 원 단위 숫자만 받는다. 0 이하나 숫자가 아닌 값은 null */
function toWon(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** "2026-12-03T23:59:59" → "2026-12-03T23:59:59+09:00". 읽지 못하면 null */
function toKstInstant(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  if (LOCAL_DATE_TIME.test(s)) return `${s}${KST_OFFSET}`;
  return HAS_OFFSET.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

function safeParse(text: unknown): unknown {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // 블록 편집기 내용이 아닌 본문(HTML 등)이면 묶음이 없는 것으로 본다
  }
}

export function ablyEventApiUrl(eventSno: string): string {
  return `${API_ORIGIN}/webview/events/${encodeURIComponent(eventSno)}/`;
}

/** 행사 페이지의 "전체 보기" 화면이 쓰는 주소. 헤더 없이 GET만으로 응답한다. */
export function ablySegmentApiUrl(segmentSno: string): string {
  return `${API_ORIGIN}/api/v2/events/segments/${encodeURIComponent(segmentSno)}/?count=${PAGE_SIZE}`;
}

/** 이벤트 목록 페이지 HTML → 진행 중인 행사 목록 (이벤트, 그다음 기획/세일전; 화면 순서) */
export function parseAblyEventList(html: string): AblyEventRef[] {
  if (typeof html !== 'string' || html.trim() === '') return [];
  const next = readNextData(html);
  const props = isObj(next) && isObj(next.props) ? next.props : {};
  const client = isObj(props.serverQueryClient) ? props.serverQueryClient : {};

  const events: AblyEventRef[] = [];
  const seen = new Set<string>();
  for (const query of list(client.queries)) {
    const data = isObj(query.state) && isObj(query.state.data) ? query.state.data : {};
    for (const group of [data.eventPromotions, data.collectionPromotions]) {
      for (const item of list(isObj(group) ? group.promotions : null)) {
        const sno = toId(item.eventSno);
        const title = str(item.title);
        if (!sno || !title || seen.has(sno)) continue;
        seen.add(sno);
        events.push({ sno, title, endsAt: toKstInstant(item.closedAt) });
      }
    }
  }
  return events;
}

/** 블프 행사만, 에이블리가 직접 여는 행사를 앞에 둔다. 각 무리 안에서는 목록 순서 그대로. */
export function pickAblySaleEvents(events: readonly AblyEventRef[]): AblyEventRef[] {
  const own = events.filter((e) => OWN_SALE_TITLE.test(e.title));
  const others = events.filter((e) => SALE_TITLE.test(e.title) && !OWN_SALE_TITLE.test(e.title));
  return [...own, ...others];
}

/** 블록 하나 안의 `segmentSno`를 가진 항목(칩·탭·목록)을 문서 순서대로 찾는다. */
function findSegmentNodes(node: unknown, found: Json[] = []): Json[] {
  if (Array.isArray(node)) {
    for (const child of node) findSegmentNodes(child, found);
  } else if (isObj(node)) {
    if (toId(node.segmentSno) !== null) found.push(node);
    for (const child of Object.values(node)) findSegmentNodes(child, found);
  }
  return found;
}

/**
 * 블록마다 하나씩 돌아가며 고른다. 한 바퀴 안에서는 같은 제목을 한 번만 고른다
 * ("아우터/상의/팬츠" 칩이 블록마다 되풀이되는 행사에서 요청 몇 번으로도 종류가 고르게 나오도록).
 */
function takeTurns(blocks: readonly AblySegment[][]): AblySegment[] {
  const queues = blocks.map((block) => [...block]);
  const order: AblySegment[] = [];
  while (queues.some((queue) => queue.length > 0)) {
    const titles = new Set<string>();
    for (const queue of queues) {
      const index = queue.findIndex((s) => s.title === '' || !titles.has(s.title));
      if (index < 0) continue;
      const [segment] = queue.splice(index, 1);
      titles.add(segment.title);
      order.push(segment);
    }
  }
  return order;
}

function readSegments(body: Json): AblySegment[] {
  const meta = new Map<string, Json>();
  for (const item of list(body.segment_meta_data)) {
    const sno = toId(item.sno);
    if (sno) meta.set(sno, item);
  }

  const blocks = safeParse(body.page_content);
  const seen = new Set<string>();
  const perBlock: AblySegment[][] = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const segments: AblySegment[] = [];
    for (const node of findSegmentNodes(block)) {
      const sno = toId(node.segmentSno) as string;
      if (seen.has(sno)) continue;
      seen.add(sno);
      const info = meta.get(sno);
      const goodsCount = typeof info?.goods_count === 'number' ? info.goods_count : null;
      if (goodsCount !== null && goodsCount < MIN_SEGMENT_GOODS) continue;
      segments.push({ sno, title: str(node.title) ?? str(node.name) ?? str(info?.title) ?? '', goodsCount });
    }
    if (segments.length > 0) perBlock.push(segments);
  }
  return takeTurns(perBlock);
}

/** webview/events/<번호>/ 응답 → 행사 정보와 읽을 상품 묶음. 행사 정보가 없으면(오류 응답 등) null */
export function parseAblyEvent(raw: unknown): AblyEvent | null {
  const body = isObj(raw) && isObj(raw.event) ? raw.event : null;
  if (!body) return null;
  const sno = toId(body.sno);
  const name = str(body.name);
  if (!sno || !name) return null;
  return {
    sno,
    name,
    url: `${EVENT_PAGE}${sno}`,
    endsAt: toKstInstant(body.close_date),
    isOpen: body.is_open === true,
    segments: readSegments(body),
  };
}

/** 사이트의 표시 분류와 표준 분류 이름을 "패딩 > 롱패딩"처럼 잇는다. 같으면 한 번만, 없으면 null */
function readCategory(goods: Json): string | null {
  const names = [goods.category, goods.standard_category]
    .map((category) => (isObj(category) ? str(category.name) : null))
    .filter((name): name is string => name !== null);
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique.join(' > ') : null;
}

/**
 * 카드에 보이는 상점 글자(`render.data.store_text`). 쇼핑몰 상품은 마켓 이름 그대로이고, 브랜드 상품은
 * "<font color='#6093FC'>브랜드</font> 아디다스"처럼 배지 뒤에 브랜드 이름이 온다(판매 마켓은 "세컨찬스").
 * 카드 글자가 없으면 마켓 이름을 쓴다.
 */
function readBrand(goods: Json): string | null {
  const card = isObj(goods.render) && isObj(goods.render.data) ? str(goods.render.data.store_text) : null;
  const shown = card === null ? null : str(card.replace(STORE_BADGE, ' ').replace(ANY_TAG, ' ').replace(/\s+/g, ' '));
  return shown ?? (isObj(goods.market) ? str(goods.market.name) : null);
}

/**
 * events/segments/<묶음>/ 응답 → RawDeal[].
 * - salePrice·displayedDiscountRate는 상품 카드에 보이는 값(`price`·`discount_rate`), originalPrice는
 *   대표 옵션의 정가(`linked_option.original_price`).
 * - event는 응답에 없어서 호출한 쪽이 넘겨준다.
 * 한 응답 안에 같은 상품이 두 번 나오면 처음 것만 남긴다.
 */
export function parseAbly(raw: unknown, context: { event?: DealEvent | null } = {}): RawDeal[] {
  const deals: RawDeal[] = [];
  const seen = new Set<string>();
  for (const goods of list(isObj(raw) ? raw.goods : null)) {
    const option = isObj(goods.linked_option) ? goods.linked_option : {};
    const id = toId(goods.sno);
    const name = str(goods.name);
    const salePrice = toWon(goods.price) ?? toWon(option.price);
    if (!id || !name || salePrice === null || seen.has(id)) continue;
    seen.add(id);

    const image = str(goods.image);
    deals.push({
      siteProductId: id,
      name,
      brand: readBrand(goods),
      url: `${PRODUCT_PAGE}${id}`,
      imageUrl: image !== null && /^https?:\/\//.test(image) ? image : null,
      originalPrice: toWon(option.original_price),
      salePrice,
      displayedDiscountRate: typeof goods.discount_rate === 'number' ? goods.discount_rate : null,
      endsAt: null,
      rawCategory: readCategory(goods),
      rawGender: SITE_GENDER,
      soldOut: goods.is_soldout === true,
      event: context.event ?? null,
    });
  }
  return deals;
}

/** [[a1, a2], [b1]] → [a1, b1, a2] */
function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const longest = Math.max(0, ...lists.map((items) => items.length));
  const out: T[] = [];
  for (let i = 0; i < longest; i += 1) {
    for (const items of lists) if (i < items.length) out.push(items[i]);
  }
  return out;
}

async function crawl(ctx: CrawlContext): Promise<RawDeal[]> {
  const canRequest = () => ctx.requestsLeft > 0 && !ctx.signal.aborted;

  // 1) 행사 목록에서 블프 행사 찾기
  const refs = pickAblySaleEvents(parseAblyEventList(await ctx.fetchHtml(ABLY_EVENT_LIST_URL, RAW_HTML)));
  if (refs.length === 0) {
    ctx.log('에이블리: 행사 목록에서 블프 행사를 찾지 못함');
    return [];
  }

  // 2) 상품 묶음이 있는 열린 행사 고르기
  const events: AblyEvent[] = [];
  let lookups = 0;
  for (const ref of refs) {
    if (events.length >= MAX_EVENTS || lookups >= MAX_EVENT_LOOKUPS || !canRequest()) break;
    lookups += 1;
    const event = parseAblyEvent(await ctx.fetchJson(ablyEventApiUrl(ref.sno)));
    if (event && event.isOpen && event.segments.length > 0) events.push(event);
    else ctx.log(`에이블리: ${ref.title} — 열린 상품 묶음이 없어 건너뜀`);
  }
  if (events.length === 0) {
    ctx.log(`에이블리: 상품 묶음이 있는 행사를 찾지 못함 (${refs.length}개 중 ${lookups}개 확인)`);
    return [];
  }

  // 3) 묶음별 상품 목록 — 남은 요청을 행사끼리 번갈아 쓴다
  const tasks = interleave(
    events.map((event) => {
      const dealEvent: DealEvent = { name: event.name, url: event.url, endsAt: event.endsAt };
      return event.segments.map((segment) => ({ event, dealEvent, segment }));
    }),
  );
  const byId = new Map<string, RawDeal>();
  for (const task of tasks) {
    if (!canRequest()) break;
    const found = parseAbly(await ctx.fetchJson(ablySegmentApiUrl(task.segment.sno)), { event: task.dealEvent });
    const fresh = found.filter((deal) => !byId.has(deal.siteProductId));
    for (const deal of fresh) byId.set(deal.siteProductId, deal);
    ctx.log(`에이블리: ${task.event.name} / ${task.segment.title} ${found.length}개 (새 상품 ${fresh.length}개)`);
  }
  return [...byId.values()];
}

export const ably: SiteAdapter = {
  id: SITE_ID,
  displayName: '에이블리',
  homeUrl: ORIGIN,
  stealth: true,
  // robots.txt가 이름 없는 봇을 모두 막는다. 리드가 이 사이트에 한해 허용했고, 요청 수를 줄여 둔다.
  obeyRobots: false,
  // 행사 목록 1 + 행사 조회 최대 4 + 나머지는 상품 묶음(묶음당 30개)
  maxRequests: 16,
  crawl,
};

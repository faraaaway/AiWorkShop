// 지그재그 수집기 — 홈 배너의 블프("직잭팟") 기획전을 찾아, 기획전의 상품 그룹(탭)마다 상품 목록을 받는다.
//
// 경로 (2026-11-28 확인, 원본은 fixtures/sites/zigzag/ 와 그 README 참고):
//   1) 홈 https://zigzag.kr 원본 HTML의 __NEXT_DATA__ → 배너 목록 → 기획전 주소(/events/<uuid>)   [parseZigzagEventLinks]
//   2) 기획전 원본 HTML의 __NEXT_DATA__ → 기획전 이름·종료 시각, 상품 묶음(preset)과 그룹(탭) 목록  [parseZigzagEvent]
//      여기까지는 ctx.fetchHtml(url, { raw: true }). 상품은 HTML에 없다.
//   3) 상품 목록은 GraphQL POST 한 가지뿐이다 → ctx.postJson                              [buildZigzagProductsRequest]
//      → 응답 JSON을 RawDeal로                                                        [parseZigzagProducts]
// 3)에 다른 길이 없는 이유:
//   - ctx.fetchJson(GET)에는 "GraphQL only supports POST requests."가 온다.
//   - 페이지 안 fetch(preEval/evalPage)는 Obscura 0.2.7에서 CORS 오류로 끝난다(응답에 Access-Control-Allow-Origin 없음).
//     Obscura의 페이지 안 요청에는 Referer가 없고 사전 요청에는 User-Agent도 없는데, 그것이 원인인지는 추정이다.
// Origin·Referer를 붙인 익명 POST(쿠키·토큰 없음)에는 상품 목록이 온다. 두 헤더가 없으면 빈 응답이 온다.
import { getCrawlErrorKind } from '@/lib/errors';
import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';
import { msToKstIso, readNextData } from './crawlb-shared';

const HOME = 'https://zigzag.kr';
const EVENT_PAGE = `${HOME}/events/`;
/** 상품 페이지의 canonical 주소 (응답의 product_url은 앱용 store.zigzag.kr 주소다). */
const PRODUCT_PAGE = `${HOME}/catalog/products/`;
const PRODUCTS_API = 'https://api.zigzag.kr/api/2/graphql/GetCmsProductsPresetProductCardItemList';
/** 사이트의 기획전 페이지가 상품 목록을 부를 때 붙는 출처 헤더. 없으면 빈 응답이 온다. */
const SITE_HEADERS: Readonly<Record<string, string>> = { Origin: HOME, Referer: `${HOME}/` };

// ----- 한 번 실행의 상한 (요청 30개: 홈 1 + 기획전 최대 3 + 그룹 26 이상) -----
const MAX_REQUESTS = 30;
/** 홈 배너 순서로 앞에서부터 읽을 블프 기획전 수 */
const MAX_EVENTS = 3;
/** 그룹 하나에 요청하는 상품 수. 사이트의 상품 레일(ProductRail)이 쓰는 값(limited_size 50)과 같다. */
const PAGE_SIZE = 50;
/** 그룹 하나에서 받아들이는 상품 수. 서버가 쪽 크기를 무시하고 그룹 전체(수백~수천 개)를 줘도 여기서 자른다. */
const MAX_DEALS_PER_GROUP = 100;
/** 한 번 실행이 돌려주는 상품 수 */
const MAX_DEALS = 1500;
/** 그룹 요청이 이만큼 잇달아 실패하면 요청 형식이 바뀐 것으로 보고 더 보내지 않는다. */
const MAX_GROUP_FAILURES_IN_A_ROW = 3;
/** 먼저 읽을 모듈 종류. 카테고리 탭(ProductTab) → 상품 목록 → 그 밖(브랜드별 레일). */
const MODULE_PRIORITY: readonly string[] = ['ProductTab', 'ProductList'];
/** 탭 이름이 "아우터"·"슈즈" 같은 카테고리인 모듈. 이 모듈의 탭 이름만 rawCategory로 넘긴다(레일의 탭은 브랜드 이름). */
const CATEGORY_TAB_MODULE = 'ProductTab';

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_PATTERN}$`);
/** 배너가 가리키는 주소는 store.zigzag.kr/events/<uuid> 이고, 웹에서는 zigzag.kr/events/<uuid> 로 열린다. */
const EVENT_PATH = new RegExp(`[/.]zigzag\\.kr/events/(${UUID_PATTERN})`);
const DIGITS = /^\d+$/;
const ABSOLUTE_URL = /^https?:\/\//;
const KST_OFFSET_MS = 9 * 3600 * 1000;
/** Date가 나타낼 수 있는 가장 큰 시각(밀리초). 이보다 크면 toISOString()이 던진다. */
const MAX_DATE_MS = 8.64e15;

/** 홈 배너 중 블프 행사로 볼 문구. "직잭팟"은 지그재그 블프 행사 이름이다. */
const BF_KEYWORDS = /블프|블랙\s*프라이데이|BLACK\s*FRIDAY|직잭팟/i;
/** 의류 기획전이 아닌 배너(문구 기준)는 건너뛴다. */
const NOT_CLOTHING = /뷰티|라이프|가전|디바이스|래플|쿠폰\s*뽑기/;

/**
 * 지그재그는 상품별 성별을 주지 않는다(목록 응답·상품 페이지 모두 없음).
 * 사이트가 스스로를 "4,000만 여성이 선택한 올인원 쇼핑 앱"(홈 meta description)이라 소개하므로
 * 사이트 단위 표기로 '여성'을 넘긴다. 상품별 값이 아니라는 점에 주의.
 */
const SITE_GENDER = '여성';

/** 응답의 sellable_status 값(사이트 번들 기준): ON_SALE, SOLD_OUT, CLOSED, NOT_SUPPORT_COUNTRY */
const STATUS_ON_SALE = 'ON_SALE';
const STATUS_SOLD_OUT = 'SOLD_OUT';
const STATUS_NOT_FOR_SALE: readonly string[] = ['CLOSED', 'NOT_SUPPORT_COUNTRY'];

/** 사이트(기획전 페이지)가 보내는 쿼리 그대로. 조각을 공백 하나로 잇는다. */
const PRODUCTS_QUERY = [
  'fragment CmsProductsPresetProductCardItemListPart on CmsProductsPresetProductCardItemList { item_list { ...CmsProductsPresetProductCardItemPart } total_count end_cursor exposure_order_type has_next_page }',
  'fragment CmsProductsPresetProductCardItemPart on CmsProductsPresetProductCardItem { shop { ...CmsProductsPresetShopPart } product { ...CmsProductsPresetProductPart } }',
  'fragment CmsProductsPresetShopPart on CmsProductsPresetShop { id main_domain name }',
  'fragment CmsProductsPresetProductPart on CmsProductsPresetProduct { image_url webp_image_url product_url title discount_rate free_shipping zpay has_coupon price final_price is_saved_product final_price_with_currency { ...CmsPriceWithCurrencyPart } max_price_with_currency { ...CmsPriceWithCurrencyPart } is_zpay_discount catalog_product_id browsing_type review_count review_score shop_product_no shop_id is_zonly is_brand sellable_status discount_info { ...CmsDiscountInfoPart } badge_list { ...CmsDisplayBadgePart } brand_name_badge_list { ...CmsDisplayBadgePart } thumbnail_nudge_badge_list { ...CmsDisplayBadgePart } thumbnail_emblem_badge_list { ...CmsDisplayBadgePart } log is_enabled_not_my_tasty card_item_style metadata_emblem_badge_list { ...CmsDisplayBadgePart } thumbnail_overlay_image_url is_saved_product }',
  'fragment CmsPriceWithCurrencyPart on CmsPriceWithCurrency { currency decimal price_without_decimal display_currency is_currency_prefix }',
  'fragment CmsDiscountInfoPart on CmsDiscountInfo { image_url title color issue_end_date }',
  'fragment CmsDisplayBadgePart on CmsDisplayBadge { image_url dark_image_url small_image_url small_dark_image_url image_size { ...CmsImageSizePart } small_image_size { ...CmsImageSizePart } }',
  'fragment CmsImageSizePart on CmsImageSize { width height }',
  'query GetCmsProductsPresetProductCardItemList($input: CmsProductsPresetProductCardItemListSearchInput!) { cms_products_preset_product_card_item_list(input: $input) { ...CmsProductsPresetProductCardItemListPart } }',
].join(' ');

type Json = Record<string, unknown>;
type DealEvent = NonNullable<RawDeal['event']>;

export interface ZigzagEventLink {
  uuid: string;
  url: string;
  /** 배너 문구 세 줄을 이은 것 */
  title: string;
}

/** 기획전 안의 상품 그룹(탭) 하나. 상품 목록 요청의 단위다. */
export interface ZigzagProductGroup {
  presetUuid: string;
  groupIndex: number;
  /** 탭 이름. 카테고리("아우터")일 수도, 브랜드("스파오")나 "전체"일 수도 있다. */
  name: string | null;
  totalCount: number | null;
  /** ProductRail · ProductList · ProductTab */
  moduleType: string;
}

export interface ZigzagEventPage {
  event: DealEvent;
  groups: ZigzagProductGroup[];
}

export interface ZigzagProductsRequest {
  url: string;
  /** 출처 헤더(Origin·Referer). Content-Type은 ctx.postJson이 붙인다. */
  headers: Readonly<Record<string, string>>;
  body: { query: string; variables: { input: Json } };
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** 0 이상의 정수(숫자 또는 "12" 같은 문자열). 그 밖은 null */
function toIndex(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  return typeof v === 'string' && DIGITS.test(v) ? Number(v) : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** __NEXT_DATA__에 미리 담긴 조회 결과 중 queryKey가 keys로 시작하는 것의 data. 없으면 null */
function readDehydratedData(html: string, ...keys: string[]): Json | null {
  const next = readNextData(html);
  const props = isObj(next) && isObj(next.props) ? next.props.pageProps : null;
  const state = isObj(props) ? props.dehydratedState : null;
  if (!isObj(state)) return null;
  const query = list(state.queries).find(
    (q) => Array.isArray(q.queryKey) && keys.every((key, i) => (q.queryKey as unknown[])[i] === key),
  );
  const data = query && isObj(query.state) ? query.state.data : null;
  return isObj(data) ? data : null;
}

/** 홈 HTML → 배너에 걸린 기획전 주소와 문구. 같은 기획전은 첫 번째만. */
export function parseZigzagEventLinks(homeHtml: string): ZigzagEventLink[] {
  const banners = readDehydratedData(homeHtml, 'banner', 'list');
  if (!banners) return [];

  const links: ZigzagEventLink[] = [];
  const seen = new Set<string>();
  for (const item of list(banners.item_list)) {
    // landing_url 예: zigzag://open/simple_browser?url=https%3A%2F%2Fstore.zigzag.kr%2Fevents%2F<uuid>&features=ct,home
    const uuid = EVENT_PATH.exec(safeDecode(str(item.landing_url) ?? ''))?.[1];
    const title = [item.main_title_first, item.main_title_second, item.sub_title].map(str).filter(Boolean).join(' ');
    if (!uuid || !title || seen.has(uuid)) continue;
    seen.add(uuid);
    links.push({ uuid, url: `${EVENT_PAGE}${uuid}`, title });
  }
  return links;
}

/** 홈 기획전 목록에서 이번에 돌 블프 의류 기획전만 고른다(홈 순서). */
export function pickZigzagEvents(links: ZigzagEventLink[], max: number = MAX_EVENTS): ZigzagEventLink[] {
  return links.filter((link) => BF_KEYWORDS.test(link.title) && !NOT_CLOTHING.test(link.title)).slice(0, max);
}

/** visible_between [시작, 끝](밀리초)이 있으면 그 안에서만 보인다. */
function isVisibleAt(component: Json, nowMs: number): boolean {
  const range = component.visible_between;
  if (!Array.isArray(range)) return true;
  const start = num(range[0]);
  const end = num(range[1]);
  return (start === null || start <= nowMs) && (end === null || nowMs <= end);
}

/** 상품 모듈 하나의 그룹들. 상품 묶음(preset)이 없는 모듈(추천 등)은 빈 배열. */
function groupsOfModule(component: Json, counts: Map<string, number>): ZigzagProductGroup[] {
  const presetUuid = str(component.products_preset_uuid);
  const moduleType = str(component.__type);
  if (!presetUuid || !UUID.test(presetUuid) || !moduleType) return [];
  const headers: unknown[] = Array.isArray(component.group_header_data) ? component.group_header_data : [];
  const moduleCounts: unknown[] = Array.isArray(component.total_count_list) ? component.total_count_list : [];

  return headers.map((header, groupIndex) => {
    const moduleCount: unknown = moduleCounts[groupIndex];
    return {
      presetUuid,
      groupIndex,
      name: isObj(header) ? str(header.title) : str(header),
      totalCount: counts.get(`${presetUuid}:${groupIndex}`) ?? (isObj(moduleCount) ? num(moduleCount.total_count) : null),
      moduleType,
    };
  });
}

/**
 * 화면 구성 트리를 순서대로 돌며, 지금 보이는 상품 모듈의 그룹을 모은다.
 * 숨겨진 구성 요소와 component_map에 없는 구성 요소는 그 아래 가지까지 건너뛴다(보이는지 알 수 없으므로).
 */
function collectGroups(nodes: unknown, components: Json, counts: Map<string, number>, nowMs: number): ZigzagProductGroup[] {
  const groups: ZigzagProductGroup[] = [];
  for (const node of list(nodes)) {
    const id = str(node.uuid);
    const component = id !== null && Object.hasOwn(components, id) ? components[id] : null;
    if (!isObj(component) || !isVisibleAt(component, nowMs)) continue;
    groups.push(...groupsOfModule(component, counts), ...collectGroups(node.children, components, counts, nowMs));
  }
  return groups;
}

/**
 * 기획전 HTML → 기획전 정보와 상품 그룹 목록. 기획전 페이지가 아니면 null.
 * - 종료 시각은 기획전의 date_ended(밀리초). 상품별 종료 시각은 어디에도 없다.
 * - 그룹별 상품 수는 페이지에 미리 담긴 값(web_rendering_metadata)이며, 없으면 null.
 */
export function parseZigzagEvent(html: string, pageUrl: string, now: Date = new Date()): ZigzagEventPage | null {
  const data = readDehydratedData(html, 'getCmsContentEditor');
  const editor = data && isObj(data.content_editor_json) ? data.content_editor_json : null;
  const name = data ? str(data.title) : null;
  if (!data || !editor || !name || !isObj(editor.component_map)) return null;

  const counts = new Map<string, number>();
  const metadata = isObj(data.web_rendering_metadata) ? data.web_rendering_metadata : {};
  for (const entry of list(metadata.product_preset_item_count)) {
    const uuid = str(entry.uuid);
    const groupIndex = toIndex(entry.group_index);
    const total = num(entry.total_count);
    if (uuid !== null && groupIndex !== null && total !== null) counts.set(`${uuid}:${groupIndex}`, total);
  }

  const seen = new Set<string>();
  const groups = collectGroups(editor.component_relations, editor.component_map, counts, now.getTime()).filter((g) => {
    const key = `${g.presetUuid}:${g.groupIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const ended = num(data.date_ended);
  const hasEnd = ended !== null && ended > 0 && ended + KST_OFFSET_MS <= MAX_DATE_MS;
  return { event: { name, url: pageUrl, endsAt: hasEnd ? msToKstIso(ended) : null }, groups };
}

/**
 * 상품 목록 요청(ctx.postJson에 넘길 주소·출처 헤더·본문). 쿼리와 input 이름은 사이트 번들이 보내는 것 그대로다.
 * - `limit` 없이 보내면 그룹 전체가 한 번에 온다(2026-11-28: 323개, 1.1MB — fixtures의 products-request.json).
 * - `limit`(쪽 크기)과 `after`(응답의 end_cursor)는 사이트가 "더보기"에 쓰는 input이다.
 *   `limit: 50`은 실수집에서 동작을 확인했다(2026-11-28). `after`는 보내 보지 않았다.
 * - Origin·Referer가 없으면 CloudFront가 본문 없는 200(x-cache: Error from cloudfront)을 준다.
 *   쿠키·토큰·User-Agent 위장은 필요 없다.
 */
export function buildZigzagProductsRequest(
  group: Pick<ZigzagProductGroup, 'presetUuid' | 'groupIndex'>,
  options: { after?: string | null; limit?: number } = {},
): ZigzagProductsRequest {
  const input: Json = {
    products_preset_uuid: group.presetUuid,
    group_index: group.groupIndex,
    after: options.after ?? null,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
  return { url: PRODUCTS_API, headers: SITE_HEADERS, body: { query: PRODUCTS_QUERY, variables: { input } } };
}

/** 응답에서 상품 목록 객체를 꺼낸다. 오류 응답·빈 응답이면 null */
function readProductList(raw: unknown): Json | null {
  const body = typeof raw === 'string' ? safeParse(raw) : raw;
  const data = isObj(body) ? body.data : null;
  const found = isObj(data) ? data.cms_products_preset_product_card_item_list : null;
  return isObj(found) ? found : null;
}

function toDeal(item: Json, context: { rawCategory?: string | null; event?: DealEvent | null }): RawDeal | null {
  const product = isObj(item.product) ? item.product : null;
  if (!product) return null;
  const rawId = typeof product.catalog_product_id === 'number' ? String(product.catalog_product_id) : str(product.catalog_product_id);
  const id = rawId !== null && DIGITS.test(rawId) ? rawId : null;
  const name = str(product.title);
  const salePrice = num(product.final_price);
  const status = str(product.sellable_status);
  if (!id || !name || salePrice === null || (status !== null && STATUS_NOT_FOR_SALE.includes(status))) return null;

  const maxPrice = product.max_price_with_currency;
  const imageUrl = str(product.image_url);
  const rate = num(product.discount_rate);
  return {
    siteProductId: id,
    name,
    // 카드에서 브랜드 자리에 나오는 스토어 이름
    brand: isObj(item.shop) ? str(item.shop.name) : null,
    url: `${PRODUCT_PAGE}${id}`,
    imageUrl: imageUrl !== null && ABSOLUTE_URL.test(imageUrl) ? imageUrl : null,
    originalPrice: isObj(maxPrice) ? num(maxPrice.price_without_decimal) : null,
    salePrice,
    displayedDiscountRate: rate !== null && rate > 0 ? rate : null,
    endsAt: null,
    rawCategory: context.rawCategory ?? null,
    rawGender: SITE_GENDER,
    // 모르는 판매 상태(값이 없거나 새 값)면 품절 여부를 비워 둔다.
    ...(status === STATUS_SOLD_OUT ? { soldOut: true } : status === STATUS_ON_SALE ? { soldOut: false } : {}),
    event: context.event ?? null,
  };
}

/**
 * 상품 목록 응답 → RawDeal[].
 * - salePrice·displayedDiscountRate는 카드가 보여 주는 값(`final_price`·`discount_rate`): 쿠폰까지 적용한 가격이고,
 *   상품 페이지의 final_discount_info와 같다(상품 1개 대조).
 * - originalPrice는 줄 그은 가격(`max_price_with_currency`). `price`는 그보다 낮은 판매가일 수 있어 정가로 쓰지 않는다
 *   (사이트 할인율은 max_price 기준: 323개 중 322개 일치). 줄 그은 가격이 없으면 null.
 * - 상품별 종료 시각은 없다(`discount_info`는 받은 응답 전부 null) → endsAt null.
 * - rawCategory·event는 응답에 없어 호출한 쪽(그룹 이름·기획전 정보)이 넘겨준다.
 * - 판매 종료(CLOSED)·국내 미판매(NOT_SUPPORT_COUNTRY) 상품은 뺀다.
 */
export function parseZigzagProducts(
  raw: unknown,
  context: { rawCategory?: string | null; event?: DealEvent | null } = {},
): RawDeal[] {
  const found = readProductList(raw);
  if (!found) return [];
  return list(found.item_list).flatMap((item) => toDeal(item, context) ?? []);
}

/** 다음 쪽을 받을 커서(요청의 `after`). 다음 쪽이 없으면 null */
export function parseZigzagNextCursor(raw: unknown): string | null {
  const found = readProductList(raw);
  return found && found.has_next_page === true ? str(found.end_cursor) : null;
}

/**
 * 이번 실행에서 읽을 순서로 그룹을 늘어놓는다(요청 상한 안에서 여러 탭·카테고리를 고루 읽기 위해).
 * 카테고리 탭 모듈 먼저, 그 안에서는 묶음(preset)마다 한 그룹씩 번갈아(그룹 번호순), 나머지는 화면 순서.
 * 상품이 0개라고 적힌 그룹은 뺀다.
 */
export function orderZigzagGroups(groups: readonly ZigzagProductGroup[]): ZigzagProductGroup[] {
  const tier = (group: ZigzagProductGroup): number => {
    const index = MODULE_PRIORITY.indexOf(group.moduleType);
    return index < 0 ? MODULE_PRIORITY.length : index;
  };
  // sort는 순서를 보존하므로(stable) 같은 등급·같은 그룹 번호끼리는 화면 순서가 남는다.
  return groups.filter((g) => g.totalCount !== 0).sort((a, b) => tier(a) - tier(b) || a.groupIndex - b.groupIndex);
}

const canRequest = (ctx: CrawlContext): boolean => ctx.requestsLeft > 0 && !ctx.signal.aborted;

/** 차단·요청 상한·중단은 그대로 올려 보내고, 그 밖의 실패(404, 빈 응답, 시간 초과 등)만 사유 문자열로 바꾼다. */
function skippableReason(ctx: CrawlContext, error: unknown): string {
  if (getCrawlErrorKind(error) !== null || ctx.signal.aborted) throw error;
  return error instanceof Error ? error.message : String(error);
}

/** 기획전 페이지 하나. 읽지 못하면 기록하고 null */
async function readEvent(ctx: CrawlContext, link: ZigzagEventLink): Promise<ZigzagEventPage | null> {
  let html: string;
  try {
    html = await ctx.fetchHtml(link.url, { raw: true });
  } catch (error: unknown) {
    ctx.log(`지그재그: 기획전 건너뜀 (${link.url}) — ${skippableReason(ctx, error)}`);
    return null;
  }
  const page = parseZigzagEvent(html, link.url);
  if (!page || page.groups.length === 0) {
    ctx.log(`지그재그: 기획전 건너뜀 (${link.url}) — ${page ? '상품 그룹이 없음' : '기획전 구조를 찾지 못함'}`);
    return null;
  }
  return page;
}

/** 그룹 하나의 상품. 응답을 읽지 못하면 기록하고 null (빈 그룹은 []). */
async function readGroup(ctx: CrawlContext, page: ZigzagEventPage, group: ZigzagProductGroup): Promise<RawDeal[] | null> {
  const label = `${page.event.name} / ${group.name ?? `그룹 ${group.groupIndex}`}`;
  const request = buildZigzagProductsRequest(group, { limit: PAGE_SIZE });
  let answer: unknown;
  try {
    answer = await ctx.postJson(request.url, request.body, { headers: request.headers });
  } catch (error: unknown) {
    ctx.log(`지그재그: 그룹 건너뜀 (${label}) — ${skippableReason(ctx, error)}`);
    return null;
  }
  if (readProductList(answer) === null) {
    ctx.log(`지그재그: 그룹 건너뜀 (${label}) — 상품 목록이 없는 응답: ${JSON.stringify(answer)?.slice(0, 200)}`);
    return null;
  }
  const rawCategory = group.moduleType === CATEGORY_TAB_MODULE ? group.name : null;
  return parseZigzagProducts(answer, { rawCategory, event: page.event }).slice(0, MAX_DEALS_PER_GROUP);
}

async function crawl(ctx: CrawlContext): Promise<RawDeal[]> {
  const links = pickZigzagEvents(parseZigzagEventLinks(await ctx.fetchHtml(HOME, { raw: true })));
  if (links.length === 0) {
    ctx.log('지그재그: 홈에서 블프 기획전을 찾지 못함');
    return [];
  }

  // 1) 기획전 페이지를 먼저 다 읽어, 남은 요청을 기획전끼리 똑같이 나눈다.
  const pages: ZigzagEventPage[] = [];
  for (const link of links) {
    if (!canRequest(ctx)) break;
    const page = await readEvent(ctx, link);
    if (page) pages.push(page);
  }

  // 2) 기획전마다 그룹별 상품 목록. 같은 상품은 먼저 읽은 것만 남긴다.
  const deals = new Map<string, RawDeal>();
  let failuresInARow = 0;
  const shouldStop = (): boolean =>
    !canRequest(ctx) || deals.size >= MAX_DEALS || failuresInARow >= MAX_GROUP_FAILURES_IN_A_ROW;

  for (const [index, page] of pages.entries()) {
    const share = Math.floor(ctx.requestsLeft / (pages.length - index));
    let added = 0;
    for (const group of orderZigzagGroups(page.groups).slice(0, share)) {
      if (shouldStop()) break;
      const found = await readGroup(ctx, page, group);
      failuresInARow = found === null ? failuresInARow + 1 : 0;
      for (const deal of found ?? []) {
        if (deals.has(deal.siteProductId) || deals.size >= MAX_DEALS) continue;
        deals.set(deal.siteProductId, deal);
        added += 1;
      }
    }
    ctx.log(`지그재그: ${page.event.name} ${added}개`);
  }
  if (failuresInARow >= MAX_GROUP_FAILURES_IN_A_ROW) ctx.log('지그재그: 그룹 요청이 잇달아 실패해 중단함');
  return [...deals.values()];
}

export const zigzag: SiteAdapter = {
  id: 'zigzag',
  displayName: '지그재그',
  homeUrl: HOME,
  // 홈·기획전 원본 HTML은 stealth로 받는 것만 확인했다(2026-11-28). 상품 목록 POST는 Obscura를 거치지 않는다.
  stealth: true,
  // robots.txt가 목록에 없는 봇을 전부 막는다(User-agent: * / Disallow: /). 소유자 결정으로 끔(2026-11-28).
  obeyRobots: false,
  maxRequests: MAX_REQUESTS,
  crawl,
};

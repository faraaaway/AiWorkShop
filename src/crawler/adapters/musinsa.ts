import type { CrawlContext, RawDeal, SiteAdapter } from '@/lib/types';

/**
 * 무신사 — 무진장 블랙프라이데이 캠페인.
 *
 * 캠페인 페이지(https://www.musinsa.com/campaign/mujinjangsale/special)는 화면을 JSON API로 그린다.
 *   1) meta                → 캠페인 이름·종료 시각, 탭("특가" 등)과 그 안의 모듈 목록
 *   2) modules/<uuid>      → 모듈(기획전) 제목·종료 시각, 카테고리 탭 목록
 *   3) tabs/<uuid>/goods   → 상품 목록 (한 번에 36개)
 * 원본 예시는 fixtures/sites/musinsa/ 참고.
 */

const CAMPAIGN_ID = 'mujinjangwinter2026';
const API_ORIGIN = 'https://api.musinsa.com';
const CAMPAIGN_API = `${API_ORIGIN}/api2/cpcms/cpcms/v3/MUSINSA/${CAMPAIGN_ID}`;
const API_QUERY = 'countryCode=KR&locale=ko-KR&gf=A';
const CAMPAIGN_PAGE = 'https://www.musinsa.com/campaign/mujinjangsale/special';
const PRODUCT_PAGE = 'https://www.musinsa.com/products/';

/** 상품을 읽을 탭("특가")과 모듈 종류. 다른 종류(쿠폰·배너·랭킹 등)는 건너뛴다. */
const DEAL_LINK_TAB_TITLE = '특가';
const GOODS_MODULE_TYPE = 'GOODS_MIXED';
const ALL_TAB_NAME = '전체';

/** 요청 상한(maxRequests) 안에서 나눠 쓰기 위한 내부 상한 */
const MAX_MODULE_LOOKUPS = 8;
const MAX_GOODS_MODULES = 3;

/**
 * 상품의 gender 코드 → 사이트 성별 필터 표기.
 * 성별 필터 gf=M 결과에는 2·6만, gf=F 결과에는 4·6만 나오는 것을 확인했다(2026-11-27).
 * 그 밖의 코드(예: 뷰티 상품의 16)는 뜻을 확인하지 못해 null로 둔다.
 */
const GENDER_LABELS: Record<number, string> = { 2: '남성', 4: '여성', 6: '남녀공용' };

type Json = Record<string, unknown>;
type DealEvent = NonNullable<RawDeal['event']>;

export interface MusinsaCampaign {
  name: string;
  endsAt: string | null;
  /** "특가" 탭 안의 모듈들 (화면 순서) */
  modules: { uuid: string; title: string; focusId: string | null }[];
}

export interface MusinsaModule {
  type: string;
  title: string;
  focusId: string | null;
  endsAt: string | null;
  tabs: { name: string; goodsUrl: string | null; endsAt: string | null }[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** 129000, "129,000원" → 129000. 읽지 못하면 null */
function toWon(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const digits = v.replace(/[^\d]/g, '');
  return digits === '' ? null : Number(digits);
}

function toAbsoluteUrl(v: unknown, origin: string): string | null {
  const s = str(v);
  if (!s) return null;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `${origin}${s}`;
  return s;
}

/** API 응답 `{ meta: { result }, data }`에서 data를 꺼낸다. 실패 응답이면 null */
function unwrap(raw: unknown): Json | null {
  const body = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!isObj(body)) return null;
  if (isObj(body.meta) && body.meta.result !== 'SUCCESS') return null;
  return isObj(body.data) ? body.data : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** meta 응답 → 캠페인 정보와 "특가" 탭의 모듈 목록 */
export function parseMusinsaCampaign(raw: unknown): MusinsaCampaign | null {
  const data = unwrap(raw);
  if (!data || !isObj(data.meta)) return null;
  const name = str(data.meta.title);
  if (!name) return null;

  const linkTabs = list(data.linkTabList);
  const dealTab = linkTabs.find((t) => t.title === DEAL_LINK_TAB_TITLE);
  const anchors = dealTab ? list(dealTab.anchorList) : linkTabs.flatMap((t) => list(t.anchorList));

  const modules: MusinsaCampaign['modules'] = [];
  for (const a of anchors) {
    const uuid = str(a.moduleUuid);
    const title = str(a.anchorTitle);
    if (uuid && title) modules.push({ uuid, title, focusId: str(a.anchorTabFocusId) });
  }
  return { name, endsAt: str(data.meta.endAt), modules };
}

/** modules/<uuid> 응답 → 모듈 제목·종료 시각·카테고리 탭 */
export function parseMusinsaModule(raw: unknown): MusinsaModule | null {
  const data = unwrap(raw);
  if (!data) return null;
  const type = str(data.moduleType);
  const content = isObj(data.content) ? data.content : null;
  if (!type || !content) return null;

  const timer = isObj(content.titleTimer) ? content.titleTimer : {};
  const title = str(data.anchorTitle) ?? str(timer.title);
  if (!title) return null;
  const moduleEndsAt = str(timer.timerEndAt) ?? str(data.displayEndDt);

  const tabs = list(content.moduleTabList).flatMap((t) => {
    const name = str(t.tabName);
    if (!name) return [];
    return [{ name, goodsUrl: toAbsoluteUrl(t.tabLazyLoadApiUrl, API_ORIGIN), endsAt: str(t.displayEndDt) }];
  });
  return { type, title, focusId: str(data.anchorTabFocusId), endsAt: moduleEndsAt, tabs };
}

/**
 * goods 응답 → RawDeal[].
 * - salePrice·displayedDiscountRate는 상품 페이지가 대표로 보여 주는 값(`finalPrice`·`finalDiscount`).
 *   쿠폰 할인 상품이면 "쿠폰적용가"이고, 아니면 판매가(`price`·`saleRate`)와 같다.
 * - 상품별 할인 종료 시각은 응답에 없어 endsAt은 null (기획전 종료 시각은 event.endsAt).
 * - rawCategory·event는 응답에 없어서 호출한 쪽(탭 이름·모듈 정보)이 넘겨준다.
 */
export function parseMusinsa(
  raw: unknown,
  context: { rawCategory?: string | null; event?: DealEvent | null } = {},
): RawDeal[] {
  const data = unwrap(raw);
  if (!data) return [];

  const deals: RawDeal[] = [];
  for (const g of list(data.goodsList)) {
    const goodsNo = typeof g.goodsNo === 'number' ? String(g.goodsNo) : str(g.goodsNo);
    const name = str(g.goodsName);
    const salePrice = toWon(g.finalPrice) ?? toWon(g.price);
    if (!goodsNo || !name || salePrice === null) continue;
    const rate = typeof g.finalDiscount === 'number' ? g.finalDiscount : g.saleRate;

    deals.push({
      siteProductId: goodsNo,
      name,
      brand: str(g.brandName),
      url: `${PRODUCT_PAGE}${goodsNo}`,
      imageUrl: toAbsoluteUrl(g.goodsImage, 'https://image.msscdn.net'),
      originalPrice: toWon(g.normalPrice),
      salePrice,
      displayedDiscountRate: typeof rate === 'number' ? rate : null,
      endsAt: null,
      rawCategory: context.rawCategory ?? null,
      rawGender: typeof g.gender === 'number' ? (GENDER_LABELS[g.gender] ?? null) : null,
      soldOut: g.goodsStatus === 'SOLD_OUT',
      event: context.event ?? null,
    });
  }
  return deals;
}

async function crawl(ctx: CrawlContext): Promise<RawDeal[]> {
  let used = 0;
  const budget = musinsa.maxRequests;
  const canRequest = () => used < budget && !ctx.signal.aborted;
  const getJson = (url: string) => {
    used += 1;
    return ctx.fetchJson(url);
  };

  // 1) 행사 목록
  const campaign = parseMusinsaCampaign(await getJson(`${CAMPAIGN_API}/meta`));
  if (!campaign) {
    ctx.log('무신사: 캠페인 정보를 읽지 못함');
    return [];
  }

  // 2) "특가" 탭에서 상품 모듈 찾기
  const goodsModules: MusinsaModule[] = [];
  let lookups = 0;
  for (const ref of campaign.modules) {
    if (goodsModules.length >= MAX_GOODS_MODULES || lookups >= MAX_MODULE_LOOKUPS || !canRequest()) break;
    lookups += 1;
    const mod = parseMusinsaModule(await getJson(`${CAMPAIGN_API}/modules/${ref.uuid}?${API_QUERY}`));
    if (mod && mod.type === GOODS_MODULE_TYPE && mod.tabs.some((t) => t.goodsUrl)) goodsModules.push(mod);
  }
  if (goodsModules.length === 0) {
    ctx.log(`무신사: 상품 모듈을 찾지 못함 (${campaign.modules.length}개 중 ${lookups}개 확인)`);
    return [];
  }

  // 3) 모듈마다 카테고리 탭의 상품 목록 (남은 요청 수를 모듈끼리 똑같이 나눔)
  const tabsPerModule = Math.max(1, Math.floor((budget - used) / goodsModules.length));
  const deals: RawDeal[] = [];
  for (const mod of goodsModules) {
    const withGoods = mod.tabs.filter((t) => t.goodsUrl);
    const categoryTabs = withGoods.filter((t) => t.name !== ALL_TAB_NAME);
    const tabs = (categoryTabs.length > 0 ? categoryTabs : withGoods).slice(0, tabsPerModule);

    for (const tab of tabs) {
      if (!canRequest()) break;
      const event: DealEvent = {
        name: `${campaign.name} · ${mod.title}`,
        url: mod.focusId ? `${CAMPAIGN_PAGE}#${mod.focusId}` : CAMPAIGN_PAGE,
        endsAt: mod.endsAt ?? tab.endsAt ?? campaign.endsAt,
      };
      const found = parseMusinsa(await getJson(tab.goodsUrl as string), {
        rawCategory: tab.name === ALL_TAB_NAME ? null : tab.name,
        event,
      });
      ctx.log(`무신사: ${mod.title} / ${tab.name} ${found.length}개`);
      deals.push(...found);
    }
  }
  return deals;
}

export const musinsa: SiteAdapter = {
  id: 'musinsa',
  displayName: '무신사',
  homeUrl: 'https://www.musinsa.com',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  crawl,
};

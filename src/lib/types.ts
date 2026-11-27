/**
 * Shared contract for the whole project.
 * Source of truth: specs/001-bf-deal-tracker/data-model.md and contracts/.
 * Only the Core owner edits this file; announce any change to the team.
 */

// ---------- Enumerations ----------

export const SITE_IDS = [
  'musinsa',
  '29cm',
  'wconcept',
  'naver',
  'zigzag',
  'ably',
  'queenit',
  'posty',
  '4910',
  'attrangs',
] as const;
export type SiteId = (typeof SITE_IDS)[number];

export const GENDERS = ['men', 'women', 'unisex', 'unclassified'] as const;
export type Gender = (typeof GENDERS)[number];

export const THEMES = [
  'outer',
  'top',
  'knit',
  'bottom',
  'dress',
  'setup',
  'shoes',
  'bag_acc',
  'inner_home',
  'etc',
  'unclassified',
] as const;
export type Theme = (typeof THEMES)[number];

export const SITE_STATES = [
  'ok',
  'failed',
  'suspect_layout',
  'blocked',
  'login_required',
  'disabled',
  'not_implemented',
  'never_run',
] as const;
export type SiteState = (typeof SITE_STATES)[number];

/** Whether a crawl of the site is happening right now (not stored; filled by GET /api/status). */
export type RunPhase = 'idle' | 'queued' | 'running';

export type EndsAtSource = 'product' | 'event';

/** ISO 8601 string with KST offset, e.g. `2026-11-30T23:59:00+09:00`. */
export type IsoDateTime = string;

// ---------- RawDeal (adapter -> core) ----------

export interface RawDealEvent {
  name: string;
  url: string;
  endsAt: IsoDateTime | null;
}

/**
 * What an adapter returns: values as read from the site, no calculation.
 * Unknown values are `null` (or omitted). Never guess.
 */
export interface RawDeal {
  /** Product id inside the site; used as the de-duplication key. */
  siteProductId: string;
  name: string;
  brand?: string | null;
  /** Absolute product page URL. */
  url: string;
  /** Absolute image URL. */
  imageUrl?: string | null;
  /** List price in KRW. */
  originalPrice?: number | null;
  /** Sale price in KRW. */
  salePrice: number;
  /** Discount rate (%) as displayed by the site. */
  displayedDiscountRate?: number | null;
  /**
   * Per-product sale end time. Any string `Date.parse` understands as an absolute instant is
   * accepted; normalize() rewrites it to the `+09:00` form and drops it (null) when unparseable.
   * For Korean text such as "~11.30(일) 23:59" use parseKoreanEndDate() from '@/lib/dates'.
   */
  endsAt?: IsoDateTime | null;
  /** Site category path, e.g. "여성 > 아우터 > 패딩". */
  rawCategory?: string | null;
  /** Gender wording given by the site. */
  rawGender?: string | null;
  soldOut?: boolean;
  /** Sale event (기획전) this product was found in. */
  event?: RawDealEvent | null;
}

// ---------- Deal (stored and displayed) ----------

export interface Deal {
  /** `${siteId}:${siteProductId}` */
  id: string;
  siteId: SiteId;
  name: string;
  brand: string | null;
  url: string;
  imageUrl: string | null;
  originalPrice: number | null;
  salePrice: number;
  /** Whole percent 0..99, or null when unknown. */
  discountRate: number | null;
  /** Site-displayed rate; shown next to discountRate when they differ by more than 1%p. */
  displayedDiscountRate: number | null;
  endsAt: IsoDateTime | null;
  endsAtSource: EndsAtSource | null;
  eventName: string | null;
  eventUrl: string | null;
  gender: Gender;
  theme: Theme;
  soldOut: boolean;
  crawledAt: IsoDateTime;
}

// ---------- SiteStatus ----------

/**
 * Rules (data-model.md "상태 전이"):
 * - `enabled` is the only user switch and the only reason `--site all` skips a site.
 *   The runner never writes it.
 * - The stored `state` is always the result of the last run ('never_run' before the first one,
 *   'not_implemented' while the adapter is still a stub). 'disabled' is never stored: readers
 *   derive it when `enabled === false`, so switching a site back on shows its last result again.
 */
export interface SiteStatus {
  siteId: SiteId;
  enabled: boolean;
  state: SiteState;
  lastRunAt: IsoDateTime | null;
  lastSuccessAt: IsoDateTime | null;
  dealCount: number;
  /** Human-readable error / block summary. */
  message: string | null;
  /** No automatic retry before this time. */
  cooldownUntil: IsoDateTime | null;
}

/** What GET /api/status returns per site: `state` already has 'disabled' derived from `enabled`. */
export interface SiteStatusView extends SiteStatus {
  displayName: string;
  /** Poll /api/status while any site is 'queued' or 'running'. */
  run: RunPhase;
}

// ---------- Files under data/ ----------

/** data/deals/<siteId>.json */
export interface DealsFile {
  siteId: SiteId;
  crawledAt: IsoDateTime;
  deals: Deal[];
}

// ---------- Adapter contract (contracts/adapter-interface.md) ----------

export interface FetchHtmlOptions {
  /** Fixed post-load wait in seconds. */
  waitSec?: number;
  /**
   * fetchHtml only: return the raw response body without rendering (no JavaScript runs). Use it
   * for server-rendered pages and HTML fragments that time out when rendered. An empty body is
   * returned as ''. Block detection still applies.
   */
  raw?: boolean;
}

/**
 * The only way an adapter may touch the network. Every call counts as one request, waits 2-4 s
 * after the previous one, and throws:
 * - BlockedError on CAPTCHA / bot wall / HTTP 403 / 429 — do NOT catch it. Once thrown, every
 *   later call throws it again, so a swallowed block cannot be saved as a success.
 * - RequestLimitError when `requestsLeft` is 0 — you may catch it and return what you have;
 *   uncaught, the run ends as 'failed' and the previously stored deals are kept.
 * Use createFakeContext() from 'tests/helpers/fakeContext' in tests instead of an object literal.
 */
export interface CrawlContext {
  /** Rendered HTML of the page. */
  fetchHtml(url: string, opts?: FetchHtmlOptions): Promise<string>;
  /** Plain GET (no custom headers, no POST) of the raw response body, parsed as JSON. */
  fetchJson<T = unknown>(url: string): Promise<T>;
  /**
   * Evaluate ONE synchronous JS expression in the rendered page. It must evaluate to an object or
   * array (promises are not awaited; a bare string is ambiguous). Returns null when the expression
   * throws or yields nothing — treat that as "structure not found" and return [].
   */
  evalPage<T = unknown>(url: string, js: string, opts?: FetchHtmlOptions): Promise<T | null>;
  log(msg: string): void;
  /** Aborted by the runner when a block is detected or the run is cancelled. */
  signal: AbortSignal;
  /** Requests still allowed in this run (SiteAdapter.maxRequests minus the ones already made). */
  readonly requestsLeft: number;
}

export interface SiteAdapter {
  id: SiteId;
  /** e.g. '무신사' */
  displayName: string;
  homeUrl: string;
  /** Use Obscura --stealth (default true). */
  stealth: boolean;
  /** Use Obscura --obey-robots (default true). */
  obeyRobots: boolean;
  /** Upper bound of requests in one run (default 30). */
  maxRequests: number;
  /** Walk the Black Friday event pages and collect RawDeals. Network only through ctx. */
  crawl(ctx: CrawlContext): Promise<RawDeal[]>;
}

// ---------- HTTP API (contracts/http-api.md) ----------

export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: string;
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

export interface DealsResponse {
  deals: Deal[];
  lastUpdatedAt: IsoDateTime | null;
}

export interface StatusResponse {
  sites: SiteStatusView[];
}

/** Body of POST /api/crawl. */
export interface CrawlRequest {
  siteId: SiteId | 'all';
  /** Ignore the cooldown (manual retry). */
  force?: boolean;
}

export type CrawlSkipReason = 'cooldown' | 'disabled' | 'running' | 'not_implemented';

export interface CrawlStartResponse {
  started: SiteId[];
  /** Sites of an 'all' request that were not started, with the reason. */
  skipped?: { siteId: SiteId; reason: CrawlSkipReason }[];
}

/** Body of PATCH /api/status/:siteId. */
export interface SiteTogglePatch {
  enabled: boolean;
}

export function isSiteId(value: unknown): value is SiteId {
  return typeof value === 'string' && (SITE_IDS as readonly string[]).includes(value);
}

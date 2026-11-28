/**
 * Browser-side client for the internal HTTP API (specs/001-bf-deal-tracker/contracts/http-api.md).
 * UI code calls these functions only; it never calls fetch directly.
 */

import sampleDealsJson from '../../fixtures/sample-deals.json';
import { READ_ONLY_MESSAGE, isReadOnlyDeploy } from '@/lib/deploy-mode';
import { SNAPSHOT_PUBLIC_PATH, parseSnapshot, type DealsSnapshot } from '@/lib/snapshot';
import type {
  ApiResponse,
  CrawlStartResponse,
  Deal,
  DealsResponse,
  IsoDateTime,
  SiteId,
  SiteStatusView,
  StatusResponse,
} from '@/lib/types';

/**
 * false: getDeals() reads GET /api/deals (real crawled data). Set to true to develop the UI
 * against fixtures/sample-deals.json without any crawl.
 */
export const USE_SAMPLE_DATA: boolean = false;

const NETWORK_ERROR_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const INVALID_RESPONSE_MESSAGE = '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.';
const UNKNOWN_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const SNAPSHOT_MISSING_MESSAGE = '공개된 할인 목록을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** `status` used when the request never reached the server. */
const NO_RESPONSE_STATUS = 0;
const HTTP_FORBIDDEN_STATUS = 403;

const SAMPLE_DEALS: readonly Deal[] = sampleDealsJson as readonly Deal[];

export class ApiError extends Error {
  /** HTTP status, or 0 when there was no response (network failure). */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface GetDealsOptions {
  /** Keep deals whose `endsAt` is already in the past. */
  includeExpired?: boolean;
  /** Reference time for the expiry check in sample mode (defaults to the current time). */
  now?: Date;
}

export interface StartCrawlOptions {
  /** Ignore the cooldown (manual retry). */
  force?: boolean;
}

// ---------- internal helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isApiResponse<T>(body: unknown): body is ApiResponse<T> {
  if (!isRecord(body)) return false;
  if (body.ok === true) return 'data' in body;
  return body.ok === false;
}

function jsonInit(method: 'POST' | 'PATCH', payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, NO_RESPONSE_STATUS);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(INVALID_RESPONSE_MESSAGE, response.status);
  }

  if (!isApiResponse<T>(body)) {
    throw new ApiError(INVALID_RESPONSE_MESSAGE, response.status);
  }
  if (!body.ok) {
    const message =
      typeof body.error === 'string' && body.error.length > 0 ? body.error : UNKNOWN_ERROR_MESSAGE;
    throw new ApiError(message, response.status);
  }
  if (!response.ok) {
    throw new ApiError(UNKNOWN_ERROR_MESSAGE, response.status);
  }
  return body.data;
}

function isExpired(deal: Deal, now: Date): boolean {
  if (deal.endsAt === null) return false;
  // An unparseable date gives NaN, which compares false: the deal is kept.
  return Date.parse(deal.endsAt) < now.getTime();
}

function latestCrawledAt(deals: readonly Deal[]): IsoDateTime | null {
  return deals.reduce<IsoDateTime | null>((latest, deal) => {
    if (latest === null) return deal.crawledAt;
    return Date.parse(deal.crawledAt) > Date.parse(latest) ? deal.crawledAt : latest;
  }, null);
}

function getSampleDeals(opts: GetDealsOptions): DealsResponse {
  const now = opts.now ?? new Date();
  const deals = opts.includeExpired
    ? [...SAMPLE_DEALS]
    : SAMPLE_DEALS.filter((deal) => !isExpired(deal, now));
  // Like the real API, the update time does not depend on the expiry filter.
  return { deals, lastUpdatedAt: latestCrawledAt(SAMPLE_DEALS) };
}

// ---------- public API ----------

/**
 * Public read-only deployment: the deals come from the static snapshot file that
 * `npm run snapshot` wrote on the owner's PC (no API route, no storage on the host).
 */
async function getSnapshotDeals(opts: GetDealsOptions): Promise<DealsResponse> {
  let response: Response;
  try {
    // no-cache: the CDN copy is revalidated, so a newly deployed snapshot shows up at once.
    response = await fetch(SNAPSHOT_PUBLIC_PATH, { cache: 'no-cache' });
  } catch {
    throw new ApiError(NETWORK_ERROR_MESSAGE, NO_RESPONSE_STATUS);
  }
  if (!response.ok) throw new ApiError(SNAPSHOT_MISSING_MESSAGE, response.status);

  let snapshot: DealsSnapshot;
  try {
    snapshot = parseSnapshot(await response.json());
  } catch {
    throw new ApiError(INVALID_RESPONSE_MESSAGE, response.status);
  }
  const now = opts.now ?? new Date();
  const deals = opts.includeExpired
    ? snapshot.deals
    : snapshot.deals.filter((deal) => !isExpired(deal, now));
  return { deals, lastUpdatedAt: snapshot.lastUpdatedAt };
}

/** Crawling and settings do not exist in the read-only deployment: fail before asking the server. */
function rejectWhenReadOnly(): void {
  if (isReadOnlyDeploy()) throw new ApiError(READ_ONLY_MESSAGE, HTTP_FORBIDDEN_STATUS);
}

/** All deals of all sites. Filtering and sorting happen on the client (lib/filters.ts). */
export async function getDeals(opts: GetDealsOptions = {}): Promise<DealsResponse> {
  if (isReadOnlyDeploy()) return getSnapshotDeals(opts);
  if (USE_SAMPLE_DATA) return getSampleDeals(opts);
  const path = opts.includeExpired ? '/api/deals?includeExpired=1' : '/api/deals';
  return request<DealsResponse>(path);
}

/** Status of all 9 sites, in fixed order. */
export async function getStatus(): Promise<StatusResponse> {
  rejectWhenReadOnly();
  return request<StatusResponse>('/api/status');
}

/** Starts a crawl in the background; poll getStatus() for progress. */
export async function startCrawl(
  siteId: SiteId | 'all',
  opts: StartCrawlOptions = {},
): Promise<CrawlStartResponse> {
  rejectWhenReadOnly();
  return request<CrawlStartResponse>(
    '/api/crawl',
    jsonInit('POST', { siteId, force: opts.force ?? false }),
  );
}

/** Turns a site on or off and returns its updated status. */
export async function setSiteEnabled(siteId: SiteId, enabled: boolean): Promise<SiteStatusView> {
  rejectWhenReadOnly();
  return request<SiteStatusView>(
    `/api/status/${encodeURIComponent(siteId)}`,
    jsonInit('PATCH', { enabled }),
  );
}

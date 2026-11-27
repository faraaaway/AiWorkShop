/**
 * Browser-side client for the internal HTTP API (specs/001-bf-deal-tracker/contracts/http-api.md).
 * UI code calls these functions only; it never calls fetch directly.
 */

import sampleDealsJson from '../../fixtures/sample-deals.json';
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

/** T026: set to false once GET /api/deals is live */
export const USE_SAMPLE_DATA: boolean = true;

const NETWORK_ERROR_MESSAGE = '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
const INVALID_RESPONSE_MESSAGE = '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.';
const UNKNOWN_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

/** `status` used when the request never reached the server. */
const NO_RESPONSE_STATUS = 0;

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

/** All deals of all sites. Filtering and sorting happen on the client (lib/filters.ts). */
export async function getDeals(opts: GetDealsOptions = {}): Promise<DealsResponse> {
  if (USE_SAMPLE_DATA) return getSampleDeals(opts);
  const path = opts.includeExpired ? '/api/deals?includeExpired=1' : '/api/deals';
  return request<DealsResponse>(path);
}

/** Status of all 9 sites, in fixed order. */
export async function getStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/api/status');
}

/** Starts a crawl in the background; poll getStatus() for progress. */
export async function startCrawl(
  siteId: SiteId | 'all',
  opts: StartCrawlOptions = {},
): Promise<CrawlStartResponse> {
  return request<CrawlStartResponse>(
    '/api/crawl',
    jsonInit('POST', { siteId, force: opts.force ?? false }),
  );
}

/** Turns a site on or off and returns its updated status. */
export async function setSiteEnabled(siteId: SiteId, enabled: boolean): Promise<SiteStatusView> {
  return request<SiteStatusView>(
    `/api/status/${encodeURIComponent(siteId)}`,
    jsonInit('PATCH', { enabled }),
  );
}

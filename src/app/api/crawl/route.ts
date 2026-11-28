/**
 * POST /api/crawl (specs/001-bf-deal-tracker/contracts/http-api.md).
 * Starts a crawl and answers at once; the crawl goes on in the background and its progress is
 * read from GET /api/status.
 */
import { getAdapter } from '@/crawler/adapters';
import { startBackgroundRun } from '@/crawler/runner';
import { READ_ONLY_MESSAGE, isReadOnlyDeploy } from '@/lib/deploy-mode';
import {
  HTTP_ACCEPTED,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  HTTP_FORBIDDEN,
  fail,
  isJsonObject,
  logServerProblem,
  ok,
  readJsonBody,
  rejectCrossSite,
  runGuarded,
} from '@/lib/http';
import { buildSkipMessage } from '@/lib/server/status-view';
import { readStatus } from '@/lib/store';
import { SITE_IDS, isSiteId } from '@/lib/types';
import type {
  CrawlRequest,
  CrawlSkipReason,
  CrawlStartResponse,
  IsoDateTime,
  SiteId,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CrawlTarget = CrawlRequest['siteId'];
type ParsedRequest = { valid: true; target: CrawlTarget; force: boolean } | InvalidRequest;
interface InvalidRequest {
  valid: false;
  message: string;
}
interface SkippedSite {
  siteId: SiteId;
  reason: CrawlSkipReason;
}

const ROUTE_LABEL = 'POST /api/crawl';
const FAILURE_MESSAGE = '수집을 시작하지 못했습니다.';
const ALL_SITES = 'all';
const FORCE_PARAM = 'force';
const FORCE_QUERY_VALUES: readonly string[] = ['1', 'true'];
/** An unknown site id is echoed back at most this long. */
const MAX_ECHO_LENGTH = 40;
const INVALID_BODY_MESSAGE =
  '요청 형식이 올바르지 않습니다. { "siteId": "musinsa" } 또는 { "siteId": "all" } 처럼 보내 주세요.';
const INVALID_FORCE_MESSAGE = 'force 값은 true 또는 false 여야 합니다.';
const KNOWN_TARGETS = [...SITE_IDS, ALL_SITES].join(', ');

function isCrawlTarget(value: unknown): value is CrawlTarget {
  return value === ALL_SITES || isSiteId(value);
}

function invalid(message: string): InvalidRequest {
  return { valid: false, message };
}

function unknownSiteMessage(siteId: unknown): string {
  const shown = typeof siteId === 'string' ? `: ${siteId.slice(0, MAX_ECHO_LENGTH)}` : '';
  return `알 수 없는 사이트입니다${shown}. 사용할 수 있는 값: ${KNOWN_TARGETS}`;
}

/** Validates the body by hand; `force` may also come as `?force=1`, the body winning. */
function parseRequest(body: unknown, forceFromQuery: boolean): ParsedRequest {
  if (!isJsonObject(body)) return invalid(INVALID_BODY_MESSAGE);
  const { siteId, force } = body;
  if (!isCrawlTarget(siteId)) return invalid(unknownSiteMessage(siteId));
  if (force !== undefined && typeof force !== 'boolean') return invalid(INVALID_FORCE_MESSAGE);
  return { valid: true, target: siteId, force: force ?? forceFromQuery };
}

function isForcedByQuery(request: Request): boolean {
  const value = new URL(request.url).searchParams.get(FORCE_PARAM);
  return value !== null && FORCE_QUERY_VALUES.includes(value);
}

/** Only used to word the cooldown message, so an unreadable status costs the time, not the answer. */
async function readCooldownUntil(siteId: SiteId): Promise<IsoDateTime | null> {
  try {
    return (await readStatus(siteId)).cooldownUntil;
  } catch (error) {
    logServerProblem(`${ROUTE_LABEL} ${siteId} 쿨다운 시각을 읽지 못했습니다`, error);
    return null;
  }
}

/** 409 for a single-site request that did not start, worded by the reason. */
async function explainNotStarted(
  siteId: SiteId,
  skipped: readonly SkippedSite[],
): Promise<Response> {
  const reason = skipped.find((entry) => entry.siteId === siteId)?.reason;
  if (reason === undefined) {
    throw new Error(`${siteId} 수집이 시작되지도 건너뛰어지지도 않았습니다`);
  }
  const cooldownUntil = reason === 'cooldown' ? await readCooldownUntil(siteId) : null;
  const { displayName } = getAdapter(siteId);
  return fail(buildSkipMessage(reason, displayName, cooldownUntil, new Date()), HTTP_CONFLICT);
}

async function handlePost(request: Request): Promise<Response> {
  // 공개 배포판은 수집하지 않는다: 누구나 누를 수 있고, 그곳에는 Obscura도 저장 공간도 없다.
  if (isReadOnlyDeploy()) return fail(READ_ONLY_MESSAGE, HTTP_FORBIDDEN);
  const rejection = rejectCrossSite(request);
  if (rejection !== null) return rejection;
  const parsed = parseRequest(await readJsonBody(request), isForcedByQuery(request));
  if (!parsed.valid) return fail(parsed.message, HTTP_BAD_REQUEST);
  const { target, force } = parsed;

  const { started, skipped } = await startBackgroundRun(target, { force });
  if (target !== ALL_SITES && !started.includes(target)) {
    return explainNotStarted(target, skipped);
  }
  const data: CrawlStartResponse =
    skipped.length > 0
      ? { started: [...started], skipped: [...skipped] }
      : { started: [...started] };
  return ok(data, HTTP_ACCEPTED);
}

export async function POST(request: Request): Promise<Response> {
  return runGuarded(ROUTE_LABEL, FAILURE_MESSAGE, () => handlePost(request));
}

/**
 * GET /api/deals (specs/001-bf-deal-tracker/contracts/http-api.md).
 * All stored deals of all sites; filtering and sorting happen in the browser.
 */
import { isExpired } from '@/lib/dates';
import { logServerProblem, ok, runGuarded } from '@/lib/http';
import { latestSuccessAt, partitionSettledStatuses } from '@/lib/server/status-view';
import { readAllDeals, readStatus } from '@/lib/store';
import { SITE_IDS } from '@/lib/types';
import type { DealsResponse, SiteStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROUTE_LABEL = 'GET /api/deals';
const FAILURE_MESSAGE = '할인 목록을 불러오지 못했습니다.';
const INCLUDE_EXPIRED_PARAM = 'includeExpired';
const INCLUDE_EXPIRED_VALUES: readonly string[] = ['1', 'true'];

function wantsExpired(request: Request): boolean {
  const value = new URL(request.url).searchParams.get(INCLUDE_EXPIRED_PARAM);
  return value !== null && INCLUDE_EXPIRED_VALUES.includes(value);
}

/**
 * Statuses that can be read. A broken status file must not hide the deal list, so it is logged
 * and left out; `lastUpdatedAt` then comes from the remaining sites.
 */
async function readReadableStatuses(): Promise<SiteStatus[]> {
  const results = await Promise.allSettled(SITE_IDS.map((siteId) => readStatus(siteId)));
  const { statuses, failures } = partitionSettledStatuses(SITE_IDS, results);
  failures.forEach(({ siteId, reason }) => {
    logServerProblem(`${ROUTE_LABEL} ${siteId} 상태를 읽지 못해 마지막 업데이트 계산에서 뺐습니다`, reason);
  });
  return statuses;
}

async function handleGet(request: Request): Promise<Response> {
  const includeExpired = wantsExpired(request);
  const now = new Date();
  const [{ deals, problems }, statuses] = await Promise.all([
    readAllDeals(),
    readReadableStatuses(),
  ]);
  problems.forEach((problem) => logServerProblem(ROUTE_LABEL, problem));

  const data: DealsResponse = {
    deals: includeExpired ? deals : deals.filter((deal) => !isExpired(deal.endsAt, now)),
    lastUpdatedAt: latestSuccessAt(statuses),
  };
  return ok(data);
}

export async function GET(request: Request): Promise<Response> {
  return runGuarded(ROUTE_LABEL, FAILURE_MESSAGE, () => handleGet(request));
}

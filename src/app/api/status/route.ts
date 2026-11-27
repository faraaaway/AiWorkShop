/**
 * GET /api/status (specs/001-bf-deal-tracker/contracts/http-api.md).
 * One SiteStatusView per site, always all nine, in SITE_IDS order.
 */
import { getAdapter } from '@/crawler/adapters';
import { getRunPhase } from '@/crawler/runner';
import { getAutoCrawlInfo } from '@/crawler/schedule';
import { HTTP_SERVER_ERROR, fail, logServerProblem, ok, runGuarded } from '@/lib/http';
import { buildStatusView, partitionSettledStatuses } from '@/lib/server/status-view';
import { readStatus } from '@/lib/store';
import { SITE_IDS } from '@/lib/types';
import type { SiteId, SiteStatus, SiteStatusView, StatusResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ROUTE_LABEL = 'GET /api/status';
const FAILURE_MESSAGE = '사이트 상태를 불러오지 못했습니다.';

/** Names the files by their place inside the data folder, never by an absolute path. */
function unreadableStatusMessage(siteIds: readonly SiteId[]): string {
  const files = siteIds.map((siteId) => `status/${siteId}.json`).join(', ');
  return `데이터 폴더의 사이트 상태 파일을 읽지 못했습니다: ${files}. 파일 내용을 확인해 주세요.`;
}

async function toView(status: SiteStatus): Promise<SiteStatusView> {
  const run = await getRunPhase(status.siteId);
  return buildStatusView(status, getAdapter(status.siteId).displayName, run);
}

async function handleGet(): Promise<Response> {
  const results = await Promise.allSettled(SITE_IDS.map((siteId) => readStatus(siteId)));
  const { statuses, failures } = partitionSettledStatuses(SITE_IDS, results);
  if (failures.length > 0) {
    failures.forEach(({ siteId, reason }) => logServerProblem(`${ROUTE_LABEL} ${siteId}`, reason));
    return fail(
      unreadableStatusMessage(failures.map((failure) => failure.siteId)),
      HTTP_SERVER_ERROR,
    );
  }
  const data: StatusResponse = {
    sites: await Promise.all(statuses.map(toView)),
    autoCrawl: getAutoCrawlInfo(),
  };
  return ok(data);
}

export async function GET(): Promise<Response> {
  return runGuarded(ROUTE_LABEL, FAILURE_MESSAGE, handleGet);
}

/**
 * PATCH /api/status/:siteId (specs/001-bf-deal-tracker/contracts/http-api.md).
 * Switches a site on or off. Only `enabled` changes: the stored `state` keeps the last run
 * result, so switching the site back on shows that result again.
 */
import { getAdapter } from '@/crawler/adapters';
import { getRunPhase } from '@/crawler/runner';
import {
  HTTP_BAD_REQUEST,
  fail,
  isJsonObject,
  ok,
  readJsonBody,
  rejectCrossSite,
  runGuarded,
} from '@/lib/http';
import { buildStatusView } from '@/lib/server/status-view';
import { readStatus, writeStatus } from '@/lib/store';
import { isSiteId } from '@/lib/types';
import type { SiteId, SiteStatus, SiteTogglePatch } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ siteId: string }>;
}

const ROUTE_LABEL = 'PATCH /api/status/:siteId';
const FAILURE_MESSAGE = '사이트 설정을 바꾸지 못했습니다.';
const UNKNOWN_SITE_MESSAGE = '알 수 없는 사이트입니다. 주소의 사이트 ID를 확인해 주세요.';
const INVALID_BODY_MESSAGE =
  '요청 형식이 올바르지 않습니다. { "enabled": true } 또는 { "enabled": false } 를 보내 주세요.';

function parsePatch(body: unknown): SiteTogglePatch | null {
  if (!isJsonObject(body) || typeof body.enabled !== 'boolean') return null;
  return { enabled: body.enabled };
}

async function setEnabled(siteId: SiteId, enabled: boolean): Promise<Response> {
  const current = await readStatus(siteId);
  const next: SiteStatus = { ...current, enabled };
  await writeStatus(next);
  const run = await getRunPhase(siteId);
  return ok(buildStatusView(next, getAdapter(siteId).displayName, run));
}

async function handlePatch(request: Request, context: RouteContext): Promise<Response> {
  const rejection = rejectCrossSite(request);
  if (rejection !== null) return rejection;
  const { siteId } = await context.params;
  if (!isSiteId(siteId)) return fail(UNKNOWN_SITE_MESSAGE, HTTP_BAD_REQUEST);
  const patch = parsePatch(await readJsonBody(request));
  if (patch === null) return fail(INVALID_BODY_MESSAGE, HTTP_BAD_REQUEST);
  return setEnabled(siteId, patch.enabled);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return runGuarded(ROUTE_LABEL, FAILURE_MESSAGE, () => handlePatch(request, context));
}

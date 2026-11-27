/**
 * Server-side helpers shared by the route handlers under src/app/api
 * (specs/001-bf-deal-tracker/contracts/http-api.md): the `{ ok, data }` / `{ ok, error }`
 * envelope, request body reading and the catch-all for unexpected errors.
 * Not for the browser: the client side is src/lib/api.ts.
 */
import type { ApiErr, ApiOk } from '@/lib/types';

export const HTTP_OK = 200;
export const HTTP_ACCEPTED = 202;
export const HTTP_BAD_REQUEST = 400;
export const HTTP_FORBIDDEN = 403;
export const HTTP_CONFLICT = 409;
export const HTTP_SERVER_ERROR = 500;

/** Crawl data changes between requests, so no answer may be reused by a cache. */
const RESPONSE_HEADERS: Readonly<Record<string, string>> = { 'Cache-Control': 'no-store' };
const LOG_PREFIX = '[api]';
/** Added to every 500 message: the cause is only in the server's stderr. */
const SERVER_LOG_HINT = '문제가 계속되면 서버를 실행한 터미널의 오류 내용을 확인해 주세요.';
const CROSS_SITE_MESSAGE =
  '다른 사이트에서 보낸 요청은 받지 않습니다. 이 앱 화면에서 다시 시도해 주세요.';

export function ok<T>(data: T, status: number = HTTP_OK): Response {
  const body: ApiOk<T> = { ok: true, data };
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

/** `message` is shown to the user as it is: Korean, no stack traces, no local paths. */
export function fail(message: string, status: number): Response {
  const body: ApiErr = { ok: false, error: message };
  return Response.json(body, { status, headers: RESPONSE_HEADERS });
}

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The parsed JSON body, or undefined when the body is empty or not valid JSON (JSON itself never
 * yields undefined). The caller answers 400; nothing is logged because a bad request is the
 * client's mistake, not a server fault.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch (error) {
    logServerProblem('요청 본문을 읽지 못했습니다', error);
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * True when a browser sent the request from a page of another site: it has an Origin header whose
 * host is not this server's. The app has no login, so without this check any web page open in the
 * same browser could start a forced crawl or switch sites off. Requests without Origin (the tsx
 * CLI, curl) and the app's own pages pass.
 */
function isCrossSiteRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return false;
  const ownHost = request.headers.get('host') ?? hostOfUrl(request.url);
  const originHost = hostOfUrl(origin);
  // An origin that is not a URL (the literal "null" of sandboxed pages) is never this app.
  return originHost === null || originHost !== ownHost;
}

/** The 403 answer for a state-changing request another site's page sent, or null when it is ours. */
export function rejectCrossSite(request: Request): Response | null {
  return isCrossSiteRequest(request) ? fail(CROSS_SITE_MESSAGE, HTTP_FORBIDDEN) : null;
}

function describeDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? detail.message;
  return typeof detail === 'string' ? detail : String(detail);
}

/** Detail for the person running the server. It goes to stderr only, never into a response. */
export function logServerProblem(label: string, detail: unknown): void {
  process.stderr.write(`${LOG_PREFIX} ${label}: ${describeDetail(detail)}\n`);
}

/**
 * Runs a route handler. Anything it throws is written to stderr and answered as a 500 with
 * `failureMessage` (one Korean sentence) plus a pointer to the server log, so a response never
 * carries a stack trace or a file path.
 */
export async function runGuarded(
  label: string,
  failureMessage: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    logServerProblem(label, error);
    return fail(`${failureMessage} ${SERVER_LOG_HINT}`, HTTP_SERVER_ERROR);
  }
}

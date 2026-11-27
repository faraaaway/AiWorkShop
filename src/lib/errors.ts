/**
 * Errors shared between adapters, the Obscura wrapper and the runner.
 * The runner maps them to SiteStatus.state (data-model.md "상태 전이",
 * contracts/adapter-interface.md rule 6):
 *   blocked -> 'blocked' (+6h cooldown) · login_required -> 'login_required'
 *   not_implemented -> 'not_implemented' · request_limit / any other error -> 'failed'
 * In every one of these cases the previously stored deals are kept.
 *
 * `kind` is used instead of `instanceof` so the check still works when a module
 * is loaded twice (Next.js route bundles vs. the tsx CLI).
 */

export type CrawlErrorKind = 'blocked' | 'login_required' | 'not_implemented' | 'request_limit';

export class CrawlError extends Error {
  readonly kind: CrawlErrorKind;

  constructor(kind: CrawlErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'CrawlError';
  }
}

/** CAPTCHA / bot wall / HTTP 403 or 429. Thrown by the CrawlContext; adapters must not catch it. */
export class BlockedError extends CrawlError {
  readonly url: string | null;
  /** Which signal matched, e.g. "captcha" or "HTTP 429". */
  readonly reason: string;

  constructor(reason: string, url: string | null = null) {
    super('blocked', `차단 감지: ${reason}${url ? ` (${url})` : ''}`);
    this.name = 'BlockedError';
    this.reason = reason;
    this.url = url;
  }
}

/** The page redirected to a login form. Thrown by adapters. */
export class LoginRequiredError extends CrawlError {
  constructor(message = '로그인이 필요한 페이지입니다') {
    super('login_required', message);
    this.name = 'LoginRequiredError';
  }
}

/** Default body of an adapter stub. The runner stores the site as 'not_implemented'. */
export class NotImplementedError extends CrawlError {
  constructor(siteId: string) {
    super('not_implemented', `${siteId} 수집기는 아직 구현되지 않았습니다`);
    this.name = 'NotImplementedError';
  }
}

/**
 * The adapter asked for more requests than SiteAdapter.maxRequests in one run.
 * Adapters MAY catch it (`getCrawlErrorKind(e) === 'request_limit'`) and return what they have;
 * checking `ctx.requestsLeft` before each call avoids it altogether.
 */
export class RequestLimitError extends CrawlError {
  constructor(maxRequests: number) {
    super('request_limit', `한 번 실행의 요청 상한(${maxRequests})을 넘었습니다`);
    this.name = 'RequestLimitError';
  }
}

export function getCrawlErrorKind(error: unknown): CrawlErrorKind | null {
  if (typeof error !== 'object' || error === null) return null;
  const kind = (error as { kind?: unknown }).kind;
  return kind === 'blocked' ||
    kind === 'login_required' ||
    kind === 'not_implemented' ||
    kind === 'request_limit'
    ? kind
    : null;
}

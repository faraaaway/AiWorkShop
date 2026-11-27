import { RequestLimitError } from '@/lib/errors';
import type { CrawlContext, FetchHtmlOptions, PostJsonOptions } from '@/lib/types';

/**
 * Test double for CrawlContext. Use this in adapter tests instead of an object literal, so a
 * change to the CrawlContext interface only has to be fixed here.
 *
 *   const ctx = createFakeContext({ fetchJson: (url) => (url.endsWith('/meta') ? meta : goods) });
 *   const deals = await musinsa.crawl(ctx);
 *   expect(ctx.urls).toHaveLength(3);
 */

type MaybePromise<T> = T | Promise<T>;

export interface FakeContextHandlers {
  /** `opts` is what the adapter passed (e.g. `{ raw: true }`), so tests can assert on it. */
  fetchHtml?: (url: string, opts?: FetchHtmlOptions) => MaybePromise<string>;
  fetchJson?: (url: string) => MaybePromise<unknown>;
  evalPage?: (url: string, js: string) => MaybePromise<unknown>;
  /** `body` and `opts` are what the adapter sent, so tests can assert on them. */
  postJson?: (url: string, body: unknown, opts?: PostJsonOptions) => MaybePromise<unknown>;
  /** Request cap of the run (default 30, like SiteAdapter.maxRequests). */
  maxRequests?: number;
  signal?: AbortSignal;
}

export interface FakeContext extends CrawlContext {
  /** Every URL requested so far, in order. */
  readonly urls: readonly string[];
  /** Every message passed to log(). */
  readonly logs: readonly string[];
}

const DEFAULT_MAX_REQUESTS = 30;

export function createFakeContext(handlers: FakeContextHandlers = {}): FakeContext {
  const maxRequests = handlers.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const urls: string[] = [];
  const logs: string[] = [];

  const count = (url: string): void => {
    if (urls.length >= maxRequests) throw new RequestLimitError(maxRequests);
    urls.push(url);
  };
  const missing = (name: string): never => {
    throw new Error(`createFakeContext: ${name} handler was not provided but the adapter called it`);
  };

  return {
    async fetchHtml(url: string, opts?: FetchHtmlOptions): Promise<string> {
      count(url);
      return handlers.fetchHtml ? handlers.fetchHtml(url, opts) : missing('fetchHtml');
    },
    async fetchJson<T = unknown>(url: string): Promise<T> {
      count(url);
      return (handlers.fetchJson ? await handlers.fetchJson(url) : missing('fetchJson')) as T;
    },
    async evalPage<T = unknown>(url: string, js: string): Promise<T | null> {
      count(url);
      const value = handlers.evalPage ? await handlers.evalPage(url, js) : missing('evalPage');
      return (value ?? null) as T | null;
    },
    async postJson<T = unknown>(url: string, body: unknown, opts?: PostJsonOptions): Promise<T> {
      count(url);
      return (handlers.postJson ? await handlers.postJson(url, body, opts) : missing('postJson')) as T;
    },
    log(msg: string): void {
      logs.push(msg);
    },
    signal: handlers.signal ?? new AbortController().signal,
    get requestsLeft(): number {
      return Math.max(0, maxRequests - urls.length);
    },
    urls,
    logs,
  };
}

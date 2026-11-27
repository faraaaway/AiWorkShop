import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createObscuraContext,
  detectBlockSignal,
  type ObscuraContext,
  type ObscuraContextOptions,
  type ObscuraExecResult,
} from '@/crawler/obscura';
import { getCrawlErrorKind } from '@/lib/errors';

const FAKE_BINARY = 'C:/fake/obscura.exe';
const PAGE_URL = 'https://shop.example.com/event/bf';
const API_URL = 'https://api.example.com/deals?page=1';
const NORMAL_HTML = '<html><head><title>블랙프라이데이</title></head><body><h1>행사</h1></body></html>';
const LARGE_BODY_CHARS = 60_000;

interface ExecCall {
  file: string;
  args: string[];
  timeoutMs: number;
}

type Responder = ObscuraExecResult | ((call: ExecCall) => ObscuraExecResult | Promise<ObscuraExecResult>);

interface Harness {
  ctx: ObscuraContext;
  calls: ExecCall[];
  sleeps: number[];
  /** 'sleep' / 'exec' in the order they happened. */
  order: string[];
  logs: string[];
  binaryLookups: () => number;
}

function ok(stdout: string): ObscuraExecResult {
  return { exitCode: 0, stdout, stderr: '', failure: null };
}

function fail(stderr: string): ObscuraExecResult {
  return { exitCode: 1, stdout: '', stderr, failure: null };
}

function navError(url: string, detail: string): ObscuraExecResult {
  return fail(`Error: Failed to navigate to ${url}: Network error: ${detail}\n`);
}

function httpError(url: string, status: number): ObscuraExecResult {
  return navError(
    url,
    `net::ERR_HTTP_RESPONSE_CODE_FAILURE: HTTP ${status} with an empty body for ${url}`,
  );
}

function largeHtml(inner: string): string {
  const filler = '<li class="item"><a href="/p/1">겨울 패딩 자켓</a><span>129,000원</span></li>'.repeat(
    Math.ceil(LARGE_BODY_CHARS / 70),
  );
  return `<html><head><title>겨울 세일</title>${inner}</head><body><ul>${filler}</ul></body></html>`;
}

function makeHarness(
  responders: Responder[] = [],
  overrides: Partial<Omit<ObscuraContextOptions, 'adapter'>> & {
    adapter?: Partial<ObscuraContextOptions['adapter']>;
  } = {},
): Harness {
  const calls: ExecCall[] = [];
  const sleeps: number[] = [];
  const order: string[] = [];
  const logs: string[] = [];
  let lookups = 0;
  const { adapter: adapterOverrides, ...rest } = overrides;

  const ctx = createObscuraContext({
    adapter: { id: 'musinsa', stealth: true, obeyRobots: true, maxRequests: 30, ...adapterOverrides },
    log: (msg) => {
      logs.push(msg);
    },
    exec: async (file, args, options) => {
      const call: ExecCall = { file, args: [...args], timeoutMs: options.timeoutMs };
      calls.push(call);
      order.push('exec');
      const responder = responders[calls.length - 1] ?? ok(NORMAL_HTML);
      return typeof responder === 'function' ? responder(call) : responder;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      order.push('sleep');
    },
    random: () => 0.5,
    resolveBinary: () => {
      lookups += 1;
      return FAKE_BINARY;
    },
    ...rest,
  });

  return { ctx, calls, sleeps, order, logs, binaryLookups: () => lookups };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`Error가 아닌 값으로 거절되었습니다: ${String(error)}`);
  }
  throw new Error('거절될 것으로 기대했지만 성공했습니다');
}

beforeAll(() => {
  process.env.BF_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'bf-obscura-test-'));
});

describe('detectBlockSignal', () => {
  it('reports a small CAPTCHA page as blocked', () => {
    const page =
      '<html><head><title>확인</title></head><body><form action="/verify">' +
      '<div class="g-recaptcha" data-sitekey="x"></div></form></body></html>';

    expect(detectBlockSignal(page)).toBe('recaptcha');
  });

  it('does not report a large normal page that merely loads a recaptcha script', () => {
    const page = largeHtml('<script src="https://www.google.com/recaptcha/api.js?render=KEY"></script>');

    expect(page.length).toBeGreaterThan(LARGE_BODY_CHARS);
    expect(detectBlockSignal(page)).toBeNull();
  });

  it.each(['captcha', 'hcaptcha', 'cf-challenge'])('counts the weak signal %s only in a short body', (word) => {
    const marker = `<div class="${word}-box"></div>`;

    expect(detectBlockSignal(`<html><body>${marker}</body></html>`)).toBe(word);
    expect(detectBlockSignal(largeHtml(marker))).toBeNull();
  });

  it.each([
    ['Just a moment', '<title>Just a moment...</title>'],
    ['Attention Required', '<title>Attention Required! | Cloudflare</title>'],
    ['Access Denied', '<TITLE>Access Denied</TITLE>'],
    ['로봇이 아닙니다', '<title>로봇이 아닙니다</title>'],
    ['비정상적인 접근', '<title>비정상적인 접근이 감지되었습니다</title>'],
    ['비정상적인 요청', '<title>비정상적인 요청입니다</title>'],
    ['자동입력 방지', '<title>자동입력방지 문자를 입력해 주세요</title>'],
    ['접근이 차단', '<title>접근이 차단되었습니다</title>'],
  ])('treats the title phrase "%s" as a strong signal at any size', (reason, title) => {
    expect(detectBlockSignal(largeHtml(title).replace('<title>겨울 세일</title>', ''))).toBe(reason);
  });

  it('treats a main heading phrase as a strong signal at any size', () => {
    const page = largeHtml('').replace('<ul>', '<H1 class="x">Access <b>Denied</b></H1><ul>');

    expect(detectBlockSignal(page)).toBe('Access Denied');
  });

  it('ignores a strong phrase that only appears deep inside a large normal page', () => {
    const page = largeHtml('<script>var messages = { blocked: "비정상적인 접근입니다" };</script>');

    expect(detectBlockSignal(page)).toBeNull();
  });

  it('reports a strong phrase in the visible text of a short body', () => {
    expect(detectBlockSignal('<html><body><p>비정상적인 접근이 감지되어 차단했습니다.</p></body></html>')).toBe(
      '비정상적인 접근',
    );
    expect(detectBlockSignal('Access Denied')).toBe('Access Denied');
  });

  it('ignores a strong phrase hidden in a script of a short body', () => {
    const page = '<html><body><script>var m = "Access Denied";</script><p>상품 목록</p></body></html>';

    expect(detectBlockSignal(page)).toBeNull();
  });

  it('reports Cloudflare challenge markers only together with a short body', () => {
    const challenge = '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>';

    expect(detectBlockSignal(`<html><body>${challenge}</body></html>`)).toBe('challenge-platform');
    expect(detectBlockSignal('<html><body><div id="cf-chl-widget"></div></body></html>')).toBe('cf-chl-');
    expect(detectBlockSignal(largeHtml(challenge))).toBeNull();
  });

  it('does not treat the passive Cloudflare detection script of a normal page as a challenge', () => {
    const page =
      '<html><head><title>Shop</title></head><body><p>hello</p>' +
      '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>';

    expect(detectBlockSignal(page)).toBeNull();
  });

  it('returns null for empty text and ordinary pages', () => {
    expect(detectBlockSignal('')).toBeNull();
    expect(detectBlockSignal(NORMAL_HTML)).toBeNull();
    expect(detectBlockSignal('{"items":[]}')).toBeNull();
  });
});

describe('createObscuraContext — argv', () => {
  it('runs fetchHtml as a rendered html dump with stealth and robots flags', async () => {
    const h = makeHarness([ok(NORMAL_HTML)]);

    const html = await h.ctx.fetchHtml(PAGE_URL);

    expect(html).toBe(NORMAL_HTML);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].file).toBe(FAKE_BINARY);
    expect(h.calls[0].args).toEqual([
      '--stealth',
      '--obey-robots',
      'fetch',
      PAGE_URL,
      '--dump',
      'html',
      '--quiet',
      '--timeout',
      '30',
    ]);
  });

  it('adds --wait when waitSec is given', async () => {
    const h = makeHarness();

    await h.ctx.fetchHtml(PAGE_URL, { waitSec: 7 });

    expect(h.calls[0].args).toEqual([
      '--stealth',
      '--obey-robots',
      'fetch',
      PAGE_URL,
      '--dump',
      'html',
      '--quiet',
      '--timeout',
      '30',
      '--wait',
      '7',
    ]);
  });

  it('omits --stealth and --obey-robots when the adapter turns them off', async () => {
    const h = makeHarness([], { adapter: { stealth: false, obeyRobots: false } });

    await h.ctx.fetchHtml(PAGE_URL);

    expect(h.calls[0].args.slice(0, 2)).toEqual(['fetch', PAGE_URL]);
    expect(h.calls[0].args).not.toContain('--stealth');
    expect(h.calls[0].args).not.toContain('--obey-robots');
  });

  it('keeps only the flag that is switched on', async () => {
    const stealthOnly = makeHarness([], { adapter: { obeyRobots: false } });
    const robotsOnly = makeHarness([], { adapter: { stealth: false } });

    await stealthOnly.ctx.fetchHtml(PAGE_URL);
    await robotsOnly.ctx.fetchHtml(PAGE_URL);

    expect(stealthOnly.calls[0].args.slice(0, 2)).toEqual(['--stealth', 'fetch']);
    expect(robotsOnly.calls[0].args.slice(0, 2)).toEqual(['--obey-robots', 'fetch']);
  });

  it('runs fetchJson as an original dump and parses the body', async () => {
    const h = makeHarness([ok('{"items":[{"id":1}],"total":1}\n')]);

    const data = await h.ctx.fetchJson<{ items: { id: number }[]; total: number }>(API_URL);

    expect(data).toEqual({ items: [{ id: 1 }], total: 1 });
    expect(h.calls[0].args).toEqual([
      '--stealth',
      '--obey-robots',
      'fetch',
      API_URL,
      '--dump',
      'original',
      '--quiet',
      '--timeout',
      '30',
    ]);
  });

  it('passes the evalPage expression as one separate argv item', async () => {
    const js = '({ title: document.title, "q": \'a b\' })';
    const h = makeHarness([ok('{"title":"행사","q":"a b"}\n')]);

    const value = await h.ctx.evalPage<{ title: string }>(PAGE_URL, js, { waitSec: 3 });

    expect(value).toEqual({ title: '행사', q: 'a b' });
    expect(h.calls[0].args).toEqual([
      '--stealth',
      '--obey-robots',
      'fetch',
      PAGE_URL,
      '--quiet',
      '--timeout',
      '30',
      '--wait',
      '3',
      '--eval',
      js,
    ]);
  });

  it('uses the configured timeout and a hard kill timeout above it', async () => {
    const h = makeHarness([], { timeoutSec: 12 });

    await h.ctx.fetchHtml(PAGE_URL, { waitSec: 4 });

    expect(h.calls[0].args).toContain('12');
    expect(h.calls[0].timeoutMs).toBeGreaterThan((12 + 4) * 1000);
  });

  it('resolves the binary path lazily and only once', async () => {
    const h = makeHarness();

    expect(h.binaryLookups()).toBe(0);
    await h.ctx.fetchHtml(PAGE_URL);
    await h.ctx.fetchHtml(PAGE_URL);

    expect(h.binaryLookups()).toBe(1);
  });

  it('surfaces a missing binary on the first request, not at creation', async () => {
    const h = makeHarness([], {
      resolveBinary: () => {
        throw new Error('OBSCURA_PATH가 설정되지 않았습니다.');
      },
    });

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('OBSCURA_PATH');
    expect(h.calls).toHaveLength(0);
  });

  it('rejects an invalid waitSec without starting a process', async () => {
    const h = makeHarness();

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL, { waitSec: -1 }));

    expect(error.message).toContain('waitSec');
    expect(h.calls).toHaveLength(0);
    expect(h.ctx.requestCount).toBe(0);
  });
});

describe('createObscuraContext — politeness and request cap', () => {
  it('waits a random 2-4 s only between requests', async () => {
    const h = makeHarness();

    await h.ctx.fetchHtml(PAGE_URL);
    expect(h.sleeps).toEqual([]);

    await h.ctx.fetchJson(API_URL).catch(() => undefined);
    await h.ctx.evalPage(PAGE_URL, '({})');

    expect(h.sleeps).toEqual([3000, 3000]);
    expect(h.order).toEqual(['exec', 'sleep', 'exec', 'sleep', 'exec']);
  });

  it('draws the delay from the injected bounds', async () => {
    const low = makeHarness([], { random: () => 0, minDelayMs: 100, maxDelayMs: 500 });
    const high = makeHarness([], { random: () => 0.999999, minDelayMs: 100, maxDelayMs: 500 });

    await low.ctx.fetchHtml(PAGE_URL);
    await low.ctx.fetchHtml(PAGE_URL);
    await high.ctx.fetchHtml(PAGE_URL);
    await high.ctx.fetchHtml(PAGE_URL);

    expect(low.sleeps).toEqual([100]);
    expect(high.sleeps[0]).toBeGreaterThan(499);
    expect(high.sleeps[0]).toBeLessThanOrEqual(500);
  });

  it('runs overlapping calls one at a time with the delay in between', async () => {
    let active = 0;
    let maxActive = 0;
    const slow = async (): Promise<ObscuraExecResult> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return ok(NORMAL_HTML);
    };
    const h = makeHarness([slow, slow, slow]);

    await Promise.all([h.ctx.fetchHtml(PAGE_URL), h.ctx.fetchHtml(PAGE_URL), h.ctx.fetchHtml(PAGE_URL)]);

    expect(maxActive).toBe(1);
    expect(h.order).toEqual(['exec', 'sleep', 'exec', 'sleep', 'exec']);
  });

  it('counts requests and throws RequestLimitError without starting a process', async () => {
    const h = makeHarness([], { adapter: { maxRequests: 2 } });

    expect(h.ctx.requestsLeft).toBe(2);
    await h.ctx.fetchHtml(PAGE_URL);
    expect(h.ctx.requestsLeft).toBe(1);
    await h.ctx.evalPage(PAGE_URL, '({})');
    expect(h.ctx.requestsLeft).toBe(0);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(getCrawlErrorKind(error)).toBe('request_limit');
    expect(error.message).toContain('2');
    expect(h.calls).toHaveLength(2);
    expect(h.ctx.requestCount).toBe(2);
    expect(h.ctx.requestsLeft).toBe(0);
    expect(h.ctx.blocked).toBeNull();
  });

  it('counts a failed request too', async () => {
    const h = makeHarness([httpError(PAGE_URL, 500)], { adapter: { maxRequests: 3 } });

    await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(h.ctx.requestCount).toBe(1);
    expect(h.ctx.requestsLeft).toBe(2);
  });
});

describe('createObscuraContext — failure mapping', () => {
  it.each([403, 429])('maps HTTP %i on stderr to BlockedError', async (status) => {
    const h = makeHarness([httpError(PAGE_URL, status)]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(getCrawlErrorKind(error)).toBe('blocked');
    expect(error).toBe(h.ctx.blocked);
    expect(h.ctx.blocked?.reason).toBe(`HTTP ${status}`);
    expect(h.ctx.blocked?.url).toBe(PAGE_URL);
  });

  it('maps a robots.txt disallow to a plain error, not a block', async () => {
    const h = makeHarness([navError(PAGE_URL, `Blocked by robots.txt: ${PAGE_URL}`)]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toBe(`robots.txt가 막은 주소입니다: ${PAGE_URL}`);
    expect(getCrawlErrorKind(error)).toBeNull();
    expect(h.ctx.blocked).toBeNull();
    expect(h.ctx.signal.aborted).toBe(false);
  });

  it('maps HTTP 404 to a Korean message with the Obscura stderr line', async () => {
    const h = makeHarness([httpError(PAGE_URL, 404)]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('찾을 수 없습니다');
    expect(error.message).toContain('HTTP 404');
    expect(error.message).toContain('ERR_HTTP_RESPONSE_CODE_FAILURE');
    expect(getCrawlErrorKind(error)).toBeNull();
    expect(h.ctx.blocked).toBeNull();
  });

  it.each([500, 503])('maps HTTP %i to a server error message', async (status) => {
    const h = makeHarness([httpError(PAGE_URL, status)]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('서버 오류');
    expect(error.message).toContain(`HTTP ${status}`);
    expect(h.ctx.blocked).toBeNull();
  });

  it('maps a DNS failure to a network error message with the stderr line', async () => {
    const stderr =
      `Error: Failed to navigate to ${PAGE_URL}: Network error: error sending request for url ` +
      `(${PAGE_URL}): client error (Connect): dns error: No such host is known.`;
    const h = makeHarness([fail(`\n${stderr}\n\n`)]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('네트워크');
    expect(error.message).toContain('dns error');
    expect(error.message.endsWith('\n')).toBe(false);
    expect(h.ctx.blocked).toBeNull();
  });

  it('reports a hard timeout with a clear message', async () => {
    const h = makeHarness([{ exitCode: null, stdout: '', stderr: '', failure: 'timeout' }]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('시간');
    expect(error.message).toContain(PAGE_URL);
    expect(h.ctx.blocked).toBeNull();
  });

  it('reports a timeout printed by Obscura itself', async () => {
    const h = makeHarness([navError(PAGE_URL, 'Timeout: navigation timed out after 30s')]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('시간');
    expect(error.message).toContain('timed out');
  });

  it('reports a process that could not be started', async () => {
    const h = makeHarness([{ exitCode: null, stdout: '', stderr: 'spawn ENOENT', failure: 'spawn' }]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('Obscura를 실행하지 못했습니다');
    expect(error.message).toContain('ENOENT');
  });

  it('rejects an empty rendered page instead of returning an empty string', async () => {
    const h = makeHarness([ok('  \n')]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.message).toContain('빈');
    expect(h.ctx.blocked).toBeNull();
  });
});

describe('createObscuraContext — body block detection and latch', () => {
  const captchaPage =
    '<html><head><title>보안 확인</title><script src="https://js.hcaptcha.com/1/api.js"></script></head>' +
    '<body><div class="h-captcha"></div></body></html>';

  it('throws BlockedError when the rendered page is a bot wall', async () => {
    const h = makeHarness([ok(captchaPage)]);

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(getCrawlErrorKind(error)).toBe('blocked');
    expect(h.ctx.blocked?.reason).toBe('hcaptcha');
    expect(h.ctx.blocked?.url).toBe(PAGE_URL);
    expect(h.logs.some((msg) => msg.includes('차단'))).toBe(true);
  });

  it('returns a large normal page that only loads a recaptcha script', async () => {
    const page = largeHtml('<script src="https://www.google.com/recaptcha/api.js"></script>');
    const h = makeHarness([ok(page)]);

    await expect(h.ctx.fetchHtml(PAGE_URL)).resolves.toBe(page);
    expect(h.ctx.blocked).toBeNull();
  });

  it('latches the first block: every later call rejects with the same error and starts nothing', async () => {
    const h = makeHarness([httpError(PAGE_URL, 429)]);

    const first = await rejection(h.ctx.fetchHtml(PAGE_URL));
    const again = await rejection(h.ctx.fetchHtml('https://shop.example.com/other'));
    const json = await rejection(h.ctx.fetchJson(API_URL));
    const evaluated = await rejection(h.ctx.evalPage(PAGE_URL, '({})'));

    expect(again).toBe(first);
    expect(json).toBe(first);
    expect(evaluated).toBe(first);
    expect(h.ctx.blocked).toBe(first);
    expect(h.calls).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect(h.ctx.requestCount).toBe(1);
    expect(h.ctx.signal.aborted).toBe(true);
  });

  it('rejects calls that were already queued behind the blocked one', async () => {
    const h = makeHarness([httpError(PAGE_URL, 403)]);

    const results = await Promise.allSettled([
      h.ctx.fetchHtml(PAGE_URL),
      h.ctx.fetchHtml(PAGE_URL),
      h.ctx.fetchJson(API_URL),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(results.every((r) => r.status === 'rejected' && r.reason === h.ctx.blocked)).toBe(true);
    expect(h.calls).toHaveLength(1);
  });
});

describe('createObscuraContext — fetchJson bodies', () => {
  it('throws BlockedError when a non-JSON body is a bot wall', async () => {
    const h = makeHarness([ok('<html><head><title>Just a moment...</title></head><body></body></html>')]);

    const error = await rejection(h.ctx.fetchJson(API_URL));

    expect(getCrawlErrorKind(error)).toBe('blocked');
    expect(h.ctx.blocked?.reason).toBe('Just a moment');
    expect(h.ctx.blocked?.url).toBe(API_URL);
  });

  it('throws a normal error with the first characters of a non-JSON body', async () => {
    const body = `<html><body>${'점검 중입니다. '.repeat(40)}</body></html>`;
    const h = makeHarness([ok(body)]);

    const error = await rejection(h.ctx.fetchJson(API_URL));

    expect(error.message).toContain('JSON이 아닌 응답');
    expect(error.message).toContain(body.slice(0, 120));
    expect(error.message).not.toContain(body.slice(0, 200));
    expect(getCrawlErrorKind(error)).toBeNull();
    expect(h.ctx.blocked).toBeNull();
  });

  it('throws a normal error for an empty body (HTTP error without a body)', async () => {
    const h = makeHarness([ok('')]);

    const error = await rejection(h.ctx.fetchJson(API_URL));

    expect(error.message).toContain('JSON이 아닌 응답');
    expect(error.message).toContain(API_URL);
    expect(h.ctx.blocked).toBeNull();
  });

  it('parses a JSON body that starts with a byte order mark', async () => {
    const h = makeHarness([ok(String.fromCharCode(0xfeff) + '{"total":3}')]);

    await expect(h.ctx.fetchJson(API_URL)).resolves.toEqual({ total: 3 });
  });

  it('does not run block detection on a body that is valid JSON', async () => {
    const h = makeHarness([ok('{"useCaptcha":false,"recaptchaKey":"abc"}')]);

    await expect(h.ctx.fetchJson(API_URL)).resolves.toEqual({ useCaptcha: false, recaptchaKey: 'abc' });
    expect(h.ctx.blocked).toBeNull();
  });
});

describe('createObscuraContext — evalPage results', () => {
  it.each(['null\n', '', '  \r\n', 'undefined is not an object'])('returns null for the output %j', async (stdout) => {
    const h = makeHarness([ok(stdout)]);

    await expect(h.ctx.evalPage(PAGE_URL, 'window.__DATA__')).resolves.toBeNull();
    expect(h.ctx.blocked).toBeNull();
  });

  it('logs when the output is not JSON so the miss is not silent', async () => {
    const h = makeHarness([ok('oops')]);

    await h.ctx.evalPage(PAGE_URL, 'window.__DATA__');

    expect(h.logs.some((msg) => msg.includes('JSON'))).toBe(true);
  });

  it('returns arrays as parsed values', async () => {
    const h = makeHarness([ok('[{"id":"a"},{"id":"b"}]')]);

    await expect(h.ctx.evalPage(PAGE_URL, 'window.items')).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('does not treat eval output that mentions captcha as a block', async () => {
    const h = makeHarness([ok('{"config":{"recaptchaSiteKey":"abc"},"items":[]}')]);

    await expect(h.ctx.evalPage(PAGE_URL, 'window.__NEXT_DATA__')).resolves.toEqual({
      config: { recaptchaSiteKey: 'abc' },
      items: [],
    });
    expect(h.ctx.blocked).toBeNull();
  });

  it('still maps HTTP 403 during evalPage to BlockedError', async () => {
    const h = makeHarness([httpError(PAGE_URL, 403)]);

    const error = await rejection(h.ctx.evalPage(PAGE_URL, '({})'));

    expect(getCrawlErrorKind(error)).toBe('blocked');
  });

  it('rejects an empty expression', async () => {
    const h = makeHarness();

    const error = await rejection(h.ctx.evalPage(PAGE_URL, '   '));

    expect(error.message).toContain('표현식');
    expect(h.calls).toHaveLength(0);
  });
});

describe('createObscuraContext — URL validation', () => {
  it.each(['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'ftp://example.com/a', '--version', 'example.com', ''])(
    'rejects the non-http(s) URL %j without starting a process',
    async (url) => {
      const h = makeHarness();

      const errors = [
        await rejection(h.ctx.fetchHtml(url)),
        await rejection(h.ctx.fetchJson(url)),
        await rejection(h.ctx.evalPage(url, '({})')),
      ];

      expect(errors.every((error) => error.message.includes('http'))).toBe(true);
      expect(h.calls).toHaveLength(0);
      expect(h.ctx.requestCount).toBe(0);
      expect(h.ctx.blocked).toBeNull();
    },
  );

  it('accepts plain http URLs', async () => {
    const h = makeHarness();

    await h.ctx.fetchHtml('http://shop.example.com/a');

    expect(h.calls[0].args).toContain('http://shop.example.com/a');
  });
});

describe('createObscuraContext — abort', () => {
  it('rejects every call once the external signal aborts', async () => {
    const controller = new AbortController();
    const h = makeHarness([], { signal: controller.signal });

    await h.ctx.fetchHtml(PAGE_URL);
    controller.abort();

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));
    const jsonError = await rejection(h.ctx.fetchJson(API_URL));

    expect(h.ctx.signal.aborted).toBe(true);
    expect(error.name).toBe('AbortError');
    expect(error.message).toContain('중단');
    expect(jsonError.name).toBe('AbortError');
    expect(h.calls).toHaveLength(1);
    expect(h.ctx.blocked).toBeNull();
  });

  it('starts aborted when the external signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = makeHarness([], { signal: controller.signal });

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(h.ctx.signal.aborted).toBe(true);
    expect(error.name).toBe('AbortError');
    expect(h.calls).toHaveLength(0);
  });

  it('exposes its own signal, not the external one', () => {
    const controller = new AbortController();
    const h = makeHarness([], { signal: controller.signal });

    expect(h.ctx.signal).not.toBe(controller.signal);
    expect(h.ctx.signal.aborted).toBe(false);
  });

  it('ends the politeness wait early with an abort error', async () => {
    const controller = new AbortController();
    const hugeDelayMs = 600_000;
    const h = makeHarness([], {
      signal: controller.signal,
      sleep: undefined,
      minDelayMs: hugeDelayMs,
      maxDelayMs: hugeDelayMs,
    });
    await h.ctx.fetchHtml(PAGE_URL);

    const pending = rejection(h.ctx.fetchHtml(PAGE_URL));
    setImmediate(() => controller.abort());
    const error = await pending;

    expect(error.name).toBe('AbortError');
    expect(h.calls).toHaveLength(1);
  });

  it('reports a process killed by the abort as an abort error', async () => {
    const controller = new AbortController();
    const h = makeHarness(
      [
        () => {
          controller.abort();
          return { exitCode: null, stdout: '', stderr: '', failure: 'aborted' };
        },
      ],
      { signal: controller.signal },
    );

    const error = await rejection(h.ctx.fetchHtml(PAGE_URL));

    expect(error.name).toBe('AbortError');
    expect(h.ctx.blocked).toBeNull();
  });
});

describe('createObscuraContext — log', () => {
  it('forwards log messages to options.log', () => {
    const h = makeHarness();

    h.ctx.log('행사 3개 발견');

    expect(h.logs).toEqual(['행사 3개 발견']);
  });

  it('defaults to a no-op logger', () => {
    const ctx = createObscuraContext({
      adapter: { id: 'musinsa', stealth: true, obeyRobots: true, maxRequests: 30 },
    });

    expect(() => ctx.log('무시되는 메시지')).not.toThrow();
    expect(ctx.requestsLeft).toBe(30);
    expect(ctx.requestCount).toBe(0);
    expect(ctx.blocked).toBeNull();
  });
});

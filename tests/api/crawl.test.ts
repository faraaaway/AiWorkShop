import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, CrawlSkipReason, CrawlStartResponse, SiteId } from '@/lib/types';
import { SITE_IDS } from '@/lib/types';

interface StartResult {
  started: SiteId[];
  skipped: { siteId: SiteId; reason: CrawlSkipReason }[];
}

/** The runner is written by another task; these tests only need what startBackgroundRun answers. */
const runnerMock = vi.hoisted(() => ({
  startBackgroundRun:
    vi.fn<(target: string, options?: { force?: boolean }) => Promise<StartResult>>(),
}));

vi.mock('@/crawler/runner', () => ({ startBackgroundRun: runnerMock.startBackgroundRun }));

import { POST, dynamic, runtime } from '@/app/api/crawl/route';
import { buildSkipMessage } from '@/lib/server/status-view';
import { defaultStatus, writeStatus } from '@/lib/store';

const KOREAN = /[가-힣]/;
const CRAWL_URL = 'http://localhost/api/crawl';
const MINUTE_MS = 60_000;
const NOW = new Date('2026-11-27T21:00:00+09:00');

let dataDir = '';
let previousDataDir: string | undefined;
let stderrLines: string[] = [];

beforeEach(async () => {
  previousDataDir = process.env.BF_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), 'bf-api-crawl-'));
  process.env.BF_DATA_DIR = dataDir;
  stderrLines = [];
  runnerMock.startBackgroundRun.mockReset();
  runnerMock.startBackgroundRun.mockResolvedValue({ started: ['musinsa'], skipped: [] });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    stderrLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousDataDir === undefined) delete process.env.BF_DATA_DIR;
  else process.env.BF_DATA_DIR = previousDataDir;
});

function crawlRequest(
  body: unknown,
  query = '',
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(`${CRAWL_URL}${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function callCrawl(
  body: unknown,
  query = '',
  extraHeaders: Record<string, string> = {},
): Promise<{ response: Response; body: ApiResponse<CrawlStartResponse>; text: string }> {
  const response = await POST(crawlRequest(body, query, extraHeaders));
  const text = await response.text();
  return { response, body: JSON.parse(text) as ApiResponse<CrawlStartResponse>, text };
}

function skipOnly(siteId: SiteId, reason: CrawlSkipReason): StartResult {
  return { started: [], skipped: [{ siteId, reason }] };
}

async function expectConflict(siteId: SiteId, reason: CrawlSkipReason): Promise<string> {
  runnerMock.startBackgroundRun.mockResolvedValue(skipOnly(siteId, reason));
  const { response, body } = await callCrawl({ siteId });
  expect(response.status).toBe(409);
  if (body.ok) throw new Error('expected an error body');
  return body.error;
}

describe('buildSkipMessage', () => {
  it('says the site is already being crawled', () => {
    expect(buildSkipMessage('running', '무신사', null, NOW)).toBe(
      '무신사 수집이 이미 진행 중입니다',
    );
  });

  it.each([
    [1, '1분'],
    [59, '59분'],
    [60, '1시간'],
    [90, '1시간 30분'],
    [360, '6시간'],
  ])('tells the remaining cooldown of %i minutes as "%s"', (minutes, expected) => {
    const cooldownUntil = new Date(NOW.getTime() + minutes * MINUTE_MS).toISOString();

    const message = buildSkipMessage('cooldown', '무신사', cooldownUntil, NOW);

    expect(message).toContain('무신사');
    expect(message).toContain(`약 ${expected}`);
    expect(message).toContain('강제 재시도');
  });

  it('rounds a partial minute up', () => {
    const cooldownUntil = new Date(NOW.getTime() + 30_500).toISOString();

    expect(buildSkipMessage('cooldown', '무신사', cooldownUntil, NOW)).toContain('약 1분');
  });

  it.each([
    ['unknown', null],
    ['unreadable', '조금 뒤'],
    ['already over', '2026-11-27T20:59:00+09:00'],
  ])('gives no remaining time when the cooldown end is %s', (_label, cooldownUntil) => {
    const message = buildSkipMessage('cooldown', '무신사', cooldownUntil, NOW);

    expect(message).toContain('강제 재시도');
    expect(message).not.toMatch(/\d/);
  });

  it('explains a switched-off site and an unfinished adapter', () => {
    const disabled = buildSkipMessage('disabled', '지그재그', null, NOW);
    const notImplemented = buildSkipMessage('not_implemented', '퀸잇', null, NOW);

    expect(disabled).toContain('지그재그');
    expect(disabled).toContain('꺼져');
    expect(notImplemented).toContain('퀸잇');
    expect(notImplemented).toContain('준비 중');
    expect(disabled).not.toBe(notImplemented);
  });
});

describe('POST /api/crawl', () => {
  it('declares the route as dynamic and node-only', () => {
    expect([dynamic, runtime]).toEqual(['force-dynamic', 'nodejs']);
  });

  it('starts one site and answers 202 right away', async () => {
    const { response, body } = await callCrawl({ siteId: 'musinsa' });

    expect(response.status).toBe(202);
    expect(body).toEqual({ ok: true, data: { started: ['musinsa'] } });
    expect(runnerMock.startBackgroundRun).toHaveBeenCalledTimes(1);
    expect(runnerMock.startBackgroundRun).toHaveBeenCalledWith('musinsa', { force: false });
  });

  it.each(SITE_IDS)('accepts the site id %s', async (siteId) => {
    runnerMock.startBackgroundRun.mockResolvedValue({ started: [siteId], skipped: [] });

    const { response } = await callCrawl({ siteId });

    expect(response.status).toBe(202);
    expect(runnerMock.startBackgroundRun).toHaveBeenCalledWith(siteId, { force: false });
  });

  it('passes force from the body', async () => {
    await callCrawl({ siteId: 'musinsa', force: true });

    expect(runnerMock.startBackgroundRun).toHaveBeenCalledWith('musinsa', { force: true });
  });

  it('accepts force as a query option, the body winning when both are given', async () => {
    await callCrawl({ siteId: 'musinsa' }, '?force=1');
    await callCrawl({ siteId: 'musinsa', force: false }, '?force=1');
    await callCrawl({ siteId: 'musinsa' }, '?force=0');

    expect(runnerMock.startBackgroundRun.mock.calls.map((call) => call[1])).toEqual([
      { force: true },
      { force: false },
      { force: false },
    ]);
  });

  it('reports the skipped sites of an "all" request', async () => {
    runnerMock.startBackgroundRun.mockResolvedValue({
      started: ['musinsa', '29cm'],
      skipped: [
        { siteId: 'naver', reason: 'cooldown' },
        { siteId: 'zigzag', reason: 'disabled' },
      ],
    });

    const { response, body } = await callCrawl({ siteId: 'all' });

    expect(response.status).toBe(202);
    expect(body).toEqual({
      ok: true,
      data: {
        started: ['musinsa', '29cm'],
        skipped: [
          { siteId: 'naver', reason: 'cooldown' },
          { siteId: 'zigzag', reason: 'disabled' },
        ],
      },
    });
    expect(runnerMock.startBackgroundRun).toHaveBeenCalledWith('all', { force: false });
  });

  it('still answers 202 for "all" when nothing could start', async () => {
    const skipped = SITE_IDS.map((siteId) => ({ siteId, reason: 'not_implemented' as const }));
    runnerMock.startBackgroundRun.mockResolvedValue({ started: [], skipped });

    const { response, body } = await callCrawl({ siteId: 'all' });

    expect(response.status).toBe(202);
    expect(body).toEqual({ ok: true, data: { started: [], skipped } });
  });

  it.each([
    ['malformed JSON', '{ "siteId": '],
    ['an empty body', ''],
    ['an unknown site id', { siteId: 'coupang' }],
    ['a missing site id', {}],
    ['a numeric site id', { siteId: 4910 }],
    ['a null site id', { siteId: null }],
    ['an upper-case site id', { siteId: 'ALL' }],
    ['an array', ['musinsa']],
    ['a bare string', '"musinsa"'],
    ['null', null],
    ['a string for force', { siteId: 'musinsa', force: 'true' }],
    ['a number for force', { siteId: 'musinsa', force: 1 }],
    ['null for force', { siteId: 'all', force: null }],
  ])('answers 400 for %s without starting anything', async (_label, payload) => {
    const { response, body } = await callCrawl(payload);

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(runnerMock.startBackgroundRun).not.toHaveBeenCalled();
  });

  it('does not echo an overlong unknown site id back in full', async () => {
    const longId = 'x'.repeat(5000);

    const { response, text } = await callCrawl({ siteId: longId });

    expect(response.status).toBe(400);
    expect(text.length).toBeLessThan(500);
  });

  it.each([
    ['another site', { Origin: 'https://evil.example', Host: 'localhost:3000' }],
    ['another port', { Origin: 'http://localhost:8080', Host: 'localhost:3000' }],
    ['an opaque origin', { Origin: 'null', Host: 'localhost:3000' }],
    ['another site, no Host header', { Origin: 'https://evil.example' }],
  ])('answers 403 for a browser request from %s and starts nothing', async (_label, headers) => {
    const { response, body } = await callCrawl({ siteId: 'all', force: true }, '', headers);

    expect(response.status).toBe(403);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(runnerMock.startBackgroundRun).not.toHaveBeenCalled();
  });

  it.each([
    ['the app itself', { Origin: 'http://localhost:3000', Host: 'localhost:3000' }],
    ['the app on the home network', { Origin: 'http://192.168.0.5:3000', Host: '192.168.0.5:3000' }],
    ['the app, no Host header', { Origin: 'http://localhost' }],
  ])('accepts a browser request from %s', async (_label, headers) => {
    const { response } = await callCrawl({ siteId: 'musinsa' }, '', headers);

    expect(response.status).toBe(202);
  });

  it('answers 409 when the site is already being crawled', async () => {
    expect(await expectConflict('musinsa', 'running')).toBe('무신사 수집이 이미 진행 중입니다');
  });

  it('answers 409 with the remaining cooldown and the forced retry hint', async () => {
    const cooldownUntil = new Date(Date.now() + 90 * MINUTE_MS).toISOString();
    await writeStatus({ ...defaultStatus('naver'), state: 'blocked', cooldownUntil });

    const message = await expectConflict('naver', 'cooldown');

    expect(message).toContain('네이버쇼핑');
    expect(message).toContain('약 1시간 30분');
    expect(message).toContain('강제 재시도');
  });

  it('answers 409 without a time when the cooldown end cannot be read', async () => {
    await mkdir(path.join(dataDir, 'status'), { recursive: true });
    await writeFile(path.join(dataDir, 'status', 'naver.json'), '{ broken', 'utf8');

    const message = await expectConflict('naver', 'cooldown');

    expect(message).toContain('강제 재시도');
    expect(message).not.toMatch(/\d/);
    expect(message).not.toContain(dataDir);
    expect(stderrLines.join('')).toContain('naver');
  });

  it('answers 409 for a switched-off site and for an unfinished adapter', async () => {
    const disabled = await expectConflict('zigzag', 'disabled');
    const notImplemented = await expectConflict('queenit', 'not_implemented');

    expect(disabled).toContain('지그재그');
    expect(disabled).toContain('꺼져');
    expect(notImplemented).toContain('퀸잇');
    expect(notImplemented).toContain('준비 중');
  });

  it('answers 500 with a Korean message and no detail when the runner fails', async () => {
    runnerMock.startBackgroundRun.mockRejectedValue(
      new Error('spawn C:\\tools\\obscura.exe ENOENT'),
    );

    const { response, body, text } = await callCrawl({ siteId: 'musinsa' });

    expect(response.status).toBe(500);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(text).not.toContain('obscura');
    expect(text).not.toContain('ENOENT');
    expect(stderrLines.join('')).toContain('ENOENT');
  });

  it('answers 500 when the runner neither started nor skipped the requested site', async () => {
    runnerMock.startBackgroundRun.mockResolvedValue({ started: [], skipped: [] });

    const { response, body } = await callCrawl({ siteId: 'musinsa' });

    expect(response.status).toBe(500);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
  });
});

describe('POST /api/crawl — 공개 배포판 (읽기 전용)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('수집을 시작하지 않고 403과 한글 안내를 돌려준다', async () => {
    vi.stubEnv('NEXT_PUBLIC_BF_READONLY', '1');

    const { response, body } = await callCrawl({ siteId: 'all' });

    expect(response.status).toBe(403);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(runnerMock.startBackgroundRun).not.toHaveBeenCalled();
  });
});

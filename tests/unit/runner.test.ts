/**
 * T035 — runner state transitions (data-model.md "상태 전이"), run tracking and the crawl CLI helpers.
 * No network: adapters are fakes, the Obscura context is a fake, data lives in a fresh temp folder.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlockedError,
  LoginRequiredError,
  NotImplementedError,
  RequestLimitError,
} from '@/lib/errors';
import { normalizeDeals } from '@/lib/normalize';
import { defaultStatus, readDeals, readRaw, readStatus, writeDeals, writeRaw, writeStatus } from '@/lib/store';
import type { CrawlContext, RawDeal, SiteAdapter, SiteId, SiteState, SiteStatus } from '@/lib/types';
import { SITE_IDS } from '@/lib/types';
import { createFakeContext } from '../helpers/fakeContext';

type Crawl = (ctx: CrawlContext) => Promise<RawDeal[]>;

/** Crawl bodies of the mocked adapter registry (used by startBackgroundRun, which takes no fakes). */
const registryCrawls = vi.hoisted(() => new Map<string, (ctx: CrawlContext) => Promise<RawDeal[]>>());

vi.mock('@/crawler/adapters', async () => {
  const { NotImplementedError: StubError } = await import('@/lib/errors');
  return {
    getAdapter: (id: SiteId): SiteAdapter => ({
      id,
      displayName: id,
      homeUrl: `https://${id}.example.com`,
      stealth: true,
      obeyRobots: true,
      maxRequests: 30,
      crawl: async (ctx: CrawlContext): Promise<RawDeal[]> => {
        const crawl = registryCrawls.get(id);
        if (crawl === undefined) throw new StubError(id);
        return crawl(ctx);
      },
    }),
  };
});

vi.mock('@/crawler/obscura', () => ({ createObscuraContext: vi.fn() }));

import { formatResultLine, getExitCode, parseCliArgs } from '@/crawler/cli';
import { createObscuraContext } from '@/crawler/obscura';
import type { ObscuraContext } from '@/crawler/obscura';
import {
  cancelActiveRuns,
  getRunPhase,
  getSkipReason,
  renormalizeSite,
  runAll,
  runSite,
  startBackgroundRun,
} from '@/crawler/runner';
import type { RunOptions, SiteRunResult } from '@/crawler/runner';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const NOW_ISO = '2026-11-27T21:00:00+09:00';
const SIX_HOURS_LATER_ISO = '2026-11-28T03:00:00+09:00';
const OLD_ISO = '2026-11-26T09:00:00+09:00';
const KOREAN = /[가-힣]/;
const MINUTE_MS = 60_000;
const STALE_LOCK_AGE_MS = 21 * MINUTE_MS;
const BLOCK_URL = 'https://shop.example.com/event';
/**
 * Every run does a dozen small file operations. On a busy Windows disk (antivirus, other test
 * runs) each one can take a quarter of a second, so the limits are generous on purpose.
 */
const SLOW_DISK_TIMEOUT_MS = 120_000;
const WAIT_TIMEOUT_MS = 60_000;
const WAIT_INTERVAL_MS = 10;

vi.setConfig({ testTimeout: SLOW_DISK_TIMEOUT_MS, hookTimeout: SLOW_DISK_TIMEOUT_MS });

let dataDir = '';
let previousDataDir: string | undefined;
let logs: string[] = [];

interface BlockState {
  blocked: BlockedError | null;
}

/** createFakeContext plus the two fields the runner reads from the real Obscura context. */
function makeContext(state: BlockState = { blocked: null }): ObscuraContext {
  const fake = createFakeContext();
  return {
    fetchHtml: fake.fetchHtml,
    fetchJson: fake.fetchJson,
    evalPage: fake.evalPage,
    postJson: fake.postJson,
    log: fake.log,
    signal: fake.signal,
    get requestsLeft(): number {
      return fake.requestsLeft;
    },
    get requestCount(): number {
      return fake.urls.length;
    },
    get blocked(): BlockedError | null {
      return state.blocked;
    },
  };
}

function fakeAdapter(id: SiteId, crawl: Crawl): SiteAdapter {
  return {
    id,
    displayName: id,
    homeUrl: `https://${id}.example.com`,
    stealth: true,
    obeyRobots: true,
    maxRequests: 30,
    crawl,
  };
}

function rawDeal(productId: string, overrides: Partial<RawDeal> = {}): RawDeal {
  return {
    siteProductId: productId,
    name: `울 코트 ${productId}`,
    brand: '브랜드',
    url: `https://shop.example.com/p/${productId}`,
    imageUrl: `https://img.example.com/${productId}.jpg`,
    originalPrice: 100_000,
    salePrice: 60_000,
    rawCategory: '여성 > 아우터 > 코트',
    ...overrides,
  };
}

function rawDeals(count: number, prefix = 'p'): RawDeal[] {
  return Array.from({ length: count }, (_, index) => rawDeal(`${prefix}${index + 1}`));
}

function optionsFor(crawl: Crawl, extra: Partial<RunOptions> = {}): RunOptions {
  return {
    now: () => NOW,
    log: (msg) => {
      logs.push(msg);
    },
    getAdapter: (id) => fakeAdapter(id, crawl),
    createContext: () => makeContext(),
    ...extra,
  };
}

function filePath(folder: 'deals' | 'raw' | 'status' | 'locks', siteId: SiteId): string {
  return path.join(dataDir, folder, `${siteId}.json`);
}

async function readText(folder: 'deals' | 'raw' | 'status' | 'locks', siteId: SiteId): Promise<string> {
  return readFile(filePath(folder, siteId), 'utf8');
}

/** A previous successful crawl: `count` stored deals, their raw file and an 'ok' status. */
async function seedPreviousSuccess(siteId: SiteId, count: number): Promise<SiteStatus> {
  const raws = rawDeals(count, 'old');
  await writeRaw({ siteId, crawledAt: OLD_ISO, deals: raws });
  await writeDeals({ siteId, crawledAt: OLD_ISO, deals: normalizeDeals(raws, siteId, OLD_ISO) });
  const status: SiteStatus = {
    ...defaultStatus(siteId),
    state: 'ok',
    lastRunAt: OLD_ISO,
    lastSuccessAt: OLD_ISO,
    dealCount: count,
  };
  await writeStatus(status);
  return status;
}

interface LockContent {
  pid: number;
  phase: 'queued' | 'running';
  startedAt: string;
}

async function writeLock(siteId: SiteId, content: LockContent | string): Promise<void> {
  await mkdir(path.join(dataDir, 'locks'), { recursive: true });
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  await writeFile(filePath('locks', siteId), text, 'utf8');
}

async function clearLock(siteId: SiteId): Promise<void> {
  await rm(filePath('locks', siteId), { force: true });
}

async function writeBrokenStatus(siteId: SiteId, text: string): Promise<void> {
  await mkdir(path.join(dataDir, 'status'), { recursive: true });
  await writeFile(filePath('status', siteId), text, 'utf8');
}

/** A process id that is alive but is not this process: stands for "the CLI in another terminal". */
function otherLivePid(): number {
  return process.ppid;
}

function deadPid(): number {
  const finished = spawnSync(process.execPath, ['-e', '']);
  return finished.pid;
}

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE_MS).toISOString();
}

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * MINUTE_MS).toISOString();
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** Gates opened by the current test; afterEach lets them through so a failed test cannot leave a crawl hanging. */
let openGates: Deferred<RawDeal[]>[] = [];

/** A crawl result the test hands over when it wants the crawl to finish. */
function crawlGate(): Deferred<RawDeal[]> {
  const gate = deferred<RawDeal[]>();
  openGates = [...openGates, gate];
  return gate;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function waitForPhase(siteId: SiteId, phase: 'idle' | 'queued' | 'running'): Promise<void> {
  await vi.waitFor(async () => expect(await getRunPhase(siteId)).toBe(phase), {
    timeout: WAIT_TIMEOUT_MS,
    interval: WAIT_INTERVAL_MS,
  });
}

async function waitForAllIdle(): Promise<void> {
  for (const siteId of SITE_IDS) await waitForPhase(siteId, 'idle');
}

beforeEach(async () => {
  previousDataDir = process.env.BF_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), 'bf-runner-'));
  process.env.BF_DATA_DIR = dataDir;
  logs = [];
  registryCrawls.clear();
  vi.mocked(createObscuraContext).mockReset();
  vi.mocked(createObscuraContext).mockImplementation(() => makeContext());
});

afterEach(async () => {
  for (const gate of openGates) gate.resolve([]);
  openGates = [];
  await waitForAllIdle();
  vi.restoreAllMocks();
  if (previousDataDir === undefined) delete process.env.BF_DATA_DIR;
  else process.env.BF_DATA_DIR = previousDataDir;
});

// ---------- getSkipReason ----------

describe('getSkipReason', () => {
  const idle: SiteStatus = { ...defaultStatus('musinsa'), state: 'ok' };
  const cooling: SiteStatus = { ...idle, state: 'blocked', cooldownUntil: SIX_HOURS_LATER_ISO };

  it('returns null for an enabled, idle, implemented site outside a cooldown', () => {
    expect(getSkipReason(idle, 'idle', NOW, false, true)).toBeNull();
  });

  it('returns "disabled" when the site is switched off, even with force', () => {
    const off: SiteStatus = { ...idle, enabled: false };
    expect(getSkipReason(off, 'idle', NOW, false, true)).toBe('disabled');
    expect(getSkipReason(off, 'idle', NOW, true, true)).toBe('disabled');
  });

  it.each(['queued', 'running'] as const)('returns "running" while the site is %s, even with force', (phase) => {
    expect(getSkipReason(idle, phase, NOW, false, true)).toBe('running');
    expect(getSkipReason(idle, phase, NOW, true, true)).toBe('running');
  });

  it('returns "not_implemented" when the caller knows the adapter is a stub, even with force', () => {
    expect(getSkipReason(idle, 'idle', NOW, false, false)).toBe('not_implemented');
    expect(getSkipReason(idle, 'idle', NOW, true, false)).toBe('not_implemented');
  });

  it('returns "cooldown" only while cooldownUntil is in the future and force is off', () => {
    expect(getSkipReason(cooling, 'idle', NOW, false, true)).toBe('cooldown');
    expect(getSkipReason(cooling, 'idle', NOW, true, true)).toBeNull();
    expect(getSkipReason(cooling, 'idle', new Date('2026-11-27T18:00:00.000Z'), false, true)).toBeNull();
    expect(getSkipReason(cooling, 'idle', new Date('2026-11-27T18:00:01.000Z'), false, true)).toBeNull();
  });

  it('does not treat an unreadable cooldownUntil as a cooldown', () => {
    const broken: SiteStatus = { ...cooling, cooldownUntil: '언젠가' };
    expect(getSkipReason(broken, 'idle', NOW, false, true)).toBeNull();
  });

  it('checks disabled before running before not_implemented before cooldown', () => {
    const offAndCooling: SiteStatus = { ...cooling, enabled: false };
    expect(getSkipReason(offAndCooling, 'running', NOW, false, false)).toBe('disabled');
    expect(getSkipReason(cooling, 'running', NOW, false, false)).toBe('running');
    expect(getSkipReason(cooling, 'idle', NOW, false, false)).toBe('not_implemented');
  });

  it('does not modify the status it is given', () => {
    const frozen = Object.freeze({ ...cooling });
    expect(() => getSkipReason(frozen, 'idle', NOW, false, true)).not.toThrow();
  });
});

// ---------- runSite: success ----------

describe('runSite — success', () => {
  it('stores raw deals, normalized deals and an "ok" status', async () => {
    const raws = rawDeals(3);

    const result = await runSite('musinsa', optionsFor(async () => raws));

    expect(result).toEqual<SiteRunResult>({
      siteId: 'musinsa',
      state: 'ok',
      dealCount: 3,
      message: null,
      skipped: null,
    });
    expect(await readRaw('musinsa')).toEqual({ siteId: 'musinsa', crawledAt: NOW_ISO, deals: raws });
    const stored = await readDeals('musinsa');
    expect(stored?.crawledAt).toBe(NOW_ISO);
    expect(stored?.deals.map((deal) => deal.id)).toEqual(['musinsa:p1', 'musinsa:p2', 'musinsa:p3']);
    expect(stored?.deals.every((deal) => deal.crawledAt === NOW_ISO && deal.discountRate === 40)).toBe(true);
    expect(await readStatus('musinsa')).toEqual<SiteStatus>({
      siteId: 'musinsa',
      enabled: true,
      state: 'ok',
      lastRunAt: NOW_ISO,
      lastSuccessAt: NOW_ISO,
      dealCount: 3,
      message: null,
      cooldownUntil: null,
    });
  });

  it('counts the deals that remain after normalization (duplicates and unusable ones dropped)', async () => {
    const raws = [rawDeal('1'), rawDeal('1', { salePrice: 50_000 }), rawDeal('2', { salePrice: 0 }), rawDeal('3')];

    const result = await runSite('29cm', optionsFor(async () => raws));

    expect(result.state).toBe('ok');
    expect(result.dealCount).toBe(2);
    expect((await readStatus('29cm')).dealCount).toBe(2);
    expect((await readDeals('29cm'))?.deals.map((deal) => deal.salePrice)).toEqual([50_000, 60_000]);
    expect((await readRaw('29cm'))?.deals).toHaveLength(4);
  });

  it('replaces the previous deals and clears an old message and cooldown', async () => {
    await seedPreviousSuccess('musinsa', 5);
    await writeStatus({
      ...(await readStatus('musinsa')),
      state: 'blocked',
      message: '차단 감지: captcha',
      cooldownUntil: OLD_ISO,
    });

    const result = await runSite('musinsa', optionsFor(async () => rawDeals(2, 'new')));

    expect(result.state).toBe('ok');
    expect((await readDeals('musinsa'))?.deals.map((deal) => deal.id)).toEqual(['musinsa:new1', 'musinsa:new2']);
    const status = await readStatus('musinsa');
    expect(status).toMatchObject({ state: 'ok', dealCount: 2, message: null, cooldownUntil: null });
  });

  it('uses the start time for lastRunAt and the finish time for lastSuccessAt and crawledAt', async () => {
    const finishedAt = new Date('2026-11-27T12:01:30.000Z');
    let current = NOW;
    const crawl: Crawl = async () => {
      current = finishedAt;
      return rawDeals(1);
    };

    await runSite('musinsa', optionsFor(crawl, { now: () => current }));

    const status = await readStatus('musinsa');
    expect(status.lastRunAt).toBe(NOW_ISO);
    expect(status.lastSuccessAt).toBe('2026-11-27T21:01:30+09:00');
    expect((await readDeals('musinsa'))?.crawledAt).toBe('2026-11-27T21:01:30+09:00');
  });

  it('hands the adapter and an abort signal to createContext, and that context to crawl', async () => {
    const context = makeContext();
    const createContext = vi.fn<NonNullable<RunOptions['createContext']>>(() => context);
    const crawl = vi.fn<Crawl>(async () => rawDeals(1));

    await runSite('wconcept', optionsFor(crawl, { createContext }));

    expect(createContext).toHaveBeenCalledTimes(1);
    const [adapter, signal] = createContext.mock.calls[0];
    expect(adapter.id).toBe('wconcept');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(crawl).toHaveBeenCalledWith(context);
  });

  it('falls back to the adapter registry and createObscuraContext when no fakes are given', async () => {
    registryCrawls.set('musinsa', async () => rawDeals(2));

    const result = await runSite('musinsa', { now: () => NOW, log: (msg) => logs.push(msg) });

    expect(result.state).toBe('ok');
    expect(createObscuraContext).toHaveBeenCalledTimes(1);
    const [contextOptions] = vi.mocked(createObscuraContext).mock.calls[0];
    expect(contextOptions.adapter.id).toBe('musinsa');
    expect(contextOptions.signal).toBeInstanceOf(AbortSignal);
    expect(typeof contextOptions.log).toBe('function');
  });

  it('keeps an "enabled" switch that was flipped while the crawl was running', async () => {
    const crawl: Crawl = async () => {
      await writeStatus({ ...(await readStatus('musinsa')), enabled: false });
      return rawDeals(1);
    };

    const result = await runSite('musinsa', optionsFor(crawl));

    expect(result.state).toBe('ok');
    expect(await readStatus('musinsa')).toMatchObject({ enabled: false, state: 'ok', dealCount: 1 });
  });

  it('never stores "disabled" as a state', async () => {
    await runSite('musinsa', optionsFor(async () => rawDeals(1)));
    const stored: unknown = JSON.parse(await readText('status', 'musinsa'));
    expect(stored).toMatchObject({ state: 'ok', enabled: true });
  });
});

// ---------- runSite: every non-success outcome ----------

interface FailureCase {
  title: string;
  crawl: Crawl;
  state: SiteState;
  message: RegExp;
  /** The adapter caught the BlockedError, so only the context knows about the block. */
  swallowedBlock?: boolean;
}

const FAILURE_CASES: FailureCase[] = [
  {
    title: 'an unexpected exception',
    crawl: async () => {
      throw new Error('boom');
    },
    state: 'failed',
    message: /실패.*boom/,
  },
  { title: 'zero results', crawl: async () => [], state: 'suspect_layout', message: /구조/ },
  {
    title: 'zero usable deals after normalization',
    crawl: async () => [rawDeal('1', { salePrice: 0 }), rawDeal('2', { url: '/relative' })],
    state: 'suspect_layout',
    message: /구조/,
  },
  {
    title: 'a BlockedError',
    crawl: async () => {
      throw new BlockedError('captcha', BLOCK_URL);
    },
    state: 'blocked',
    message: /차단.*captcha/,
  },
  {
    title: 'a block the adapter swallowed (ctx.blocked is set)',
    crawl: async () => rawDeals(4, 'partial'),
    state: 'blocked',
    message: /차단.*HTTP 429/,
    swallowedBlock: true,
  },
  {
    title: 'a LoginRequiredError',
    crawl: async () => {
      throw new LoginRequiredError();
    },
    state: 'login_required',
    message: /로그인/,
  },
  {
    title: 'a NotImplementedError',
    crawl: async () => {
      throw new NotImplementedError('musinsa');
    },
    state: 'not_implemented',
    message: /수집기 준비 중/,
  },
  {
    title: 'an uncaught RequestLimitError',
    crawl: async () => {
      throw new RequestLimitError(30);
    },
    state: 'failed',
    message: /실패.*요청 상한\(30\)/,
  },
  {
    title: 'a return value that is not a list',
    crawl: async () => 'not a list' as unknown as RawDeal[],
    state: 'failed',
    message: /실패/,
  },
  {
    title: 'a thrown value that is not an Error',
    crawl: async () => {
      throw 'plain text failure';
    },
    state: 'failed',
    message: /실패.*plain text failure/,
  },
];

describe('runSite — non-success outcomes keep the stored deals', () => {
  it.each(FAILURE_CASES)('$title -> $state', async ({ crawl, state, message, swallowedBlock }) => {
    await seedPreviousSuccess('musinsa', 3);
    const dealsBefore = await readText('deals', 'musinsa');
    const rawBefore = await readText('raw', 'musinsa');
    const blockState: BlockState = {
      blocked: swallowedBlock === true ? new BlockedError('HTTP 429', BLOCK_URL) : null,
    };

    const result = await runSite('musinsa', optionsFor(crawl, { createContext: () => makeContext(blockState) }));

    expect(result).toMatchObject({ siteId: 'musinsa', state, dealCount: 3, skipped: null });
    expect(result.message).toMatch(message);
    expect(result.message).toMatch(KOREAN);
    expect(await readText('deals', 'musinsa')).toBe(dealsBefore);
    expect(await readText('raw', 'musinsa')).toBe(rawBefore);
    const status = await readStatus('musinsa');
    expect(status).toMatchObject({
      enabled: true,
      state,
      lastRunAt: NOW_ISO,
      lastSuccessAt: OLD_ISO,
      dealCount: 3,
      message: result.message,
      cooldownUntil: state === 'blocked' ? SIX_HOURS_LATER_ISO : null,
    });
    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
    expect(await getRunPhase('musinsa')).toBe('idle');
  });

  it('reports dealCount 0 and writes no deals file when a first run fails', async () => {
    const crawl: Crawl = async () => {
      throw new Error('boom');
    };

    const result = await runSite('ably', optionsFor(crawl));

    expect(result).toMatchObject({ state: 'failed', dealCount: 0 });
    expect(await readDeals('ably')).toBeNull();
    expect(await readRaw('ably')).toBeNull();
    expect(await readStatus('ably')).toMatchObject({ state: 'failed', lastSuccessAt: null, dealCount: 0 });
  });

  it('sets the block cooldown to six hours after the moment the block was seen', async () => {
    const seenAt = new Date('2026-11-27T12:10:00.000Z');
    let current = NOW;
    const crawl: Crawl = async () => {
      current = seenAt;
      throw new BlockedError('captcha', BLOCK_URL);
    };

    await runSite('musinsa', optionsFor(crawl, { now: () => current }));

    expect(await readStatus('musinsa')).toMatchObject({
      state: 'blocked',
      lastRunAt: NOW_ISO,
      cooldownUntil: '2026-11-28T03:10:00+09:00',
    });
  });

  it('is "blocked" when the adapter turned a block into another error', async () => {
    const blockState: BlockState = { blocked: null };
    const crawl: Crawl = async () => {
      blockState.blocked = new BlockedError('로봇이 아닙니다', BLOCK_URL);
      throw new Error('상품 목록을 찾지 못했습니다');
    };

    const result = await runSite('musinsa', optionsFor(crawl, { createContext: () => makeContext(blockState) }));

    expect(result.state).toBe('blocked');
    expect(result.message).toContain('로봇이 아닙니다');
  });

  it('keeps the six-hour cooldown out of a later non-blocked failure', async () => {
    await writeStatus({ ...defaultStatus('musinsa'), state: 'blocked', cooldownUntil: SIX_HOURS_LATER_ISO });
    const crawl: Crawl = async () => {
      throw new Error('timeout');
    };

    const result = await runSite('musinsa', optionsFor(crawl, { force: true }));

    expect(result.state).toBe('failed');
    expect((await readStatus('musinsa')).cooldownUntil).toBeNull();
  });

  it('answers with a failed result instead of throwing when the status file is unreadable', async () => {
    await writeBrokenStatus('musinsa', '{ broken');
    const crawl = vi.fn<Crawl>(async () => rawDeals(1));

    const result = await runSite('musinsa', optionsFor(crawl));

    expect(result).toMatchObject({ siteId: 'musinsa', state: 'failed', skipped: null });
    expect(result.message).toMatch(KOREAN);
    expect(result.message).toContain('status/musinsa.json');
    expect(crawl).not.toHaveBeenCalled();
    expect(await readText('status', 'musinsa')).toBe('{ broken');
    expect(await getRunPhase('musinsa')).toBe('idle');
  });

  it('is "failed" and keeps the old deals when the new data cannot be saved', async () => {
    await seedPreviousSuccess('musinsa', 3);
    const dealsBefore = await readText('deals', 'musinsa');
    const crawl: Crawl = async () => {
      // A non-empty folder where raw/musinsa.json should go: the atomic rename over it fails.
      await rm(filePath('raw', 'musinsa'));
      await mkdir(path.join(filePath('raw', 'musinsa'), 'occupied'), { recursive: true });
      return rawDeals(2, 'new');
    };

    const result = await runSite('musinsa', optionsFor(crawl));

    expect(result).toMatchObject({ state: 'failed', dealCount: 3, skipped: null });
    expect(result.message).toMatch(KOREAN);
    expect(result.message).toContain('raw/musinsa.json');
    expect(await readText('deals', 'musinsa')).toBe(dealsBefore);
    expect(await readStatus('musinsa')).toMatchObject({ state: 'failed', dealCount: 3, lastSuccessAt: OLD_ISO });
    expect(await getRunPhase('musinsa')).toBe('idle');
  });
});

// ---------- runSite: skipping ----------

describe('runSite — skipping', () => {
  it('skips a site in cooldown and leaves its status untouched', async () => {
    const status: SiteStatus = {
      ...defaultStatus('musinsa'),
      state: 'blocked',
      lastRunAt: OLD_ISO,
      dealCount: 7,
      message: '차단이 감지되었습니다',
      cooldownUntil: SIX_HOURS_LATER_ISO,
    };
    await writeStatus(status);
    const before = await readText('status', 'musinsa');
    const crawl = vi.fn<Crawl>(async () => rawDeals(1));

    const result = await runSite('musinsa', optionsFor(crawl));

    expect(result).toEqual<SiteRunResult>({
      siteId: 'musinsa',
      state: 'blocked',
      dealCount: 7,
      message: '차단이 감지되었습니다',
      skipped: 'cooldown',
    });
    expect(crawl).not.toHaveBeenCalled();
    expect(await readText('status', 'musinsa')).toBe(before);
    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
  });

  it('runs a site in cooldown when force is set', async () => {
    await writeStatus({ ...defaultStatus('musinsa'), state: 'blocked', cooldownUntil: SIX_HOURS_LATER_ISO });

    const result = await runSite('musinsa', optionsFor(async () => rawDeals(2), { force: true }));

    expect(result).toMatchObject({ state: 'ok', dealCount: 2, skipped: null });
    expect((await readStatus('musinsa')).cooldownUntil).toBeNull();
  });

  it('runs again once the cooldown is over', async () => {
    await writeStatus({ ...defaultStatus('musinsa'), state: 'blocked', cooldownUntil: OLD_ISO });

    const result = await runSite('musinsa', optionsFor(async () => rawDeals(1)));

    expect(result).toMatchObject({ state: 'ok', skipped: null });
  });

  it('skips a disabled site, even with force', async () => {
    await writeStatus({ ...defaultStatus('zigzag'), enabled: false, state: 'ok', dealCount: 4 });
    const before = await readText('status', 'zigzag');
    const crawl = vi.fn<Crawl>(async () => rawDeals(1));

    const result = await runSite('zigzag', optionsFor(crawl, { force: true }));

    expect(result).toMatchObject({ state: 'ok', dealCount: 4, skipped: 'disabled' });
    expect(crawl).not.toHaveBeenCalled();
    expect(await readText('status', 'zigzag')).toBe(before);
  });

  it('runs a site whose stored state is "not_implemented" (that is how a new adapter gets picked up)', async () => {
    await writeStatus({ ...defaultStatus('zigzag'), state: 'not_implemented', message: '수집기 준비 중' });

    const result = await runSite('zigzag', optionsFor(async () => rawDeals(1)));

    expect(result).toMatchObject({ state: 'ok', skipped: null });
  });

  it('skips a site that this process is already crawling', async () => {
    const gate = crawlGate();
    const first = runSite('musinsa', optionsFor(() => gate.promise));
    await waitForPhase('musinsa', 'running');
    const secondCrawl = vi.fn<Crawl>(async () => rawDeals(1));

    const second = await runSite('musinsa', optionsFor(secondCrawl, { force: true }));

    expect(second).toMatchObject({ state: 'never_run', dealCount: 0, skipped: 'running' });
    expect(secondCrawl).not.toHaveBeenCalled();
    expect(await getRunPhase('musinsa')).toBe('running');
    gate.resolve(rawDeals(1));
    expect((await first).state).toBe('ok');
  });

  it('lets only one of two simultaneous calls crawl', async () => {
    const gate = crawlGate();
    const crawl = vi.fn<Crawl>(() => gate.promise);

    const both = Promise.all([runSite('musinsa', optionsFor(crawl)), runSite('musinsa', optionsFor(crawl))]);
    await waitForPhase('musinsa', 'running');
    gate.resolve(rawDeals(1));
    const results = await both;

    expect(crawl).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.skipped === 'running')).toHaveLength(1);
    expect(results.filter((result) => result.state === 'ok' && result.skipped === null)).toHaveLength(1);
  });

  it('skips a site that another live process holds a fresh lock for', async () => {
    await writeLock('musinsa', { pid: otherLivePid(), phase: 'running', startedAt: isoMinutesAgo(1) });
    const lockBefore = await readText('locks', 'musinsa');
    const crawl = vi.fn<Crawl>(async () => rawDeals(1));

    const result = await runSite('musinsa', optionsFor(crawl));

    expect(result.skipped).toBe('running');
    expect(crawl).not.toHaveBeenCalled();
    expect(await readText('locks', 'musinsa')).toBe(lockBefore);
    await clearLock('musinsa');
  });
});

// ---------- run tracking: registry and lock files ----------

describe('run tracking', () => {
  it('is idle when nothing runs and there is no lock file', async () => {
    expect(await getRunPhase('musinsa')).toBe('idle');
  });

  it('holds a lock file { pid, phase, startedAt } while crawling and removes it after success', async () => {
    let lockDuringCrawl: unknown = null;
    let phaseDuringCrawl: string | null = null;
    const crawl: Crawl = async () => {
      lockDuringCrawl = JSON.parse(await readText('locks', 'musinsa'));
      phaseDuringCrawl = await getRunPhase('musinsa');
      return rawDeals(1);
    };
    const startedAfter = Date.now() - 1_000;

    await runSite('musinsa', optionsFor(crawl));

    expect(lockDuringCrawl).toMatchObject({ pid: process.pid, phase: 'running' });
    const startedAt = Date.parse((lockDuringCrawl as LockContent).startedAt);
    expect(startedAt).toBeGreaterThanOrEqual(startedAfter);
    expect(startedAt).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(phaseDuringCrawl).toBe('running');
    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
    expect(await getRunPhase('musinsa')).toBe('idle');
  });

  it('releases the lock after a failure, so the next run can start', async () => {
    const failing: Crawl = async () => {
      throw new Error('boom');
    };

    await runSite('musinsa', optionsFor(failing));

    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
    expect(await getRunPhase('musinsa')).toBe('idle');
    expect((await runSite('musinsa', optionsFor(async () => rawDeals(1)))).state).toBe('ok');
  });

  it.each(['queued', 'running'] as const)('reports a fresh "%s" lock of another live process', async (phase) => {
    await writeLock('29cm', { pid: otherLivePid(), phase, startedAt: isoMinutesAgo(2) });

    expect(await getRunPhase('29cm')).toBe(phase);

    await clearLock('29cm');
  });

  const STALE_LOCKS: { title: string; content: () => LockContent | string }[] = [
    {
      title: 'older than 20 minutes',
      content: () => ({
        pid: otherLivePid(),
        phase: 'running',
        startedAt: new Date(Date.now() - STALE_LOCK_AGE_MS).toISOString(),
      }),
    },
    { title: 'not JSON', content: () => '{ "pid": 12' },
    { title: 'empty', content: () => '' },
    { title: 'JSON of the wrong shape', content: () => JSON.stringify({ pid: 'abc', phase: 'running' }) },
    {
      title: 'with an unknown phase',
      content: () => JSON.stringify({ pid: otherLivePid(), phase: 'idle', startedAt: isoMinutesAgo(1) }),
    },
    {
      title: 'with an unreadable start time',
      content: () => JSON.stringify({ pid: otherLivePid(), phase: 'running', startedAt: '방금' }),
    },
    {
      title: 'with a start time far in the future',
      content: () => ({ pid: otherLivePid(), phase: 'running', startedAt: isoMinutesFromNow(60) }),
    },
    {
      title: 'of a process that no longer exists',
      content: () => ({ pid: deadPid(), phase: 'running', startedAt: isoMinutesAgo(1) }),
    },
    {
      title: 'left behind by this process without a run in memory',
      content: () => ({ pid: process.pid, phase: 'running', startedAt: isoMinutesAgo(1) }),
    },
    {
      title: 'with a pid that is not a positive integer',
      content: () => JSON.stringify({ pid: 0, phase: 'running', startedAt: isoMinutesAgo(1) }),
    },
  ];

  it.each(STALE_LOCKS)('ignores a stale lock: $title', async ({ content }) => {
    await writeLock('musinsa', content());

    expect(await getRunPhase('musinsa')).toBe('idle');
    const result = await runSite('musinsa', optionsFor(async () => rawDeals(1)));

    expect(result).toMatchObject({ state: 'ok', skipped: null });
    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
  });
});

// ---------- runAll ----------

describe('runAll', () => {
  function crawlBySite(crawls: Partial<Record<SiteId, Crawl>>): RunOptions['getAdapter'] {
    return (id) =>
      fakeAdapter(id, async (ctx) => {
        const crawl = crawls[id];
        if (crawl === undefined) throw new NotImplementedError(id);
        return crawl(ctx);
      });
  }

  it('saves sites 1 and 3 when site 2 throws', async () => {
    await seedPreviousSuccess('29cm', 2);
    const getAdapter = crawlBySite({
      musinsa: async () => rawDeals(2, 'm'),
      '29cm': async () => {
        throw new Error('site 2 exploded');
      },
      wconcept: async () => rawDeals(3, 'w'),
    });

    const results = await runAll(optionsFor(async () => [], { getAdapter }));

    expect(results.map((result) => result.siteId)).toEqual([...SITE_IDS]);
    expect(results.slice(0, 3).map((result) => result.state)).toEqual(['ok', 'failed', 'ok']);
    expect(results.slice(3).every((result) => result.state === 'not_implemented')).toBe(true);
    expect((await readDeals('musinsa'))?.deals).toHaveLength(2);
    expect((await readDeals('29cm'))?.deals).toHaveLength(2);
    expect((await readDeals('wconcept'))?.deals).toHaveLength(3);
    expect(await readStatus('29cm')).toMatchObject({ state: 'failed', dealCount: 2 });
    expect((await readStatus('29cm')).message).toContain('site 2 exploded');
    expect(await readStatus('4910')).toMatchObject({ state: 'not_implemented', dealCount: 0 });
  });

  it('carries on after a site whose status file is unreadable', async () => {
    await writeBrokenStatus('musinsa', 'not json');
    const getAdapter = crawlBySite({ '29cm': async () => rawDeals(1) });

    const results = await runAll(optionsFor(async () => [], { getAdapter }));

    expect(results).toHaveLength(SITE_IDS.length);
    expect(results[0]).toMatchObject({ siteId: 'musinsa', state: 'failed' });
    expect(results[1]).toMatchObject({ siteId: '29cm', state: 'ok', dealCount: 1 });
  });

  it('skips disabled and cooling-down sites but still reports them, in SITE_IDS order', async () => {
    await writeStatus({ ...defaultStatus('musinsa'), enabled: false, state: 'ok', dealCount: 9 });
    await writeStatus({ ...defaultStatus('29cm'), state: 'blocked', cooldownUntil: SIX_HOURS_LATER_ISO });
    const crawl = vi.fn<Crawl>(async () => rawDeals(1));

    const results = await runAll(optionsFor(crawl));

    expect(results.map((result) => result.siteId)).toEqual([...SITE_IDS]);
    expect(results[0]).toMatchObject({ state: 'ok', dealCount: 9, skipped: 'disabled' });
    expect(results[1]).toMatchObject({ state: 'blocked', skipped: 'cooldown' });
    expect(results.slice(2).every((result) => result.state === 'ok' && result.skipped === null)).toBe(true);
    expect(crawl).toHaveBeenCalledTimes(SITE_IDS.length - 2);
  });

  it('ignores cooldowns with force but never a disabled switch', async () => {
    await writeStatus({ ...defaultStatus('musinsa'), enabled: false });
    await writeStatus({ ...defaultStatus('29cm'), state: 'blocked', cooldownUntil: SIX_HOURS_LATER_ISO });

    const results = await runAll(optionsFor(async () => rawDeals(1), { force: true }));

    expect(results[0].skipped).toBe('disabled');
    expect(results[1]).toMatchObject({ state: 'ok', skipped: null });
  });

  it('crawls one site at a time, in SITE_IDS order', async () => {
    const events: string[] = [];
    let active = 0;
    let mostActive = 0;
    const getAdapter: RunOptions['getAdapter'] = (id) =>
      fakeAdapter(id, async () => {
        active += 1;
        mostActive = Math.max(mostActive, active);
        events.push(`start ${id}`);
        await new Promise((resolve) => setTimeout(resolve, 2));
        events.push(`end ${id}`);
        active -= 1;
        return rawDeals(1);
      });

    await runAll(optionsFor(async () => [], { getAdapter }));

    expect(mostActive).toBe(1);
    expect(events).toEqual(SITE_IDS.flatMap((id) => [`start ${id}`, `end ${id}`]));
  });

  it('stops before the next site after cancelActiveRuns() and aborts the running one', async () => {
    const seen: { siteId: SiteId; signal: AbortSignal }[] = [];
    const crawled: SiteId[] = [];
    const createContext: RunOptions['createContext'] = (adapter, signal) => {
      seen.push({ siteId: adapter.id, signal });
      return makeContext();
    };
    const getAdapter: RunOptions['getAdapter'] = (id) =>
      fakeAdapter(id, async () => {
        crawled.push(id);
        if (id === '29cm') {
          cancelActiveRuns();
          throw Object.assign(new Error('수집이 중단되었습니다'), { name: 'AbortError' });
        }
        return rawDeals(1);
      });
    await seedPreviousSuccess('29cm', 2);

    const results = await runAll(optionsFor(async () => [], { getAdapter, createContext }));

    expect(crawled).toEqual(['musinsa', '29cm']);
    expect(results.map((result) => result.siteId)).toEqual(['musinsa', '29cm']);
    expect(results[1].state).toBe('failed');
    expect(results[1].message).toContain('중단');
    expect(seen.map((entry) => entry.signal.aborted)).toEqual([false, true]);
    expect(await readStatus('29cm')).toMatchObject({ state: 'failed', dealCount: 2 });
    expect(await readStatus('wconcept')).toEqual(defaultStatus('wconcept'));
    expect(await getRunPhase('29cm')).toBe('idle');
  });

  it('does not save what an adapter returns after the run was cancelled', async () => {
    await seedPreviousSuccess('musinsa', 3);
    const dealsBefore = await readText('deals', 'musinsa');
    const crawl: Crawl = async () => {
      cancelActiveRuns();
      return rawDeals(1, 'partial');
    };

    const result = await runSite('musinsa', optionsFor(crawl));

    expect(result).toMatchObject({ state: 'failed', dealCount: 3 });
    expect(result.message).toContain('중단');
    expect(await readText('deals', 'musinsa')).toBe(dealsBefore);
  });

  it('runs normally again after an earlier cancel', async () => {
    cancelActiveRuns();

    const results = await runAll(optionsFor(async () => rawDeals(1)));

    expect(results).toHaveLength(SITE_IDS.length);
    expect(results.every((result) => result.state === 'ok')).toBe(true);
  });
});

// ---------- renormalizeSite ----------

describe('renormalizeSite', () => {
  it('returns null and writes nothing when the site has no raw file', async () => {
    expect(await renormalizeSite('musinsa')).toBeNull();
    expect(await readDeals('musinsa')).toBeNull();
    expect(existsSync(filePath('status', 'musinsa'))).toBe(false);
  });

  it('rebuilds the deals from the raw file without calling an adapter or the network', async () => {
    const raws = [...rawDeals(3), rawDeal('p1', { salePrice: 10_000 }), rawDeal('bad', { salePrice: -1 })];
    await writeRaw({ siteId: 'musinsa', crawledAt: OLD_ISO, deals: raws });
    await writeDeals({ siteId: 'musinsa', crawledAt: OLD_ISO, deals: [] });
    await writeStatus({
      ...defaultStatus('musinsa'),
      state: 'failed',
      lastRunAt: NOW_ISO,
      lastSuccessAt: OLD_ISO,
      dealCount: 0,
      message: '수집에 실패했습니다',
    });
    const crawl = vi.fn<Crawl>(async () => []);
    registryCrawls.set('musinsa', crawl);

    const count = await renormalizeSite('musinsa', { now: () => NOW });

    expect(count).toBe(3);
    expect(await readDeals('musinsa')).toEqual({
      siteId: 'musinsa',
      crawledAt: OLD_ISO,
      deals: normalizeDeals(raws, 'musinsa', OLD_ISO),
    });
    expect(await readStatus('musinsa')).toEqual<SiteStatus>({
      siteId: 'musinsa',
      enabled: true,
      state: 'failed',
      lastRunAt: NOW_ISO,
      lastSuccessAt: OLD_ISO,
      dealCount: 3,
      message: '수집에 실패했습니다',
      cooldownUntil: null,
    });
    expect(crawl).not.toHaveBeenCalled();
    expect(createObscuraContext).not.toHaveBeenCalled();
    expect(await getRunPhase('musinsa')).toBe('idle');
  });

  it('refuses to replace stored deals with nothing', async () => {
    await seedPreviousSuccess('musinsa', 2);
    const dealsBefore = await readText('deals', 'musinsa');
    await writeRaw({ siteId: 'musinsa', crawledAt: OLD_ISO, deals: [rawDeal('1', { salePrice: 0 })] });

    await expect(renormalizeSite('musinsa')).rejects.toThrow(KOREAN);

    expect(await readText('deals', 'musinsa')).toBe(dealsBefore);
    expect((await readStatus('musinsa')).dealCount).toBe(2);
    expect(await getRunPhase('musinsa')).toBe('idle');
  });

  it('refuses to run while the site is being crawled', async () => {
    await seedPreviousSuccess('musinsa', 2);
    await writeLock('musinsa', { pid: otherLivePid(), phase: 'running', startedAt: isoMinutesAgo(1) });

    await expect(renormalizeSite('musinsa')).rejects.toThrow(/수집/);

    await clearLock('musinsa');
  });
});

// ---------- startBackgroundRun ----------

describe('startBackgroundRun', () => {
  let stderr: string[] = [];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
      stderr.push(String(chunk));
      return true;
    });
  });

  it('starts one site, returns before the crawl ends, and the crawl finishes in the background', async () => {
    const gate = crawlGate();
    registryCrawls.set('musinsa', () => gate.promise);

    const answer = await startBackgroundRun('musinsa');

    expect(answer).toEqual({ started: ['musinsa'], skipped: [] });
    expect(['queued', 'running']).toContain(await getRunPhase('musinsa'));
    await waitForPhase('musinsa', 'running');
    expect(await readDeals('musinsa')).toBeNull();
    gate.resolve(rawDeals(2));
    await waitForPhase('musinsa', 'idle');
    expect(await readStatus('musinsa')).toMatchObject({ state: 'ok', dealCount: 2 });
    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
  });

  it('answers with the reason instead of starting a single site that cannot start', async () => {
    registryCrawls.set('musinsa', async () => rawDeals(1));
    await writeStatus({ ...defaultStatus('musinsa'), enabled: false });
    expect(await startBackgroundRun('musinsa')).toEqual({
      started: [],
      skipped: [{ siteId: 'musinsa', reason: 'disabled' }],
    });

    await writeStatus({
      ...defaultStatus('musinsa'),
      state: 'blocked',
      cooldownUntil: isoMinutesFromNow(60),
    });
    expect(await startBackgroundRun('musinsa', { force: false })).toEqual({
      started: [],
      skipped: [{ siteId: 'musinsa', reason: 'cooldown' }],
    });

    await writeStatus({ ...defaultStatus('musinsa'), state: 'not_implemented' });
    expect(await startBackgroundRun('musinsa', { force: true })).toEqual({
      started: [],
      skipped: [{ siteId: 'musinsa', reason: 'not_implemented' }],
    });

    await writeStatus(defaultStatus('musinsa'));
    await writeLock('musinsa', { pid: otherLivePid(), phase: 'running', startedAt: isoMinutesAgo(1) });
    expect(await startBackgroundRun('musinsa', { force: true })).toEqual({
      started: [],
      skipped: [{ siteId: 'musinsa', reason: 'running' }],
    });
    await clearLock('musinsa');
    expect(createObscuraContext).not.toHaveBeenCalled();
  });

  it('ignores the cooldown of a single site when force is set', async () => {
    registryCrawls.set('musinsa', async () => rawDeals(1));
    await writeStatus({
      ...defaultStatus('musinsa'),
      state: 'blocked',
      cooldownUntil: isoMinutesFromNow(60),
    });

    expect(await startBackgroundRun('musinsa', { force: true })).toEqual({ started: ['musinsa'], skipped: [] });

    await waitForPhase('musinsa', 'idle');
    expect(await readStatus('musinsa')).toMatchObject({ state: 'ok', cooldownUntil: null });
  });

  it('refuses a second start while the first is still running', async () => {
    const gate = crawlGate();
    registryCrawls.set('musinsa', () => gate.promise);
    await startBackgroundRun('musinsa');

    expect(await startBackgroundRun('musinsa', { force: true })).toEqual({
      started: [],
      skipped: [{ siteId: 'musinsa', reason: 'running' }],
    });
    expect(await startBackgroundRun('all')).toMatchObject({
      skipped: expect.arrayContaining([{ siteId: 'musinsa', reason: 'running' }]),
    });

    gate.resolve(rawDeals(1));
    await waitForAllIdle();
  });

  it('"all": queues every startable site at once, then crawls them one by one', async () => {
    const events: string[] = [];
    const gate = crawlGate();
    registryCrawls.set('musinsa', async () => {
      events.push('start musinsa');
      const deals = await gate.promise;
      events.push('end musinsa');
      return deals;
    });
    registryCrawls.set('29cm', async () => {
      events.push('start 29cm');
      return rawDeals(2);
    });
    registryCrawls.set('wconcept', async () => {
      events.push('start wconcept');
      throw new Error('wconcept exploded');
    });
    registryCrawls.set('naver', async () => rawDeals(1));
    registryCrawls.set('zigzag', async () => rawDeals(1));
    await writeStatus({ ...defaultStatus('naver'), enabled: false });
    await writeStatus({ ...defaultStatus('zigzag'), state: 'blocked', cooldownUntil: isoMinutesFromNow(60) });
    await writeStatus({ ...defaultStatus('ably'), state: 'not_implemented' });

    const answer = await startBackgroundRun('all');

    expect(answer).toEqual({
      started: ['musinsa', '29cm', 'wconcept', 'queenit', 'posty', '4910', 'attrangs'],
      skipped: [
        { siteId: 'naver', reason: 'disabled' },
        { siteId: 'zigzag', reason: 'cooldown' },
        { siteId: 'ably', reason: 'not_implemented' },
      ],
    });
    await waitForPhase('musinsa', 'running');
    for (const siteId of ['29cm', 'wconcept', 'queenit', 'posty', '4910', 'attrangs'] as const) {
      expect(await getRunPhase(siteId)).toBe('queued');
      expect(JSON.parse(await readText('locks', siteId))).toMatchObject({ pid: process.pid, phase: 'queued' });
    }
    for (const siteId of ['naver', 'zigzag', 'ably'] as const) expect(await getRunPhase(siteId)).toBe('idle');
    expect(events).toEqual(['start musinsa']);

    gate.resolve(rawDeals(3));
    await waitForAllIdle();

    expect(events).toEqual(['start musinsa', 'end musinsa', 'start 29cm', 'start wconcept']);
    expect(await readStatus('musinsa')).toMatchObject({ state: 'ok', dealCount: 3 });
    expect(await readStatus('29cm')).toMatchObject({ state: 'ok', dealCount: 2 });
    expect(await readStatus('wconcept')).toMatchObject({ state: 'failed' });
    expect(await readStatus('queenit')).toMatchObject({ state: 'not_implemented' });
    expect(await readStatus('4910')).toMatchObject({ state: 'not_implemented' });
    expect(await readStatus('zigzag')).toMatchObject({ state: 'blocked' });
    expect(await readDeals('naver')).toBeNull();
    for (const siteId of SITE_IDS) expect(existsSync(filePath('locks', siteId))).toBe(false);
  });

  it('"all" with force also starts sites in cooldown, but not disabled or known-stub sites', async () => {
    registryCrawls.set('zigzag', async () => rawDeals(1));
    await writeStatus({ ...defaultStatus('naver'), enabled: false });
    await writeStatus({ ...defaultStatus('zigzag'), state: 'blocked', cooldownUntil: isoMinutesFromNow(60) });
    await writeStatus({ ...defaultStatus('ably'), state: 'not_implemented' });

    const answer = await startBackgroundRun('all', { force: true });

    expect(answer.started).toContain('zigzag');
    expect(answer.skipped).toEqual([
      { siteId: 'naver', reason: 'disabled' },
      { siteId: 'ably', reason: 'not_implemented' },
    ]);
    await waitForAllIdle();
    expect(await readStatus('zigzag')).toMatchObject({ state: 'ok', cooldownUntil: null });
  });

  it('does not crawl a queued site that was switched off before its turn', async () => {
    const gate = crawlGate();
    const second = vi.fn<Crawl>(async () => rawDeals(1));
    registryCrawls.set('musinsa', () => gate.promise);
    registryCrawls.set('29cm', second);
    await startBackgroundRun('all');
    await waitForPhase('musinsa', 'running');

    await writeStatus({ ...defaultStatus('29cm'), enabled: false });
    gate.resolve(rawDeals(1));
    await waitForAllIdle();

    expect(second).not.toHaveBeenCalled();
    expect(await readStatus('29cm')).toEqual({ ...defaultStatus('29cm'), enabled: false });
  });

  it('keeps the lock of a waiting site fresh each time the batch moves on', async () => {
    const first = crawlGate();
    const second = crawlGate();
    registryCrawls.set('musinsa', () => first.promise);
    registryCrawls.set('29cm', () => second.promise);
    await startBackgroundRun('all');
    await waitForPhase('musinsa', 'running');
    const agedAt = isoMinutesAgo(15);
    await writeLock('wconcept', { pid: process.pid, phase: 'queued', startedAt: agedAt });

    first.resolve(rawDeals(1));
    await waitForPhase('29cm', 'running');

    const lock: unknown = JSON.parse(await readText('locks', 'wconcept'));
    expect(lock).toMatchObject({ pid: process.pid, phase: 'queued' });
    expect(Date.parse((lock as LockContent).startedAt)).toBeGreaterThan(Date.parse(agedAt) + 10 * MINUTE_MS);
    expect(await getRunPhase('wconcept')).toBe('queued');
    second.resolve(rawDeals(1));
    await waitForAllIdle();
  });

  it('logs a background failure to stderr instead of leaving an unhandled rejection', async () => {
    const gate = crawlGate();
    registryCrawls.set('musinsa', () => gate.promise);
    await startBackgroundRun('musinsa');
    await waitForPhase('musinsa', 'running');

    await writeBrokenStatus('musinsa', '{ broken');
    gate.resolve(rawDeals(1));
    await waitForPhase('musinsa', 'idle');

    // The mark is released just before the failure is reported, so wait for the line itself.
    await vi.waitFor(() => expect(stderr.join('')).toContain('status/musinsa.json'), {
      timeout: WAIT_TIMEOUT_MS,
      interval: WAIT_INTERVAL_MS,
    });
    const output = stderr.join('');
    expect(output).toContain('[musinsa]');
    expect(output).toMatch(KOREAN);
    expect(existsSync(filePath('locks', 'musinsa'))).toBe(false);
  });

  it('rejects with the storage error and starts nothing when a status file is unreadable', async () => {
    await writeBrokenStatus('29cm', 'not json');

    await expect(startBackgroundRun('all')).rejects.toThrow('status/29cm.json');

    for (const siteId of SITE_IDS) expect(await getRunPhase(siteId)).toBe('idle');
  });
});

// ---------- CLI helpers ----------

describe('parseCliArgs', () => {
  it.each([
    [['--site', 'musinsa'], { kind: 'run', target: 'musinsa', force: false, renormalize: false }],
    [['--site', 'all', '--force'], { kind: 'run', target: 'all', force: true, renormalize: false }],
    [['--force', '--site=29cm'], { kind: 'run', target: '29cm', force: true, renormalize: false }],
    [['--site', '4910', '--renormalize'], { kind: 'run', target: '4910', force: false, renormalize: true }],
    [['--renormalize', '--site=all'], { kind: 'run', target: 'all', force: false, renormalize: true }],
  ] as const)('reads %j', (argv, expected) => {
    expect(parseCliArgs(argv)).toEqual(expected);
  });

  it.each([['--help'], ['-h'], ['--site', 'musinsa', '--help']])('asks for the usage text on %j', (...argv) => {
    expect(parseCliArgs(argv)).toEqual({ kind: 'help' });
  });

  it.each([
    [[], /--site/],
    [['--site'], /--site/],
    [['--site', 'coupang'], /coupang/],
    [['--site', 'ALL'], /ALL/],
    [['--site='], /--site/],
    [['--site', '--force'], /--site/],
    [['--bogus', '--site', 'musinsa'], /--bogus/],
    [['musinsa'], /musinsa/],
    [['--site', 'musinsa', '--site', 'ably'], /--site/],
    [['--site', '../../etc'], /\.\.\/\.\.\/etc/],
  ] as const)('rejects %j with a Korean message', (argv, pattern) => {
    const parsed = parseCliArgs(argv);
    expect(parsed.kind).toBe('error');
    if (parsed.kind !== 'error') return;
    expect(parsed.message).toMatch(pattern);
    expect(parsed.message).toMatch(KOREAN);
  });

  it('does not modify the argument list', () => {
    const argv = Object.freeze(['--site', 'musinsa', '--force']);
    expect(() => parseCliArgs(argv)).not.toThrow();
  });
});

describe('formatResultLine', () => {
  const ok: SiteRunResult = { siteId: 'musinsa', state: 'ok', dealCount: 123, message: null, skipped: null };

  it('shows the site name, the state label and the deal count', () => {
    expect(formatResultLine(ok)).toBe('무신사: 정상 · 123건');
  });

  it('appends the message when there is one', () => {
    const blocked: SiteRunResult = { ...ok, siteId: '29cm', state: 'blocked', dealCount: 5, message: '차단 감지: captcha' };
    expect(formatResultLine(blocked)).toBe('29CM: 차단됨 · 5건 · 차단 감지: captcha');
  });

  it.each([
    ['cooldown', /쿨다운.*--force/],
    ['disabled', /꺼/],
    ['running', /이미 수집 중/],
    ['not_implemented', /준비 중/],
  ] as const)('says why a site was skipped: %s', (skipped, pattern) => {
    const line = formatResultLine({ ...ok, state: 'blocked', skipped });
    expect(line).toMatch(/^무신사: 건너뜀/);
    expect(line).toMatch(pattern);
    expect(line).toContain('123건');
  });

  it('is a single line even when the message has line breaks', () => {
    expect(formatResultLine({ ...ok, state: 'failed', message: '첫 줄\r\n둘째 줄' })).not.toMatch(/[\r\n]/);
  });
});

describe('getExitCode', () => {
  const result = (state: SiteState, skipped: SiteRunResult['skipped'] = null): SiteRunResult => ({
    siteId: 'musinsa',
    state,
    dealCount: 0,
    message: null,
    skipped,
  });

  it('is 0 when every site ended ok, not_implemented or never_run', () => {
    expect(getExitCode([result('ok'), result('not_implemented'), result('never_run')])).toBe(0);
    expect(getExitCode([])).toBe(0);
  });

  it.each(['failed', 'blocked', 'suspect_layout', 'login_required'] as const)('is 1 when a site ended %s', (state) => {
    expect(getExitCode([result('ok'), result(state)])).toBe(1);
  });

  it('does not count the old state of a skipped site', () => {
    expect(getExitCode([result('blocked', 'cooldown'), result('failed', 'disabled'), result('ok')])).toBe(0);
  });
});

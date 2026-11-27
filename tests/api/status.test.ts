import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApiResponse,
  RunPhase,
  SiteId,
  SiteStatus,
  SiteStatusView,
  StatusResponse,
} from '@/lib/types';
import { SITE_IDS } from '@/lib/types';

/** The runner is written by another task; these tests only need its run phase answer. */
const runnerMock = vi.hoisted(() => ({
  getRunPhase: vi.fn<(siteId: string) => Promise<'idle' | 'queued' | 'running'>>(),
}));

vi.mock('@/crawler/runner', () => ({ getRunPhase: runnerMock.getRunPhase }));

import { GET, dynamic, runtime } from '@/app/api/status/route';
import {
  PATCH,
  dynamic as patchDynamic,
  runtime as patchRuntime,
} from '@/app/api/status/[siteId]/route';
import { buildStatusView, partitionSettledStatuses } from '@/lib/server/status-view';
import { defaultStatus, readStatus, writeStatus } from '@/lib/store';

const KOREAN = /[가-힣]/;
const STATUS_URL = 'http://localhost/api/status';
const EXPECTED_NAMES: Readonly<Record<SiteId, string>> = {
  musinsa: '무신사',
  '29cm': '29CM',
  wconcept: 'W컨셉',
  naver: '네이버쇼핑',
  zigzag: '지그재그',
  ably: '에이블리',
  queenit: '퀸잇',
  posty: '포스티',
  '4910': '4910',
  attrangs: '아뜨랑스',
};
const OK_STATUS: SiteStatus = {
  siteId: 'musinsa',
  enabled: true,
  state: 'ok',
  lastRunAt: '2026-11-27T21:00:00+09:00',
  lastSuccessAt: '2026-11-27T21:01:00+09:00',
  dealCount: 42,
  message: null,
  cooldownUntil: null,
};

let dataDir = '';
let previousDataDir: string | undefined;
let stderrLines: string[] = [];

beforeEach(async () => {
  previousDataDir = process.env.BF_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), 'bf-api-status-'));
  process.env.BF_DATA_DIR = dataDir;
  stderrLines = [];
  runnerMock.getRunPhase.mockReset();
  runnerMock.getRunPhase.mockResolvedValue('idle');
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

async function writeBrokenStatus(siteId: SiteId): Promise<void> {
  await mkdir(path.join(dataDir, 'status'), { recursive: true });
  await writeFile(path.join(dataDir, 'status', `${siteId}.json`), '{ this is not json', 'utf8');
}

async function readBody<T>(response: Response): Promise<ApiResponse<T>> {
  return (await response.json()) as ApiResponse<T>;
}

async function getSites(): Promise<SiteStatusView[]> {
  const response = await GET();
  const body = await readBody<StatusResponse>(response);
  if (!body.ok) throw new Error(`expected ok response, got: ${body.error}`);
  return body.data.sites;
}

function patchRequest(siteId: string, body: unknown): Request {
  return new Request(`${STATUS_URL}/${encodeURIComponent(siteId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function callPatch(siteId: string, body: unknown): Promise<Response> {
  return PATCH(patchRequest(siteId, body), { params: Promise.resolve({ siteId }) });
}

async function expectBadRequest(response: Response): Promise<void> {
  const body = await readBody<SiteStatusView>(response);
  expect(response.status).toBe(400);
  expect(body.ok).toBe(false);
  expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
}

describe('buildStatusView', () => {
  it('adds the display name and run phase to the stored status', () => {
    const view = buildStatusView(OK_STATUS, '무신사', 'running');

    expect(view).toEqual({ ...OK_STATUS, displayName: '무신사', run: 'running' });
  });

  it('shows a switched-off site as disabled without touching the other fields', () => {
    const stored: SiteStatus = { ...OK_STATUS, enabled: false, state: 'blocked', message: '차단' };

    const view = buildStatusView(stored, '무신사', 'idle');

    expect(view.state).toBe('disabled');
    expect(view.enabled).toBe(false);
    expect(view).toEqual({ ...stored, state: 'disabled', displayName: '무신사', run: 'idle' });
  });

  it.each(['ok', 'failed', 'suspect_layout', 'blocked', 'not_implemented', 'never_run'] as const)(
    'keeps the stored state %s while the site is enabled',
    (state) => {
      expect(buildStatusView({ ...OK_STATUS, state }, '무신사', 'idle').state).toBe(state);
    },
  );

  it('returns a new object and leaves the input alone', () => {
    const stored: SiteStatus = { ...OK_STATUS, enabled: false };
    const snapshot = JSON.stringify(stored);

    const view = buildStatusView(stored, '무신사', 'queued');

    expect(view).not.toBe(stored);
    expect(JSON.stringify(stored)).toBe(snapshot);
  });

  it('copies only the contract fields', () => {
    const withExtra = { ...OK_STATUS, secretPath: 'C:\\somewhere' } as SiteStatus;

    const view = buildStatusView(withExtra, '무신사', 'idle');

    expect(Object.keys(view).sort()).toEqual(
      [...Object.keys(OK_STATUS), 'displayName', 'run'].sort(),
    );
  });
});

describe('partitionSettledStatuses', () => {
  it('separates readable statuses from the sites that failed, keeping the order', () => {
    const reason = new Error('boom');
    const outcome = partitionSettledStatuses(
      ['musinsa', '29cm', 'naver'],
      [
        { status: 'fulfilled', value: defaultStatus('musinsa') },
        { status: 'rejected', reason },
        { status: 'fulfilled', value: defaultStatus('naver') },
      ],
    );

    expect(outcome.statuses.map((status) => status.siteId)).toEqual(['musinsa', 'naver']);
    expect(outcome.failures).toEqual([{ siteId: '29cm', reason }]);
  });
});

describe('GET /api/status', () => {
  it('declares the routes as dynamic and node-only', () => {
    expect([dynamic, runtime]).toEqual(['force-dynamic', 'nodejs']);
    expect([patchDynamic, patchRuntime]).toEqual(['force-dynamic', 'nodejs']);
  });

  it('lists all nine sites in the fixed order with defaults before the first run', async () => {
    const response = await GET();
    const body = await readBody<StatusResponse>(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      ok: true,
      data: {
        sites: SITE_IDS.map((siteId) => ({
          ...defaultStatus(siteId),
          displayName: EXPECTED_NAMES[siteId],
          run: 'idle',
        })),
      },
    });
  });

  it('returns stored statuses with the run phase of each site', async () => {
    const phases: Partial<Record<SiteId, RunPhase>> = { musinsa: 'running', naver: 'queued' };
    runnerMock.getRunPhase.mockImplementation(
      async (siteId) => phases[siteId as SiteId] ?? 'idle',
    );
    await writeStatus(OK_STATUS);

    const sites = await getSites();

    expect(sites.map((site) => site.siteId)).toEqual([...SITE_IDS]);
    expect(sites[0]).toEqual({ ...OK_STATUS, displayName: '무신사', run: 'running' });
    expect(sites.map((site) => site.run)).toEqual(
      SITE_IDS.map((siteId) => phases[siteId] ?? 'idle'),
    );
    expect(runnerMock.getRunPhase).toHaveBeenCalledTimes(SITE_IDS.length);
  });

  it('derives disabled for a switched-off site and leaves the stored state as it was', async () => {
    await writeStatus({ ...OK_STATUS, enabled: false, state: 'blocked' });

    const sites = await getSites();

    expect(sites[0].state).toBe('disabled');
    expect(sites[0].enabled).toBe(false);
    expect((await readStatus('musinsa')).state).toBe('blocked');
  });

  it('answers 500 naming the unreadable status file, without local paths', async () => {
    await writeBrokenStatus('naver');

    const response = await GET();
    const text = await response.text();
    const body = JSON.parse(text) as ApiResponse<StatusResponse>;

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(text).toContain('status/naver.json');
    expect(text).not.toContain(dataDir);
    expect(text).not.toContain(JSON.stringify(dataDir).slice(1, -1));
    expect(stderrLines.join('')).toContain('naver');
  });

  it('answers 500 with a Korean message when the run phase cannot be read', async () => {
    runnerMock.getRunPhase.mockRejectedValue(new Error(`EIO at ${dataDir}`));

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(KOREAN.test(text)).toBe(true);
    expect(text).not.toContain('EIO');
    expect(stderrLines.join('')).toContain('EIO');
  });
});

describe('PATCH /api/status/:siteId', () => {
  it('switches a site off and returns the view with the derived state', async () => {
    await writeStatus(OK_STATUS);

    const response = await callPatch('musinsa', { enabled: false });
    const body = await readBody<SiteStatusView>(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      data: {
        ...OK_STATUS,
        enabled: false,
        state: 'disabled',
        displayName: '무신사',
        run: 'idle',
      },
    });
    expect(await readStatus('musinsa')).toEqual({ ...OK_STATUS, enabled: false });
  });

  it('shows the last result again when the site is switched back on', async () => {
    await writeStatus({ ...OK_STATUS, enabled: false, state: 'suspect_layout' });

    const response = await callPatch('musinsa', { enabled: true });
    const body = await readBody<SiteStatusView>(response);

    expect(response.status).toBe(200);
    expect(body.ok && body.data.state).toBe('suspect_layout');
    expect(body.ok && body.data.enabled).toBe(true);
    expect(await readStatus('musinsa')).toEqual({
      ...OK_STATUS,
      enabled: true,
      state: 'suspect_layout',
    });
  });

  it('creates the status file from the defaults for a site that never ran', async () => {
    runnerMock.getRunPhase.mockResolvedValue('queued');

    const response = await callPatch('29cm', { enabled: false });
    const body = await readBody<SiteStatusView>(response);

    expect(response.status).toBe(200);
    expect(body.ok && body.data).toEqual({
      ...defaultStatus('29cm'),
      enabled: false,
      state: 'disabled',
      displayName: '29CM',
      run: 'queued',
    });
    expect(await readStatus('29cm')).toEqual({ ...defaultStatus('29cm'), enabled: false });
    expect(runnerMock.getRunPhase).toHaveBeenCalledWith('29cm');
  });

  it('touches only the requested site', async () => {
    await writeStatus(OK_STATUS);

    await callPatch('29cm', { enabled: false });

    expect(await readStatus('musinsa')).toEqual(OK_STATUS);
  });

  it.each(['coupang', 'all', '../musinsa', 'MUSINSA', ''])(
    'answers 400 for the unknown site id "%s"',
    async (siteId) => {
      const response = await callPatch(siteId, { enabled: false });

      await expectBadRequest(response);
      await expect(readdir(dataDir)).resolves.toEqual([]);
    },
  );

  it.each([
    ['malformed JSON', '{ enabled: '],
    ['an empty body', ''],
    ['a string for enabled', { enabled: 'false' }],
    ['a number for enabled', { enabled: 0 }],
    ['null for enabled', { enabled: null }],
    ['a missing enabled', {}],
    ['an array', [{ enabled: false }]],
    ['null', null],
  ])('answers 400 for %s and stores nothing', async (_label, payload) => {
    await writeStatus(OK_STATUS);

    const response = await callPatch('musinsa', payload);

    await expectBadRequest(response);
    expect(await readStatus('musinsa')).toEqual(OK_STATUS);
  });

  it('answers 403 for a browser request from another site and stores nothing', async () => {
    await writeStatus(OK_STATUS);
    const request = new Request(`${STATUS_URL}/musinsa`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ enabled: false }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ siteId: 'musinsa' }) });
    const body = await readBody<SiteStatusView>(response);

    expect(response.status).toBe(403);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(await readStatus('musinsa')).toEqual(OK_STATUS);
  });

  it('accepts a browser request from the app itself', async () => {
    const request = new Request(`${STATUS_URL}/musinsa`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
        Host: 'localhost:3000',
      },
      body: JSON.stringify({ enabled: false }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ siteId: 'musinsa' }) });

    expect(response.status).toBe(200);
  });

  it('answers 500 with a Korean message when the status file is unreadable', async () => {
    await writeBrokenStatus('musinsa');

    const response = await callPatch('musinsa', { enabled: false });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(KOREAN.test(text)).toBe(true);
    expect(text).not.toContain(dataDir);
    expect(stderrLines.join('')).toContain('musinsa');
  });
});

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Lets one test make readAllDeals() fail in a way the route does not expect. */
const storeControl = vi.hoisted(() => ({ readAllDealsError: null as Error | null }));

vi.mock('@/lib/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/store')>();
  const readAllDeals: typeof actual.readAllDeals = async () => {
    if (storeControl.readAllDealsError !== null) throw storeControl.readAllDealsError;
    return actual.readAllDeals();
  };
  return { ...actual, readAllDeals };
});

import { GET, dynamic, runtime } from '@/app/api/deals/route';
import { latestSuccessAt } from '@/lib/server/status-view';
import { defaultStatus, writeDeals, writeStatus } from '@/lib/store';
import type { ApiResponse, Deal, DealsResponse, SiteId, SiteStatus } from '@/lib/types';

const CRAWLED_AT = '2026-11-27T21:00:00+09:00';
const LONG_AGO = '2020-01-01T00:00:00+09:00';
const FAR_FUTURE = '2099-12-31T23:59:00+09:00';
const KOREAN = /[가-힣]/;
const DEALS_URL = 'http://localhost/api/deals';

let dataDir = '';
let previousDataDir: string | undefined;
let stderrLines: string[] = [];

beforeEach(async () => {
  previousDataDir = process.env.BF_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), 'bf-api-deals-'));
  process.env.BF_DATA_DIR = dataDir;
  stderrLines = [];
  storeControl.readAllDealsError = null;
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

function makeDeal(siteId: SiteId, productId: string, overrides: Partial<Deal> = {}): Deal {
  return {
    id: `${siteId}:${productId}`,
    siteId,
    name: `상품 ${productId}`,
    brand: null,
    url: `https://example.com/${siteId}/${productId}`,
    imageUrl: null,
    originalPrice: 100000,
    salePrice: 70000,
    discountRate: 30,
    displayedDiscountRate: null,
    endsAt: null,
    endsAtSource: null,
    eventName: null,
    eventUrl: null,
    gender: 'unclassified',
    theme: 'unclassified',
    soldOut: false,
    crawledAt: CRAWLED_AT,
    ...overrides,
  };
}

function makeStatus(siteId: SiteId, overrides: Partial<SiteStatus> = {}): SiteStatus {
  return { ...defaultStatus(siteId), ...overrides };
}

async function seedDeals(siteId: SiteId, deals: Deal[]): Promise<void> {
  await writeDeals({ siteId, crawledAt: CRAWLED_AT, deals });
}

async function writeBrokenFile(folder: 'deals' | 'status', siteId: SiteId): Promise<void> {
  await mkdir(path.join(dataDir, folder), { recursive: true });
  await writeFile(path.join(dataDir, folder, `${siteId}.json`), '{ this is not json', 'utf8');
}

async function callDeals(query = ''): Promise<{ response: Response; data: DealsResponse }> {
  const response = await GET(new Request(`${DEALS_URL}${query}`));
  const body = (await response.json()) as ApiResponse<DealsResponse>;
  if (!body.ok) throw new Error(`expected ok response, got: ${body.error}`);
  return { response, data: body.data };
}

describe('GET /api/deals', () => {
  it('declares the route as dynamic and node-only', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(runtime).toBe('nodejs');
  });

  it('returns an empty list and null lastUpdatedAt when nothing was crawled yet', async () => {
    const response = await GET(new Request(DEALS_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, data: { deals: [], lastUpdatedAt: null } });
  });

  it('hides expired deals by default and keeps unknown or future end times', async () => {
    await seedDeals('musinsa', [
      makeDeal('musinsa', 'expired', { endsAt: LONG_AGO, endsAtSource: 'product' }),
      makeDeal('musinsa', 'future', { endsAt: FAR_FUTURE, endsAtSource: 'event' }),
      makeDeal('musinsa', 'unknown'),
      makeDeal('musinsa', 'unreadable', { endsAt: '곧 종료' }),
    ]);

    const { data } = await callDeals();

    expect(data.deals.map((deal) => deal.id)).toEqual([
      'musinsa:future',
      'musinsa:unknown',
      'musinsa:unreadable',
    ]);
  });

  it('returns stored deals unchanged', async () => {
    const stored = makeDeal('29cm', 'a1', { brand: '브랜드', endsAt: FAR_FUTURE, soldOut: true });
    await seedDeals('29cm', [stored]);

    const { data } = await callDeals();

    expect(data.deals).toEqual([stored]);
  });

  it('includes expired deals with includeExpired=1', async () => {
    await seedDeals('musinsa', [
      makeDeal('musinsa', 'expired', { endsAt: LONG_AGO, endsAtSource: 'product' }),
      makeDeal('musinsa', 'future', { endsAt: FAR_FUTURE, endsAtSource: 'product' }),
    ]);

    const { data } = await callDeals('?includeExpired=1');

    expect(data.deals.map((deal) => deal.id)).toEqual(['musinsa:expired', 'musinsa:future']);
  });

  it.each(['?includeExpired=0', '?includeExpired=', '?includeExpired=yes', '?other=1'])(
    'keeps expired deals hidden for %s',
    async (query) => {
      await seedDeals('musinsa', [makeDeal('musinsa', 'expired', { endsAt: LONG_AGO })]);

      const { data } = await callDeals(query);

      expect(data.deals).toEqual([]);
    },
  );

  it('merges all sites in SITE_IDS order', async () => {
    await seedDeals('4910', [makeDeal('4910', 'z')]);
    await seedDeals('musinsa', [makeDeal('musinsa', 'a')]);
    await seedDeals('zigzag', [makeDeal('zigzag', 'm')]);

    const { data } = await callDeals();

    expect(data.deals.map((deal) => deal.id)).toEqual(['musinsa:a', 'zigzag:m', '4910:z']);
  });

  it('reports the most recent lastSuccessAt as lastUpdatedAt', async () => {
    await writeStatus(
      makeStatus('musinsa', { state: 'ok', lastSuccessAt: '2026-11-27T21:00:00+09:00' }),
    );
    await writeStatus(
      makeStatus('29cm', { state: 'ok', lastSuccessAt: '2026-11-27T22:30:00+09:00' }),
    );
    await writeStatus(makeStatus('naver', { state: 'failed', lastSuccessAt: null }));

    const { data } = await callDeals();

    expect(data.lastUpdatedAt).toBe('2026-11-27T22:30:00+09:00');
  });

  it('keeps lastUpdatedAt when the newest deals are expired or the site is switched off', async () => {
    await seedDeals('musinsa', [makeDeal('musinsa', 'expired', { endsAt: LONG_AGO })]);
    await writeStatus(
      makeStatus('musinsa', {
        enabled: false,
        state: 'blocked',
        lastSuccessAt: '2026-11-26T09:00:00+09:00',
      }),
    );

    const { data } = await callDeals();

    expect(data.deals).toEqual([]);
    expect(data.lastUpdatedAt).toBe('2026-11-26T09:00:00+09:00');
  });

  it('still answers 200 with the readable sites when one deals file is broken', async () => {
    await seedDeals('musinsa', [makeDeal('musinsa', 'a')]);
    await writeBrokenFile('deals', '29cm');

    const { response, data } = await callDeals();

    expect(response.status).toBe(200);
    expect(data.deals.map((deal) => deal.id)).toEqual(['musinsa:a']);
    expect(stderrLines.join('')).toContain('29cm');
  });

  it('uses the readable statuses for lastUpdatedAt when one status file is broken', async () => {
    await seedDeals('musinsa', [makeDeal('musinsa', 'a')]);
    await writeStatus(
      makeStatus('musinsa', { state: 'ok', lastSuccessAt: '2026-11-27T21:00:00+09:00' }),
    );
    await writeBrokenFile('status', 'naver');

    const { response, data } = await callDeals();

    expect(response.status).toBe(200);
    expect(data.deals).toHaveLength(1);
    expect(data.lastUpdatedAt).toBe('2026-11-27T21:00:00+09:00');
    expect(stderrLines.join('')).toContain('naver');
  });

  it('answers 500 with a Korean message and no local path on an unexpected error', async () => {
    storeControl.readAllDealsError = new Error(`EIO: i/o error, open '${dataDir}'`);

    const response = await GET(new Request(DEALS_URL));
    const text = await response.text();
    const body = JSON.parse(text) as ApiResponse<DealsResponse>;

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.ok === false && KOREAN.test(body.error)).toBe(true);
    expect(text).not.toContain(dataDir);
    expect(text).not.toContain('EIO');
    expect(stderrLines.join('')).toContain('EIO');
  });
});

describe('latestSuccessAt', () => {
  it('returns null when there are no statuses or no successes', () => {
    expect(latestSuccessAt([])).toBeNull();
    expect(latestSuccessAt([makeStatus('musinsa'), makeStatus('29cm')])).toBeNull();
  });

  it('compares instants, not strings, and answers in the +09:00 form', () => {
    const statuses = [
      makeStatus('musinsa', { lastSuccessAt: '2026-11-27T21:00:00+09:00' }),
      // 12:30 UTC is 21:30 KST: later than the line above although the text sorts earlier.
      makeStatus('29cm', { lastSuccessAt: '2026-11-27T12:30:00Z' }),
    ];

    expect(latestSuccessAt(statuses)).toBe('2026-11-27T21:30:00+09:00');
  });

  it('ignores unreadable times instead of guessing', () => {
    const statuses = [
      makeStatus('musinsa', { lastSuccessAt: '어제쯤' }),
      makeStatus('29cm', { lastSuccessAt: '2026-11-25T08:00:00+09:00' }),
    ];

    expect(latestSuccessAt(statuses)).toBe('2026-11-25T08:00:00+09:00');
    expect(latestSuccessAt([makeStatus('musinsa', { lastSuccessAt: '어제쯤' })])).toBeNull();
  });

  it('does not change its input', () => {
    const statuses = [makeStatus('musinsa', { lastSuccessAt: '2026-11-27T21:00:00+09:00' })];
    const snapshot = JSON.stringify(statuses);

    latestSuccessAt(statuses);

    expect(JSON.stringify(statuses)).toBe(snapshot);
  });
});

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deal, DealsFile, RawDeal, SiteId, SiteStatus, SiteStatusView } from '@/lib/types';
import { SITE_IDS } from '@/lib/types';

/** Lets a test make the next N rename() calls fail the way Windows does when a reader holds the file. */
const renameControl = vi.hoisted(() => ({ failuresLeft: 0, code: 'EPERM', calls: 0 }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const rename: typeof actual.rename = async (from, to) => {
    renameControl.calls += 1;
    if (renameControl.failuresLeft > 0) {
      renameControl.failuresLeft -= 1;
      throw Object.assign(new Error('simulated rename failure'), { code: renameControl.code });
    }
    return actual.rename(from, to);
  };
  return { ...actual, rename, default: { ...actual, rename } };
});

import {
  defaultStatus,
  readAllDeals,
  readAllStatuses,
  readDeals,
  readRaw,
  readStatus,
  writeDeals,
  writeRaw,
  writeStatus,
} from '@/lib/store';
import type { RawFile } from '@/lib/store';

const CRAWLED_AT = '2026-11-27T21:00:00+09:00';
const LATER_CRAWLED_AT = '2026-11-27T23:00:00+09:00';
const KOREAN = /[가-힣]/;
const ALWAYS_FAIL = Number.MAX_SAFE_INTEGER;

let dataDir = '';
let previousDataDir: string | undefined;

beforeEach(async () => {
  previousDataDir = process.env.BF_DATA_DIR;
  dataDir = await mkdtemp(path.join(tmpdir(), 'bf-store-'));
  process.env.BF_DATA_DIR = dataDir;
  renameControl.failuresLeft = 0;
  renameControl.code = 'EPERM';
  renameControl.calls = 0;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.BF_DATA_DIR;
  else process.env.BF_DATA_DIR = previousDataDir;
});

function makeDeal(siteId: SiteId, productId: string, overrides: Partial<Deal> = {}): Deal {
  return {
    id: `${siteId}:${productId}`,
    siteId,
    name: `상품 ${productId}`,
    brand: '브랜드',
    url: `https://example.com/${siteId}/${productId}`,
    imageUrl: null,
    originalPrice: 100000,
    salePrice: 60000,
    discountRate: 40,
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

function makeDealsFile(siteId: SiteId, productIds: readonly string[]): DealsFile {
  return {
    siteId,
    crawledAt: CRAWLED_AT,
    deals: productIds.map((productId) => makeDeal(siteId, productId)),
  };
}

function makeRawDeal(productId: string): RawDeal {
  return {
    siteProductId: productId,
    name: `원본 상품 ${productId}`,
    url: `https://example.com/raw/${productId}`,
    salePrice: 45000,
    originalPrice: null,
    rawCategory: '여성 > 아우터 > 패딩',
  };
}

function makeStatus(siteId: SiteId, overrides: Partial<SiteStatus> = {}): SiteStatus {
  return {
    siteId,
    enabled: true,
    state: 'ok',
    lastRunAt: CRAWLED_AT,
    lastSuccessAt: CRAWLED_AT,
    dealCount: 12,
    message: null,
    cooldownUntil: null,
    ...overrides,
  };
}

type StoreFolder = 'deals' | 'status' | 'raw';

function storedPath(folder: StoreFolder, siteId: SiteId): string {
  return path.join(dataDir, folder, `${siteId}.json`);
}

async function putFile(folder: StoreFolder, siteId: SiteId, content: string): Promise<void> {
  await mkdir(path.join(dataDir, folder), { recursive: true });
  await writeFile(storedPath(folder, siteId), content, 'utf8');
}

async function putJson(folder: StoreFolder, siteId: SiteId, value: unknown): Promise<void> {
  await putFile(folder, siteId, JSON.stringify(value));
}

describe('defaultStatus', () => {
  it('returns an enabled, never-run status with empty values', () => {
    expect(defaultStatus('29cm')).toEqual({
      siteId: '29cm',
      enabled: true,
      state: 'never_run',
      lastRunAt: null,
      lastSuccessAt: null,
      dealCount: 0,
      message: null,
      cooldownUntil: null,
    });
  });

  it('returns a new object on every call', () => {
    expect(defaultStatus('musinsa')).not.toBe(defaultStatus('musinsa'));
  });
});

describe('readDeals / writeDeals', () => {
  it('returns null when the deals file does not exist', async () => {
    await expect(readDeals('musinsa')).resolves.toBeNull();
  });

  it('reads back exactly what was written', async () => {
    const file = makeDealsFile('musinsa', ['1', '2']);

    await writeDeals(file);

    await expect(readDeals('musinsa')).resolves.toEqual(file);
  });

  it('creates the deals folder on demand and pretty-prints with a 1-space indent', async () => {
    await writeDeals(makeDealsFile('wconcept', ['1']));

    const text = await readFile(storedPath('deals', 'wconcept'), 'utf8');
    expect(text.startsWith('{\n "siteId": "wconcept",\n "crawledAt"')).toBe(true);
    expect(text).toContain('\n "deals": [\n  {\n   "id": "wconcept:1"');
  });

  it('stores only the DealsFile fields and does not mutate its input', async () => {
    const file = makeDealsFile('ably', ['1']);
    const snapshot = structuredClone(file);
    const withExtra = { ...file, debug: '저장되면 안 되는 값' };

    await writeDeals(withExtra);

    expect(file).toEqual(snapshot);
    const stored = JSON.parse(await readFile(storedPath('deals', 'ably'), 'utf8')) as object;
    expect(Object.keys(stored)).toEqual(['siteId', 'crawledAt', 'deals']);
  });

  it('throws a Korean error naming the file when the JSON is invalid', async () => {
    await putFile('deals', 'musinsa', '{ "siteId": "musinsa", "deals": [');

    const error = await readDeals('musinsa').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('deals/musinsa.json');
    expect((error as Error).message).toMatch(KOREAN);
  });

  it('throws when the file is empty', async () => {
    await putFile('deals', 'musinsa', '');

    await expect(readDeals('musinsa')).rejects.toThrow('deals/musinsa.json');
  });

  it.each<[string, unknown]>([
    ['is not an object', [1, 2, 3]],
    ['is null', null],
    ['belongs to another site', { siteId: '29cm', crawledAt: CRAWLED_AT, deals: [] }],
    ['has no crawledAt', { siteId: 'musinsa', deals: [] }],
    ['has deals that is not an array', { siteId: 'musinsa', crawledAt: CRAWLED_AT, deals: {} }],
    [
      'has a deal without a string id',
      { siteId: 'musinsa', crawledAt: CRAWLED_AT, deals: [{ ...makeDeal('musinsa', '1'), id: 7 }] },
    ],
    [
      'has a deal whose salePrice is not a number',
      {
        siteId: 'musinsa',
        crawledAt: CRAWLED_AT,
        deals: [{ ...makeDeal('musinsa', '1'), salePrice: '60000' }],
      },
    ],
    ['has a deal that is null', { siteId: 'musinsa', crawledAt: CRAWLED_AT, deals: [null] }],
  ])('throws a Korean error when the stored value %s', async (_label, stored) => {
    await putJson('deals', 'musinsa', stored);

    const error = await readDeals('musinsa').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('deals/musinsa.json');
    expect((error as Error).message).toMatch(KOREAN);
  });

  it('refuses to write a deals file that could not be read back and keeps the previous one', async () => {
    const good = makeDealsFile('musinsa', ['1']);
    await writeDeals(good);
    const broken: DealsFile = {
      siteId: 'musinsa',
      crawledAt: LATER_CRAWLED_AT,
      deals: [makeDeal('musinsa', '2', { salePrice: Number.NaN })],
    };

    await expect(writeDeals(broken)).rejects.toThrow(KOREAN);

    await expect(readDeals('musinsa')).resolves.toEqual(good);
  });

  it('rejects a site id that is not in SITE_IDS instead of building a path from it', async () => {
    const outsider = '../outside' as SiteId;

    await expect(readDeals(outsider)).rejects.toThrow(KOREAN);
    await expect(
      writeDeals({ siteId: outsider, crawledAt: CRAWLED_AT, deals: [] }),
    ).rejects.toThrow(KOREAN);
    await expect(readdir(dataDir)).resolves.toEqual([]);
  });
});

describe('atomic writes', () => {
  it('leaves only the target file in the folder after a write', async () => {
    await writeDeals(makeDealsFile('musinsa', ['1']));
    await writeDeals(makeDealsFile('musinsa', ['1', '2']));

    await expect(readdir(path.join(dataDir, 'deals'))).resolves.toEqual(['musinsa.json']);
  });

  it('replaces the whole target when written twice', async () => {
    const first = makeDealsFile('musinsa', ['1', '2', '3', '4', '5', '6']);
    const second: DealsFile = { ...makeDealsFile('musinsa', ['9']), crawledAt: LATER_CRAWLED_AT };

    await writeDeals(first);
    await writeDeals(second);

    const text = await readFile(storedPath('deals', 'musinsa'), 'utf8');
    expect(JSON.parse(text)).toEqual(second);
    await expect(readDeals('musinsa')).resolves.toEqual(second);
  });

  it('writes two different sites concurrently without mixing them up', async () => {
    const musinsa = makeDealsFile('musinsa', ['1', '2']);
    const zigzag = makeDealsFile('zigzag', ['7']);

    await Promise.all([writeDeals(musinsa), writeDeals(zigzag)]);

    await expect(readDeals('musinsa')).resolves.toEqual(musinsa);
    await expect(readDeals('zigzag')).resolves.toEqual(zigzag);
    const names = await readdir(path.join(dataDir, 'deals'));
    expect([...names].sort()).toEqual(['musinsa.json', 'zigzag.json']);
  });

  it('keeps the target valid when the same site is written many times at once', async () => {
    const versions = ['a', 'b', 'c', 'd', 'e'].map((productId) =>
      makeDealsFile('musinsa', [productId]),
    );

    await Promise.all(versions.map((version) => writeDeals(version)));

    const stored = await readDeals('musinsa');
    expect(versions).toContainEqual(stored);
    await expect(readdir(path.join(dataDir, 'deals'))).resolves.toEqual(['musinsa.json']);
  });

  it('retries the rename when Windows reports EPERM and then succeeds', async () => {
    const file = makeDealsFile('musinsa', ['1']);
    renameControl.failuresLeft = 2;

    await writeDeals(file);

    expect(renameControl.calls).toBe(3);
    await expect(readDeals('musinsa')).resolves.toEqual(file);
  });

  it('retries the rename on EBUSY as well', async () => {
    renameControl.failuresLeft = 1;
    renameControl.code = 'EBUSY';

    await writeStatus(makeStatus('naver'));

    expect(renameControl.calls).toBe(2);
    await expect(readStatus('naver')).resolves.toEqual(makeStatus('naver'));
  });

  it('gives up with a Korean error, keeps the old target and removes its temp file', async () => {
    const previous = makeDealsFile('musinsa', ['1']);
    await writeDeals(previous);
    renameControl.calls = 0;
    renameControl.failuresLeft = ALWAYS_FAIL;

    const error = await writeDeals(makeDealsFile('musinsa', ['2'])).catch(
      (caught: unknown) => caught,
    );
    renameControl.failuresLeft = 0;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('deals/musinsa.json');
    expect((error as Error).message).toMatch(KOREAN);
    expect(renameControl.calls).toBeGreaterThan(1);
    await expect(readDeals('musinsa')).resolves.toEqual(previous);
    await expect(readdir(path.join(dataDir, 'deals'))).resolves.toEqual(['musinsa.json']);
  });

  it('does not retry an error that will not go away by waiting', async () => {
    renameControl.failuresLeft = ALWAYS_FAIL;
    renameControl.code = 'ENOSPC';

    await expect(writeDeals(makeDealsFile('musinsa', ['1']))).rejects.toThrow(KOREAN);
    renameControl.failuresLeft = 0;

    expect(renameControl.calls).toBe(1);
    await expect(readdir(path.join(dataDir, 'deals'))).resolves.toEqual([]);
  });
});

describe('readStatus / writeStatus', () => {
  it('returns the default status when the file does not exist', async () => {
    await expect(readStatus('queenit')).resolves.toEqual(defaultStatus('queenit'));
  });

  it('reads back exactly what was written', async () => {
    const status = makeStatus('posty', {
      enabled: false,
      state: 'blocked',
      message: '차단 감지: captcha',
      cooldownUntil: '2026-11-28T03:00:00+09:00',
    });

    await writeStatus(status);

    await expect(readStatus('posty')).resolves.toEqual(status);
  });

  it('fills fields that an older status file did not have from the default status', async () => {
    await putJson('status', '4910', { siteId: '4910', enabled: false, state: 'failed' });

    await expect(readStatus('4910')).resolves.toEqual({
      ...defaultStatus('4910'),
      enabled: false,
      state: 'failed',
    });
  });

  it("reads a stored 'disabled' state back as 'never_run'", async () => {
    await putJson('status', 'ably', makeStatus('ably', { enabled: false, state: 'disabled' }));

    const status = await readStatus('ably');

    expect(status.state).toBe('never_run');
    expect(status.enabled).toBe(false);
  });

  it("never stores 'disabled' or the extra fields of a status view", async () => {
    const view: SiteStatusView = {
      ...makeStatus('zigzag', { enabled: false, state: 'disabled' }),
      displayName: '지그재그',
      run: 'idle',
    };

    await writeStatus(view);

    const stored = JSON.parse(await readFile(storedPath('status', 'zigzag'), 'utf8')) as {
      state: string;
    };
    expect(stored.state).toBe('never_run');
    expect(Object.keys(stored)).toEqual([
      'siteId',
      'enabled',
      'state',
      'lastRunAt',
      'lastSuccessAt',
      'dealCount',
      'message',
      'cooldownUntil',
    ]);
    expect(view.state).toBe('disabled');
  });

  it('tolerates a UTF-8 BOM left by a text editor', async () => {
    const status = makeStatus('naver', { enabled: false });
    await putFile('status', 'naver', `﻿${JSON.stringify(status)}`);

    await expect(readStatus('naver')).resolves.toEqual(status);
  });

  it('throws a Korean error naming the file when the JSON is invalid', async () => {
    await putFile('status', 'musinsa', 'not json at all');

    const error = await readStatus('musinsa').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('status/musinsa.json');
    expect((error as Error).message).toMatch(KOREAN);
  });

  it.each<[string, unknown]>([
    ['is not an object', 'ok'],
    ['belongs to another site', makeStatus('29cm')],
    ['has an unknown state', { ...makeStatus('musinsa'), state: 'sleeping' }],
    ['has no state', { siteId: 'musinsa', enabled: true }],
    ['has a non-boolean enabled', { ...makeStatus('musinsa'), enabled: 'yes' }],
    ['has a non-numeric dealCount', { ...makeStatus('musinsa'), dealCount: '12' }],
    ['has a negative dealCount', { ...makeStatus('musinsa'), dealCount: -1 }],
    ['has a non-string message', { ...makeStatus('musinsa'), message: 404 }],
    ['has a non-string cooldownUntil', { ...makeStatus('musinsa'), cooldownUntil: 1764255600000 }],
  ])('throws a Korean error when the stored value %s', async (_label, stored) => {
    await putJson('status', 'musinsa', stored);

    const error = await readStatus('musinsa').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('status/musinsa.json');
    expect((error as Error).message).toMatch(KOREAN);
  });

  it('refuses to write a status with an invalid state', async () => {
    const broken = { ...makeStatus('musinsa'), state: 'sleeping' } as unknown as SiteStatus;

    await expect(writeStatus(broken)).rejects.toThrow(KOREAN);

    await expect(readStatus('musinsa')).resolves.toEqual(defaultStatus('musinsa'));
  });
});

describe('readAllStatuses', () => {
  it('returns every site in SITE_IDS order, with defaults for missing files', async () => {
    const zigzag = makeStatus('zigzag', { state: 'suspect_layout', dealCount: 0 });
    const musinsa = makeStatus('musinsa');
    await writeStatus(zigzag);
    await writeStatus(musinsa);

    const statuses = await readAllStatuses();

    expect(statuses.map((status) => status.siteId)).toEqual([...SITE_IDS]);
    expect(statuses).toHaveLength(SITE_IDS.length);
    expect(statuses[SITE_IDS.indexOf('musinsa')]).toEqual(musinsa);
    expect(statuses[SITE_IDS.indexOf('zigzag')]).toEqual(zigzag);
    expect(statuses[SITE_IDS.indexOf('29cm')]).toEqual(defaultStatus('29cm'));
  });
});

describe('readRaw / writeRaw', () => {
  it('returns null when the raw file does not exist', async () => {
    await expect(readRaw('musinsa')).resolves.toBeNull();
  });

  it('reads back exactly what was written', async () => {
    const file: RawFile = {
      siteId: 'musinsa',
      crawledAt: CRAWLED_AT,
      deals: [makeRawDeal('1'), makeRawDeal('2')],
    };

    await writeRaw(file);

    await expect(readRaw('musinsa')).resolves.toEqual(file);
    await expect(readdir(path.join(dataDir, 'raw'))).resolves.toEqual(['musinsa.json']);
  });

  it('throws a Korean error naming the file when the JSON is invalid', async () => {
    await putFile('raw', '29cm', '{"siteId":"29cm","deals":[}');

    const error = await readRaw('29cm').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('raw/29cm.json');
    expect((error as Error).message).toMatch(KOREAN);
  });

  it.each<[string, unknown]>([
    ['belongs to another site', { siteId: 'musinsa', crawledAt: CRAWLED_AT, deals: [] }],
    ['has deals that is not an array', { siteId: '29cm', crawledAt: CRAWLED_AT, deals: 'none' }],
    ['has no crawledAt', { siteId: '29cm', deals: [] }],
    ['has a deal that is not an object', { siteId: '29cm', crawledAt: CRAWLED_AT, deals: ['x'] }],
  ])('throws a Korean error when the stored value %s', async (_label, stored) => {
    await putJson('raw', '29cm', stored);

    const error = await readRaw('29cm').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('raw/29cm.json');
    expect((error as Error).message).toMatch(KOREAN);
  });
});

describe('readAllDeals', () => {
  it('returns no deals and no problems when nothing has been crawled', async () => {
    await expect(readAllDeals()).resolves.toEqual({ deals: [], problems: [] });
  });

  it('concatenates the deals of every site in SITE_IDS order', async () => {
    await writeDeals(makeDealsFile('zigzag', ['z1']));
    await writeDeals(makeDealsFile('musinsa', ['m1', 'm2']));
    await writeDeals(makeDealsFile('29cm', ['c1']));

    const result = await readAllDeals();

    expect(result.deals.map((deal) => deal.id)).toEqual([
      'musinsa:m1',
      'musinsa:m2',
      '29cm:c1',
      'zigzag:z1',
    ]);
    expect(result.problems).toEqual([]);
  });

  it('skips a corrupt site file and describes it in one Korean sentence', async () => {
    await writeDeals(makeDealsFile('musinsa', ['m1']));
    await putFile('deals', '29cm', '{ broken');
    await writeDeals(makeDealsFile('wconcept', ['w1']));

    const result = await readAllDeals();

    expect(result.deals.map((deal) => deal.id)).toEqual(['musinsa:m1', 'wconcept:w1']);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('deals/29cm.json');
    expect(result.problems[0]).toMatch(KOREAN);
  });

  it('reports every unreadable site separately', async () => {
    await putFile('deals', 'musinsa', '');
    await putJson('deals', 'ably', { siteId: 'ably', crawledAt: CRAWLED_AT, deals: 'none' });
    await writeDeals(makeDealsFile('posty', ['p1']));

    const result = await readAllDeals();

    expect(result.deals.map((deal) => deal.id)).toEqual(['posty:p1']);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain('deals/musinsa.json');
    expect(result.problems[1]).toContain('deals/ably.json');
  });
});

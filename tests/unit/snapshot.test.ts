import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Deal, SiteId, SiteStatus } from '@/lib/types';
import { buildSnapshot, exportSnapshot, formatSnapshotFile, parseArgs } from '@/crawler/snapshot';
import { SNAPSHOT_PUBLIC_PATH, parseSnapshot } from '@/lib/snapshot';
import { defaultStatus, writeDeals, writeStatus } from '@/lib/store';

const NOW = new Date('2026-11-28T09:30:00+09:00');
const CRAWLED_AT = '2026-11-28T08:00:00+09:00';

function deal(siteId: SiteId, productId: string, over: Partial<Deal> = {}): Deal {
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
    endsAt: '2026-11-30T23:59:00+09:00',
    endsAtSource: 'product',
    eventName: null,
    eventUrl: null,
    gender: 'women',
    theme: 'outer',
    soldOut: false,
    crawledAt: CRAWLED_AT,
    ...over,
  };
}

function status(siteId: SiteId, lastSuccessAt: string | null, dealCount = 0): SiteStatus {
  return { ...defaultStatus(siteId), state: lastSuccessAt ? 'ok' : 'never_run', lastSuccessAt, dealCount };
}

describe('buildSnapshot', () => {
  it('내보낸 시각과 마지막 수집 성공 시각을 +09:00 형식으로 담는다', () => {
    const snapshot = buildSnapshot(
      [deal('musinsa', '1')],
      [status('musinsa', '2026-11-28T08:00:00+09:00'), status('29cm', '2026-11-28T08:57:00+09:00')],
      NOW,
    );
    expect(snapshot.exportedAt).toBe('2026-11-28T09:30:00+09:00');
    expect(snapshot.lastUpdatedAt).toBe('2026-11-28T08:57:00+09:00');
  });

  it('성공한 수집이 없으면 마지막 업데이트는 모른다 (null)', () => {
    expect(buildSnapshot([deal('musinsa', '1')], [status('musinsa', null)], NOW).lastUpdatedAt).toBeNull();
  });

  it('id 순으로 정렬해 내보낼 때마다 같은 순서가 나오게 한다', () => {
    const snapshot = buildSnapshot([deal('musinsa', '2'), deal('29cm', '9'), deal('musinsa', '1')], [], NOW);
    expect(snapshot.deals.map((item) => item.id)).toEqual(['29cm:9', 'musinsa:1', 'musinsa:2']);
  });

  it('받은 배열을 바꾸지 않는다', () => {
    const input = [deal('musinsa', '2'), deal('musinsa', '1')];
    buildSnapshot(input, [], NOW);
    expect(input.map((item) => item.id)).toEqual(['musinsa:2', 'musinsa:1']);
  });
});

describe('formatSnapshotFile', () => {
  it('할인 하나를 한 줄에 쓴다 (git에서 바뀐 상품만 보이도록)', () => {
    const text = formatSnapshotFile(buildSnapshot([deal('musinsa', '1'), deal('musinsa', '2')], [], NOW));
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"id":"musinsa:1"');
    expect(lines[2]).toContain('"id":"musinsa:2"');
  });

  it('다시 읽으면 같은 스냅샷이 된다', () => {
    const snapshot = buildSnapshot([deal('musinsa', '1'), deal('29cm', '2', { brand: null })], [], NOW);
    expect(parseSnapshot(JSON.parse(formatSnapshotFile(snapshot)))).toEqual(snapshot);
  });

  it('할인이 없어도 올바른 JSON이다', () => {
    const snapshot = buildSnapshot([], [], NOW);
    expect(parseSnapshot(JSON.parse(formatSnapshotFile(snapshot)))).toEqual(snapshot);
  });
});

describe('parseSnapshot', () => {
  const valid = { exportedAt: '2026-11-28T09:30:00+09:00', lastUpdatedAt: null, deals: [deal('musinsa', '1')] };

  it('올바른 스냅샷을 그대로 돌려준다', () => {
    expect(parseSnapshot(valid)).toEqual(valid);
  });

  it('배포판이 읽는 주소는 /snapshot/deals.json', () => {
    expect(SNAPSHOT_PUBLIC_PATH).toBe('/snapshot/deals.json');
  });

  it.each([
    ['null', null],
    ['문자열', 'deals'],
    ['배열', [deal('musinsa', '1')]],
    ['deals 없음', { exportedAt: valid.exportedAt, lastUpdatedAt: null }],
    ['deals가 배열이 아님', { ...valid, deals: {} }],
    ['exportedAt 없음', { lastUpdatedAt: null, deals: [] }],
  ])('모양이 틀리면 오류: %s', (_label, raw) => {
    expect(() => parseSnapshot(raw)).toThrow();
  });

  it.each([
    ['id 없음', { ...deal('musinsa', '1'), id: undefined }],
    ['모르는 사이트', { ...deal('musinsa', '1'), siteId: 'unknown-shop' }],
    ['할인가가 숫자가 아님', { ...deal('musinsa', '1'), salePrice: '60,000원' }],
    ['주소가 http(s)가 아님', { ...deal('musinsa', '1'), url: 'javascript:alert(1)' }],
    ['이미지 주소가 http(s)가 아님', { ...deal('musinsa', '1'), imageUrl: 'javascript:alert(1)' }],
    ['정가가 숫자도 null도 아님', { ...deal('musinsa', '1'), originalPrice: '100,000원' }],
    ['할인율이 숫자도 null도 아님', { ...deal('musinsa', '1'), discountRate: '40%' }],
    ['품절 여부가 참/거짓이 아님', { ...deal('musinsa', '1'), soldOut: 'no' }],
    ['브랜드가 문자열도 null도 아님', { ...deal('musinsa', '1'), brand: 42 }],
    ['종료 시각이 문자열도 null도 아님', { ...deal('musinsa', '1'), endsAt: 20261130 }],
    ['할인 항목이 객체가 아님', 'musinsa:1'],
  ])('할인 항목이 틀리면 오류: %s', (_label, badDeal) => {
    expect(() => parseSnapshot({ ...valid, deals: [badDeal] })).toThrow();
  });

  it('마지막 업데이트 시각을 읽을 수 없으면 모르는 것으로 둔다 (null)', () => {
    expect(parseSnapshot({ ...valid, lastUpdatedAt: 12345 }).lastUpdatedAt).toBeNull();
    expect(parseSnapshot({ ...valid, lastUpdatedAt: undefined }).lastUpdatedAt).toBeNull();
  });
});

describe('exportSnapshot (data/ → 스냅샷 파일)', () => {
  let dataDir = '';
  let outDir = '';
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    previousDataDir = process.env.BF_DATA_DIR;
    dataDir = await mkdtemp(path.join(tmpdir(), 'bf-snapshot-data-'));
    outDir = await mkdtemp(path.join(tmpdir(), 'bf-snapshot-out-'));
    process.env.BF_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.BF_DATA_DIR;
    else process.env.BF_DATA_DIR = previousDataDir;
  });

  async function seed(): Promise<void> {
    await writeDeals({ siteId: 'musinsa', crawledAt: CRAWLED_AT, deals: [deal('musinsa', '1'), deal('musinsa', '2')] });
    await writeDeals({ siteId: '29cm', crawledAt: CRAWLED_AT, deals: [deal('29cm', '7')] });
    await writeStatus(status('musinsa', '2026-11-28T08:00:00+09:00', 2));
    await writeStatus(status('29cm', '2026-11-28T08:01:00+09:00', 1));
  }

  it('수집된 모든 사이트의 할인을 파일 하나로 쓴다 (폴더가 없으면 만든다)', async () => {
    await seed();
    const outFile = path.join(outDir, 'public', 'snapshot', 'deals.json');

    const result = await exportSnapshot({ outFile, now: NOW });

    const snapshot = parseSnapshot(JSON.parse(await readFile(outFile, 'utf8')));
    expect(snapshot.deals.map((item) => item.id)).toEqual(['29cm:7', 'musinsa:1', 'musinsa:2']);
    expect(snapshot.lastUpdatedAt).toBe('2026-11-28T08:01:00+09:00');
    expect(snapshot.exportedAt).toBe('2026-11-28T09:30:00+09:00');
    expect(result.dealCount).toBe(3);
    expect(result.siteCounts).toEqual({ musinsa: 2, '29cm': 1 });
    expect(result.lastUpdatedAt).toBe('2026-11-28T08:01:00+09:00');
    expect(result.problems).toEqual([]);
  });

  it('수집된 할인이 하나도 없으면 쓰지 않고 오류를 낸다 (빈 목록을 공개하지 않는다)', async () => {
    const outFile = path.join(outDir, 'deals.json');
    await writeFile(outFile, 'previous', 'utf8');

    await expect(exportSnapshot({ outFile, now: NOW })).rejects.toThrow(/[가-힣]/);

    expect(await readFile(outFile, 'utf8')).toBe('previous');
  });

  it('읽을 수 없는 사이트가 있으면 쓰지 않고 오류를 낸다 (공개된 목록에서 그 사이트가 통째로 빠지지 않게)', async () => {
    await seed();
    await writeFile(path.join(dataDir, 'deals', '29cm.json'), '{ broken', 'utf8');
    const outFile = path.join(outDir, 'deals.json');
    await writeFile(outFile, 'previous', 'utf8');

    await expect(exportSnapshot({ outFile, now: NOW })).rejects.toThrow(/29cm/);

    expect(await readFile(outFile, 'utf8')).toBe('previous');
  });

  it('allowPartial이면 읽을 수 없는 사이트를 빼고 쓰되 무엇을 뺐는지 알려 준다', async () => {
    await seed();
    await writeFile(path.join(dataDir, 'deals', '29cm.json'), '{ broken', 'utf8');
    const outFile = path.join(outDir, 'deals.json');

    const result = await exportSnapshot({ outFile, now: NOW, allowPartial: true });

    expect(result.siteCounts).toEqual({ musinsa: 2 });
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('29cm');
  });

  it('쓰고 난 뒤 임시 파일을 남기지 않는다', async () => {
    await seed();
    const outFile = path.join(outDir, 'deals.json');

    await exportSnapshot({ outFile, now: NOW });

    expect((await readdir(outDir)).sort()).toEqual(['deals.json']);
  });

  it('파일을 쓸 수 없으면 오류를 내고 임시 파일을 남기지 않는다', async () => {
    await seed();
    // 쓰려는 자리에 폴더가 있으면 바꿔치기가 실패한다.
    const outFile = path.join(outDir, 'blocked');
    await mkdir(path.join(outFile, 'inner'), { recursive: true });

    await expect(exportSnapshot({ outFile, now: NOW })).rejects.toThrow();

    expect((await readdir(outDir)).sort()).toEqual(['blocked']);
  });
});

describe('parseArgs (npm run snapshot -- …)', () => {
  it('옵션이 없으면 일부만 내보내기를 허용하지 않는다', () => {
    expect(parseArgs([])).toEqual({ allowPartial: false });
  });

  it('--allow-partial을 알아듣는다', () => {
    expect(parseArgs(['--allow-partial'])).toEqual({ allowPartial: true });
  });

  it('모르는 옵션은 null (사용법을 보여 준다)', () => {
    expect(parseArgs(['--force'])).toBeNull();
  });
});

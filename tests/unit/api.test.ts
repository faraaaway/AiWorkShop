import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@/lib/types';

const { sampleDeals } = vi.hoisted(() => {
  const base = {
    siteId: 'musinsa',
    brand: '브랜드',
    url: 'https://www.musinsa.com/products/1',
    imageUrl: null,
    originalPrice: 100000,
    salePrice: 60000,
    discountRate: 40,
    displayedDiscountRate: 40,
    endsAtSource: 'product',
    eventName: null,
    eventUrl: null,
    gender: 'men',
    theme: 'outer',
    soldOut: false,
  };
  return {
    sampleDeals: [
      {
        ...base,
        id: 'musinsa:expired',
        name: '이미 끝난 할인',
        endsAt: '2026-11-26T23:59:00+09:00',
        crawledAt: '2026-11-27T09:00:00+09:00',
      },
      {
        ...base,
        id: 'musinsa:active',
        name: '진행 중인 할인',
        endsAt: '2026-11-30T23:59:00+09:00',
        crawledAt: '2026-11-27T21:00:00+09:00',
      },
      {
        ...base,
        id: 'musinsa:no-end',
        name: '종료 시각을 모르는 할인',
        endsAt: null,
        endsAtSource: null,
        crawledAt: '2026-11-27T12:00:00+09:00',
      },
    ],
  };
});

vi.mock('../../fixtures/sample-deals.json', () => ({ default: sampleDeals }));

import {
  ApiError,
  USE_SAMPLE_DATA,
  getDeals,
  getStatus,
  setSiteEnabled,
  startCrawl,
} from '@/lib/api';

const NOW = new Date('2026-11-27T22:00:00+09:00');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function idsOf(deals: readonly Deal[]): string[] {
  return deals.map((deal) => deal.id);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.runIf(USE_SAMPLE_DATA)('getDeals (sample mode)', () => {
  it('removes deals whose endsAt is before the injected now', async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true, data: null }));

    const result = await getDeals({ now: NOW });

    expect(idsOf(result.deals)).toEqual(['musinsa:active', 'musinsa:no-end']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps expired deals when includeExpired is set', async () => {
    const result = await getDeals({ now: NOW, includeExpired: true });

    expect(idsOf(result.deals)).toEqual(['musinsa:expired', 'musinsa:active', 'musinsa:no-end']);
  });

  it('treats a deal as expired only once now has passed its endsAt', async () => {
    const beforeEnd = new Date('2026-11-26T23:58:59+09:00');

    const result = await getDeals({ now: beforeEnd });

    expect(idsOf(result.deals)).toContain('musinsa:expired');
  });

  it('sets lastUpdatedAt to the latest crawledAt', async () => {
    const result = await getDeals({ now: NOW });

    expect(result.lastUpdatedAt).toBe('2026-11-27T21:00:00+09:00');
  });

  it('does not hand out the fixture array itself', async () => {
    const first = await getDeals({ now: NOW, includeExpired: true });
    const second = await getDeals({ now: NOW, includeExpired: true });

    expect(first.deals).not.toBe(second.deals);
    expect(first.deals).toEqual(second.deals);
  });
});

describe.runIf(!USE_SAMPLE_DATA)('getDeals (live mode)', () => {
  it('requests GET /api/deals', async () => {
    const data = { deals: [], lastUpdatedAt: null };
    const fetchMock = stubFetch(jsonResponse({ ok: true, data }));

    const result = await getDeals();

    expect(result).toEqual(data);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/deals');
  });

  it('appends includeExpired=1 when requested', async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true, data: { deals: [], lastUpdatedAt: null } }));

    await getDeals({ includeExpired: true });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/deals?includeExpired=1');
  });
});

describe('getStatus', () => {
  it('requests GET /api/status and returns the data payload', async () => {
    const data = { sites: [] };
    const fetchMock = stubFetch(jsonResponse({ ok: true, data }));

    const result = await getStatus();

    expect(result).toEqual(data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/status');
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });
});

describe('startCrawl', () => {
  it('sends POST /api/crawl with siteId and force in a JSON body', async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true, data: { started: ['musinsa'] } }, 202));

    const result = await startCrawl('musinsa', { force: true });

    expect(result).toEqual({ started: ['musinsa'] });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/crawl');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ siteId: 'musinsa', force: true });
  });

  it('defaults force to false and accepts "all"', async () => {
    const fetchMock = stubFetch(jsonResponse({ ok: true, data: { started: [] } }, 202));

    await startCrawl('all');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ siteId: 'all', force: false });
  });
});

describe('setSiteEnabled', () => {
  it('sends PATCH /api/status/<siteId> with the enabled flag', async () => {
    const site = { siteId: '29cm', displayName: '29CM', enabled: false };
    const fetchMock = stubFetch(jsonResponse({ ok: true, data: site }));

    const result = await setSiteEnabled('29cm', false);

    expect(result).toEqual(site);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/status/29cm');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ enabled: false });
  });
});

describe('error handling', () => {
  it('rejects with the server message when the body says ok: false', async () => {
    const message = '무신사 수집이 이미 진행 중입니다';
    stubFetch(jsonResponse({ ok: false, error: message }, 409));

    const error: unknown = await startCrawl('musinsa').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'ApiError', message, status: 409 });
  });

  it('rejects with a friendly message when the body is not JSON', async () => {
    stubFetch(new Response('<html>Internal Server Error</html>', { status: 500 }));

    const error: unknown = await getStatus().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500 });
    expect((error as ApiError).message).toContain('서버 응답을 읽지 못했습니다');
    expect((error as ApiError).message).not.toContain('JSON');
  });

  it('rejects with a friendly message when the JSON is not an API envelope', async () => {
    stubFetch(jsonResponse({ sites: [] }));

    await expect(getStatus()).rejects.toThrow('서버 응답을 읽지 못했습니다');
  });

  it('rejects when the HTTP status is not 2xx even if the body says ok: true', async () => {
    stubFetch(jsonResponse({ ok: true, data: { sites: [] } }, 500));

    const error: unknown = await getStatus().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500 });
  });

  it('rejects with a friendly message when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error: unknown = await getStatus().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0 });
    expect((error as ApiError).message).toContain('서버에 연결하지 못했습니다');
  });
});

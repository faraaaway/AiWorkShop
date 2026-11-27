import { describe, expect, it } from 'vitest';

import { ADAPTERS, getAdapter, listAdapters } from '@/crawler/adapters';
import { getCrawlErrorKind } from '@/lib/errors';
import { SITE_IDS } from '@/lib/types';
import type { CrawlContext, SiteId } from '@/lib/types';

import { createFakeContext } from '../helpers/fakeContext';

const EXPECTED_DISPLAY_NAMES: Readonly<Record<SiteId, string>> = {
  musinsa: '무신사',
  '29cm': '29CM',
  wconcept: 'W컨셉',
  naver: '네이버쇼핑',
  zigzag: '지그재그',
  ably: '에이블리',
  queenit: '퀸잇',
  posty: '포스티',
  '4910': '4910',
};

const EXPECTED_HOME_URLS: Readonly<Record<SiteId, string>> = {
  musinsa: 'https://www.musinsa.com',
  '29cm': 'https://www.29cm.co.kr',
  wconcept: 'https://www.wconcept.co.kr',
  naver: 'https://shopping.naver.com',
  zigzag: 'https://zigzag.kr',
  ably: 'https://m.a-bly.com',
  queenit: 'https://web.queenit.kr',
  posty: 'https://posty.kr',
  '4910': 'https://4910.kr',
};

/** No handlers given, so any network call from a stub fails the test. */
function createUnusedContext(): CrawlContext {
  return createFakeContext();
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('adapter registry', () => {
  it('registers exactly the 9 site ids', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([...SITE_IDS].sort());
    expect(SITE_IDS).toHaveLength(9);
  });

  it.each(SITE_IDS)('registers %s under its own id', (id) => {
    expect(ADAPTERS[id].id).toBe(id);
    expect(getAdapter(id)).toBe(ADAPTERS[id]);
  });

  it('lists adapters in SITE_IDS order', () => {
    expect(listAdapters().map((adapter) => adapter.id)).toEqual([...SITE_IDS]);
  });

  it('returns a fresh array from listAdapters so callers cannot change the registry', () => {
    const first = listAdapters();
    first.pop();

    expect(listAdapters()).toHaveLength(SITE_IDS.length);
  });

  it('does not allow replacing a registered adapter', () => {
    expect(Object.isFrozen(ADAPTERS)).toBe(true);
  });
});

/**
 * Sites whose real adapter has been merged. Core adds an id here when merging an adapter branch;
 * every other site must still be the untouched stub.
 */
const IMPLEMENTED_SITE_IDS: readonly SiteId[] = ['musinsa'];
const STUB_SITE_IDS: readonly SiteId[] = SITE_IDS.filter((id) => !IMPLEMENTED_SITE_IDS.includes(id));
const MAX_REQUESTS_CEILING = 30;

describe('every adapter', () => {
  it.each(SITE_IDS)('%s has the agreed display name and home url', (id) => {
    const adapter = getAdapter(id);

    expect(adapter.displayName).toBe(EXPECTED_DISPLAY_NAMES[id]);
    expect(adapter.homeUrl).toBe(EXPECTED_HOME_URLS[id]);
  });

  it.each(SITE_IDS)('%s obeys robots.txt and stays within the request ceiling', (id) => {
    const adapter = getAdapter(id);

    expect(adapter.obeyRobots).toBe(true);
    expect(adapter.maxRequests).toBeGreaterThan(0);
    expect(adapter.maxRequests).toBeLessThanOrEqual(MAX_REQUESTS_CEILING);
  });
});

describe('adapter stubs', () => {
  it.each(STUB_SITE_IDS)('%s uses the default crawl settings', (id) => {
    const adapter = getAdapter(id);

    expect(adapter.stealth).toBe(true);
    expect(adapter.maxRequests).toBe(MAX_REQUESTS_CEILING);
  });

  it.each(STUB_SITE_IDS)('%s crawl rejects with a not_implemented error', async (id) => {
    const adapter = getAdapter(id);

    const error = await captureRejection(adapter.crawl(createUnusedContext()));

    expect(getCrawlErrorKind(error)).toBe('not_implemented');
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(id);
  });
});

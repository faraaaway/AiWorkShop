/**
 * 에이블리 adapter — stub.
 * Owner: Crawl B. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const ably: SiteAdapter = {
  id: 'ably',
  displayName: '에이블리',
  homeUrl: 'https://m.a-bly.com',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('ably');
  },
};

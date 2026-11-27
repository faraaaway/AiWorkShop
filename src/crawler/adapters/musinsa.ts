/**
 * 무신사 adapter — stub.
 * Owner: Crawl A. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const musinsa: SiteAdapter = {
  id: 'musinsa',
  displayName: '무신사',
  homeUrl: 'https://www.musinsa.com',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('musinsa');
  },
};

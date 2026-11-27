/**
 * 29CM adapter — stub.
 * Owner: Crawl A. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const site29cm: SiteAdapter = {
  id: '29cm',
  displayName: '29CM',
  homeUrl: 'https://www.29cm.co.kr',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('29cm');
  },
};

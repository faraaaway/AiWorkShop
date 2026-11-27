/**
 * 4910 adapter — stub.
 * Owner: Crawl B. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const site4910: SiteAdapter = {
  id: '4910',
  displayName: '4910',
  homeUrl: 'https://4910.kr',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('4910');
  },
};

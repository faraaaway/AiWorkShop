/**
 * 포스티 adapter — stub.
 * Owner: Crawl B. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const posty: SiteAdapter = {
  id: 'posty',
  displayName: '포스티',
  homeUrl: 'https://posty.kr',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('posty');
  },
};

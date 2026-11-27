/**
 * W컨셉 adapter — stub.
 * Owner: Crawl A. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const wconcept: SiteAdapter = {
  id: 'wconcept',
  displayName: 'W컨셉',
  homeUrl: 'https://www.wconcept.co.kr',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('wconcept');
  },
};

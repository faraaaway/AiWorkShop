/**
 * 퀸잇 adapter — stub.
 * Owner: Crawl B. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const queenit: SiteAdapter = {
  id: 'queenit',
  displayName: '퀸잇',
  homeUrl: 'https://web.queenit.kr',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('queenit');
  },
};

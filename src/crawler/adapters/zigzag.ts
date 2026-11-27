/**
 * 지그재그 adapter — stub.
 * Owner: Crawl B. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const zigzag: SiteAdapter = {
  id: 'zigzag',
  displayName: '지그재그',
  homeUrl: 'https://zigzag.kr',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('zigzag');
  },
};

/**
 * 네이버쇼핑 adapter — stub.
 * Owner: Crawl A. Replace the body of `crawl` per
 * specs/001-bf-deal-tracker/contracts/adapter-interface.md.
 */
import { NotImplementedError } from '@/lib/errors';
import type { RawDeal, SiteAdapter } from '@/lib/types';

export const naver: SiteAdapter = {
  id: 'naver',
  displayName: '네이버쇼핑',
  homeUrl: 'https://shopping.naver.com',
  stealth: true,
  obeyRobots: true,
  maxRequests: 30,
  async crawl(): Promise<RawDeal[]> {
    throw new NotImplementedError('naver');
  },
};

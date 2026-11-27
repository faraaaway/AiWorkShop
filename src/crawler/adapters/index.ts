/**
 * Adapter registry: every site id maps to exactly one SiteAdapter.
 * Only the Core owner edits this file. Crawl A / Crawl B change the adapter
 * files next to it, never the registration here
 * (specs/001-bf-deal-tracker/contracts/adapter-interface.md).
 */
import { SITE_IDS } from '@/lib/types';
import type { SiteAdapter, SiteId } from '@/lib/types';

import { site29cm } from './29cm';
import { site4910 } from './4910';
import { ably } from './ably';
import { musinsa } from './musinsa';
import { naver } from './naver';
import { posty } from './posty';
import { queenit } from './queenit';
import { wconcept } from './wconcept';
import { zigzag } from './zigzag';

export const ADAPTERS: Readonly<Record<SiteId, SiteAdapter>> = Object.freeze({
  musinsa,
  '29cm': site29cm,
  wconcept,
  naver,
  zigzag,
  ably,
  queenit,
  posty,
  '4910': site4910,
});

export function getAdapter(id: SiteId): SiteAdapter {
  return ADAPTERS[id];
}

/** All adapters in SITE_IDS order (the order the status screen shows them). */
export function listAdapters(): SiteAdapter[] {
  return SITE_IDS.map((id) => ADAPTERS[id]);
}

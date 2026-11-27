/**
 * RawDeal (what an adapter read from a site) -> Deal (what is stored and displayed).
 * Rules: specs/001-bf-deal-tracker/data-model.md "Deal".
 *
 * Adapter output is treated as untrusted data: every field is checked at runtime, an unusable
 * required field drops that one deal (null), an unusable optional field becomes null. Nothing is
 * guessed and nothing here throws on bad data, so one bad product never loses the rest of a crawl.
 */
import { classifyGender, classifyTheme } from '@/lib/classify';
import { toKstIso } from '@/lib/dates';
import { computeDiscountRate } from '@/lib/discount';
import type { Deal, EndsAtSource, IsoDateTime, RawDeal, SiteId } from '@/lib/types';

const ALLOWED_URL_PROTOCOLS: readonly string[] = ['http:', 'https:'];

interface ResolvedEnd {
  endsAt: IsoDateTime | null;
  endsAtSource: EndsAtSource | null;
}

interface ResolvedEvent {
  name: string | null;
  url: string | null;
  endsAt: IsoDateTime | null;
}

const NO_EVENT: ResolvedEvent = { name: null, url: null, endsAt: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed text, or null when the value is not a string or is blank. */
function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The trimmed URL when it is absolute http(s); null otherwise (relative, `//host`, other schemes). */
function cleanHttpUrl(value: unknown): string | null {
  const text = cleanText(value);
  if (text === null || !URL.canParse(text)) return null;
  return ALLOWED_URL_PROTOCOLS.includes(new URL(text).protocol) ? text : null;
}

/** Whole won, or null when the value is not a finite number or rounds to 0 or less. */
function cleanPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function cleanFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Only strings are read as instants: a bare number such as 20261130 would be a guess. */
function cleanInstant(value: unknown): IsoDateTime | null {
  const text = cleanText(value);
  return text === null ? null : toKstIso(text);
}

function resolveEvent(event: unknown): ResolvedEvent {
  if (!isRecord(event)) return NO_EVENT;
  return {
    name: cleanText(event.name),
    url: cleanHttpUrl(event.url),
    endsAt: cleanInstant(event.endsAt),
  };
}

/** Product end time first, then the event's; the source says which one was used. */
function resolveEnd(productEndsAt: unknown, eventEndsAt: IsoDateTime | null): ResolvedEnd {
  const fromProduct = cleanInstant(productEndsAt);
  if (fromProduct !== null) return { endsAt: fromProduct, endsAtSource: 'product' };
  if (eventEndsAt !== null) return { endsAt: eventEndsAt, endsAtSource: 'event' };
  return { endsAt: null, endsAtSource: null };
}

/**
 * Returns null (the deal is dropped) when siteProductId, name, url or salePrice is unusable.
 * `raw` is not modified.
 */
export function normalizeDeal(raw: RawDeal, siteId: SiteId, crawledAt: IsoDateTime): Deal | null {
  const fields: unknown = raw;
  if (!isRecord(fields)) return null;

  const siteProductId = cleanText(fields.siteProductId);
  const name = cleanText(fields.name);
  const url = cleanHttpUrl(fields.url);
  const salePrice = cleanPrice(fields.salePrice);
  if (siteProductId === null || name === null || url === null || salePrice === null) return null;

  const originalPrice = cleanPrice(fields.originalPrice);
  const displayedDiscountRate = cleanFiniteNumber(fields.displayedDiscountRate);
  const rawCategory = cleanText(fields.rawCategory);
  const event = resolveEvent(fields.event);
  const end = resolveEnd(fields.endsAt, event.endsAt);

  return {
    id: `${siteId}:${siteProductId}`,
    siteId,
    name,
    brand: cleanText(fields.brand),
    url,
    imageUrl: cleanHttpUrl(fields.imageUrl),
    originalPrice,
    salePrice,
    discountRate: computeDiscountRate(originalPrice, salePrice, displayedDiscountRate),
    displayedDiscountRate,
    endsAt: end.endsAt,
    endsAtSource: end.endsAtSource,
    eventName: event.name,
    eventUrl: event.url,
    gender: classifyGender(cleanText(fields.rawGender), rawCategory, name),
    theme: classifyTheme(rawCategory, name),
    soldOut: fields.soldOut === true,
    crawledAt,
  };
}

/** FR-012: lower salePrice wins; on a tie the one with an end time; otherwise the first seen stays. */
function shouldReplace(kept: Deal, candidate: Deal): boolean {
  if (candidate.salePrice !== kept.salePrice) return candidate.salePrice < kept.salePrice;
  return kept.endsAt === null && candidate.endsAt !== null;
}

/**
 * Normalizes every RawDeal, drops the unusable ones and keeps one Deal per id, in the order each id
 * was first seen. The input list and its items are not modified.
 */
export function normalizeDeals(
  raws: readonly RawDeal[],
  siteId: SiteId,
  crawledAt: IsoDateTime,
): Deal[] {
  if (!Array.isArray(raws)) return [];

  const byId = new Map<string, Deal>();
  for (const raw of raws) {
    const deal = normalizeDeal(raw, siteId, crawledAt);
    if (deal === null) continue;
    const kept = byId.get(deal.id);
    // Map.set on an existing key keeps its original position, so first-seen order is preserved.
    if (kept === undefined || shouldReplace(kept, deal)) byId.set(deal.id, deal);
  }
  return [...byId.values()];
}

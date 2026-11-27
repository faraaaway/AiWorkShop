import type { IsoDateTime } from '@/lib/types';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const KST_SUFFIX = '+09:00';

/**
 * Any absolute instant (Date, epoch milliseconds, or a string Date.parse understands such as
 * "2026-11-30T14:59:00Z") -> the project's canonical form `2026-11-30T23:59:00+09:00`.
 * Returns null when the value is not a valid instant.
 */
export function toKstIso(value: Date | number | string): IsoDateTime | null {
  const ms =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + KST_OFFSET_MS);
  return `${shifted.toISOString().slice(0, 19)}${KST_SUFFIX}`;
}

/**
 * Korean sale-end wording -> IsoDateTime, e.g. "~11.30(일) 23:59", "11/30까지", "D-2", "오늘 마감".
 * Returns null when the text cannot be understood (never guess).
 *
 * NOTE: the signature is fixed; the parsing rules land with task T015. Until then this returns
 * null for every input, which adapters must already handle.
 */
export function parseKoreanEndDate(text: string, now: Date): IsoDateTime | null {
  void text;
  void now;
  return null;
}

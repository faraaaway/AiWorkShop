/**
 * Discount rate rules (data-model.md `Deal.discountRate` / `Deal.displayedDiscountRate`, spec FR-009).
 * Pure functions: unknown stays `null`, nothing is estimated (constitution III).
 */

/** Lowest whole percent a deal may carry. */
const MIN_DISCOUNT_RATE = 0;
/** Highest whole percent a deal may carry; 100% (free) or more is treated as a read error. */
const MAX_DISCOUNT_RATE = 99;
const PERCENT_SCALE = 100;
/** The site's displayed rate is shown next to ours only when the gap is larger than this (%p). */
const DISPLAYED_RATE_TOLERANCE = 1;

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Floors to a whole percent; anything outside 0..99 (or not finite) is unknown. */
function toWholeRate(rate: number): number | null {
  if (!Number.isFinite(rate)) {
    return null;
  }
  const whole = Math.floor(rate);
  if (whole < MIN_DISCOUNT_RATE || whole > MAX_DISCOUNT_RATE) {
    return null;
  }
  // `Math.floor(-0)` is -0: return a plain 0 so callers never see negative zero.
  return whole === 0 ? 0 : whole;
}

/**
 * Whole-percent discount rate (0..99) or `null` when it cannot be known.
 * - Original price known (finite, > 0): `floor((original - sale) / original * 100)`. A result outside
 *   0..99 means the prices contradict each other, so it is `null` — the displayed rate is NOT used.
 * - Original price missing: the site's displayed rate, floored, when it is within 0..99.
 * - Sale price not a finite number > 0: `null`.
 */
export function computeDiscountRate(
  originalPrice: number | null | undefined,
  salePrice: number,
  displayedRate: number | null | undefined,
): number | null {
  if (!isPositiveFinite(salePrice)) {
    return null;
  }
  if (isPositiveFinite(originalPrice)) {
    // Multiply before dividing: `(100 - 71) / 100 * 100` is 28.999999999999996, which would floor to 28.
    return toWholeRate(((originalPrice - salePrice) * PERCENT_SCALE) / originalPrice);
  }
  if (typeof displayedRate !== 'number') {
    return null;
  }
  return toWholeRate(displayedRate);
}

/**
 * True only when both rates are finite numbers more than 1%p apart; the UI then shows the site's
 * displayed rate next to the computed one. A gap of exactly 1 (floor vs. the site's rounding) is not
 * a difference.
 */
export function isDisplayedRateDifferent(discountRate: number | null, displayedRate: number | null): boolean {
  if (typeof discountRate !== 'number' || typeof displayedRate !== 'number') {
    return false;
  }
  if (!Number.isFinite(discountRate) || !Number.isFinite(displayedRate)) {
    return false;
  }
  return Math.abs(discountRate - displayedRate) > DISPLAYED_RATE_TOLERANCE;
}

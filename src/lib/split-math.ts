// Pure money math for equal splits. Dependency-free so it is trivially testable.
//
// Why this exists: the old code computed one rounded share for everyone
// (round(total / n)), which loses or invents cents - EUR 10 / 3 became
// 3 x 3.33 = 9.99. Splits must always sum exactly to the cost amount.

/** Split an integer amount of cents into n shares that sum exactly to totalCents.
 *  The remainder is distributed one cent at a time to the first participants. */
export function computeEqualSharesCents(totalCents: number, n: number): number[] {
  if (!Number.isFinite(totalCents) || n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Split a EUR amount into n shares (2-decimal floats) that sum exactly to the amount. */
export function computeEqualShares(amountEur: number, n: number): number[] {
  const totalCents = Math.round(amountEur * 100);
  return computeEqualSharesCents(totalCents, n).map((c) => c / 100);
}

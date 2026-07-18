import { describe, expect, it } from "vitest";
import { computeEqualShares, computeEqualSharesCents } from "./split-math";

describe("computeEqualSharesCents", () => {
  it("splits evenly when divisible", () => {
    expect(computeEqualSharesCents(900, 3)).toEqual([300, 300, 300]);
  });

  it("distributes the remainder so shares sum to the total", () => {
    expect(computeEqualSharesCents(1000, 3)).toEqual([334, 333, 333]);
  });

  it("never loses a cent across many amounts and group sizes", () => {
    for (let total = 1; total <= 500; total++) {
      for (let n = 1; n <= 7; n++) {
        const shares = computeEqualSharesCents(total, n);
        expect(shares).toHaveLength(n);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it("returns [] for zero or negative participant counts", () => {
    expect(computeEqualSharesCents(1000, 0)).toEqual([]);
    expect(computeEqualSharesCents(1000, -2)).toEqual([]);
  });
});

describe("computeEqualShares (EUR)", () => {
  it("EUR 10 / 3 people sums back to exactly 10.00", () => {
    const shares = computeEqualShares(10, 3);
    expect(shares).toEqual([3.34, 3.33, 3.33]);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 100)).toBe(1000);
  });

  it("handles sub-cent float inputs by rounding the total first", () => {
    const shares = computeEqualShares(0.1 + 0.2, 2); // 0.30000000000000004
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(0.3, 10);
  });
});

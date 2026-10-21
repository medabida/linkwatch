import { describe, expect, it } from "vitest";
import { backoffDelay } from "./backoff.js";

describe("backoffDelay", () => {
  it("grows exponentially up to the cap", () => {
    const d = (n: number) => backoffDelay(n, { random: () => 1 });
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(d)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
  it("applies 50-100% jitter", () => {
    expect(backoffDelay(2, { random: () => 0 })).toBe(2000);
    expect(backoffDelay(2, { random: () => 0.999 })).toBeLessThanOrEqual(4000);
  });
  it("honours custom base and max", () => {
    expect(backoffDelay(10, { baseMs: 10, maxMs: 60, random: () => 1 })).toBe(60);
  });
});

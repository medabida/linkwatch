import { describe, expect, it } from "vitest";
import { bytes, dateTime, duration, ms, pct, toInputDateTime } from "./format.js";

describe("format helpers", () => {
  it("show a dash for missing values", () => {
    for (const f of [ms, pct, duration, bytes, dateTime]) {
      expect(f(null)).toBe("—");
      expect(f(undefined)).toBe("—");
    }
  });
  it("format numbers", () => {
    expect(ms(12.345)).toBe("12.3 ms");
    expect(pct(0.5)).toBe("0.50%");
    expect(duration(2500)).toBe("2.5s");
  });
  it("scale bytes through the units", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(999)).toBe("999 B");
    expect(bytes(1500)).toBe("1.5 KB");
    expect(bytes(25_000_000)).toBe("25.0 MB");
    expect(bytes(3e12)).toBe("3000.0 GB");
  });
  it("round-trips a timestamp through the datetime-local input format", () => {
    expect(toInputDateTime(undefined)).toBe("");
    const t = new Date(2026, 0, 5, 14, 30).getTime();
    expect(toInputDateTime(t)).toBe("2026-01-05T14:30");
  });
  it("formats dates in the browser's locale", () => {
    expect(dateTime(0)).toBe(new Date(0).toLocaleString());
  });
});

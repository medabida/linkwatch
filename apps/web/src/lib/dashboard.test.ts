import type { SeriesPoint, StatBlock } from "@linkwatch/shared";
import { describe, expect, it } from "vitest";
import { bucketGrid, changePct, heatColor, paramsFromUrl, pivot, relativeTime, targetName } from "./dashboard.js";

const block = (v: number): StatBlock => ({ avg: v, min: v - 1, max: v + 1, p50: v, p95: v + 0.5 });
const point = (key: string, t: number, v: number): SeriesPoint => ({ key, t, n: 1, ok: 1, failed: 0, metrics: { downloadBps: block(v) } });

describe("paramsFromUrl", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 30);
  it("defaults to the last 24 hours, rounded up to the minute", () => {
    const p = paramsFromUrl(new URLSearchParams(), now);
    expect(p).toMatchObject({ range: "24h", stat: "avg", compare: false });
    expect(p.to).toBe(Date.UTC(2026, 0, 1, 12, 1));
    expect(p.to - p.from).toBe(86_400_000);
  });

  it("reads presets, filters, stat and compare", () => {
    const p = paramsFromUrl(new URLSearchParams("range=7d&workerId=w1&site=lab&targets=3,x,5&stat=p95&compare=1"), now);
    expect(p).toMatchObject({ range: "7d", workerId: "w1", site: "lab", targetIds: [3, 5], stat: "p95", compare: true });
    expect(p.to - p.from).toBe(7 * 86_400_000);
  });

  it("accepts a valid custom range and falls back for invalid ones", () => {
    expect(paramsFromUrl(new URLSearchParams("range=custom&from=1000&to=5000"), now)).toMatchObject({
      range: "custom",
      from: 1000,
      to: 5000,
    });
    expect(paramsFromUrl(new URLSearchParams("range=custom&from=5000&to=1000"), now).range).toBe("24h");
    expect(paramsFromUrl(new URLSearchParams("range=bogus&stat=nope"), now)).toMatchObject({ range: "24h", stat: "avg" });
  });
});

describe("pivot", () => {
  const bucketMs = 600_000;
  const grid = bucketGrid(0, 3 * bucketMs, bucketMs, 0);

  it("builds a full grid with gaps for missing buckets", () => {
    expect(grid).toEqual([0, 600_000, 1_200_000, 1_800_000]);
    const rows = pivot({
      series: [point("1", 0, 100e6), point("1", 1_200_000, 300e6)],
      grid,
      bucketMs,
      tzOffsetMin: 0,
      metric: "downloadBps",
      stat: "avg",
      scale: 1e6,
    });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ "1": 100 });
    expect(rows[1]?.["1"]).toBeUndefined();
    expect(rows[2]).toMatchObject({ "1": 300 });
  });

  it("selects the statistic and keeps targets in separate columns", () => {
    const rows = pivot({
      series: [point("1", 0, 10), point("2", 0, 20)],
      grid,
      bucketMs,
      tzOffsetMin: 0,
      metric: "downloadBps",
      stat: "max",
    });
    expect(rows[0]).toMatchObject({ "1": 11, "2": 21 });
  });

  it("overlays a shifted period (compare mode) onto the same grid", () => {
    const rows = pivot({ series: [point("1", 0, 10)], grid, bucketMs, tzOffsetMin: 0, metric: "downloadBps", stat: "avg" });
    pivot({
      series: [point("1", -1_800_000 + 60_000, 7)],
      grid,
      bucketMs,
      tzOffsetMin: 0,
      metric: "downloadBps",
      stat: "avg",
      shiftMs: 1_800_000,
      suffix: ":prev",
      into: rows,
    });
    expect(rows[0]).toMatchObject({ "1": 10, "1:prev": 7 });
  });
});

describe("helpers", () => {
  it("computes percentage change safely", () => {
    expect(changePct(110, 100)).toBeCloseTo(10);
    expect(changePct(50, 100)).toBeCloseTo(-50);
    expect(changePct(null, 100)).toBeNull();
    expect(changePct(5, 0)).toBeNull();
  });

  it("disambiguates duplicate target labels with the worker name", () => {
    const all = [{ label: "VLAN 130" }, { label: "VLAN 130" }, { label: "VLAN 120" }];
    expect(targetName({ label: "VLAN 130", workerName: "w1" }, all)).toBe("VLAN 130 (w1)");
    expect(targetName({ label: "VLAN 120", workerName: "w1" }, all)).toBe("VLAN 120");
  });

  it("maps heat from red to green", () => {
    expect(heatColor(0, 0, 100)).toContain("hsl(0 ");
    expect(heatColor(100, 0, 100)).toContain("hsl(120 ");
    expect(heatColor(5, 5, 5)).toContain("hsl(120 ");
  });

  it("formats relative time", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime(1000, 31_000)).toBe("30s ago");
    expect(relativeTime(0, 3 * 3_600_000)).toBe("3 h ago");
  });
});

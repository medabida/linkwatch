import { describe, expect, it } from "vitest";
import {
  bucketStart,
  buildDashboard,
  type DashboardInput,
  type DashboardRow,
  finalAttempts,
  pickBucketMs,
  statBlock,
} from "./dashboard.js";

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 0, 10, 0, 0, 0);

let id = 0;
const row = (over: Partial<DashboardRow> = {}): DashboardRow => ({
  id: ++id,
  targetId: 1,
  targetLabel: "A",
  workerId: "w1",
  workerName: "Local",
  site: "default",
  bindValue: "eth0",
  attemptGroupId: `g${id}`,
  attemptNumber: 1,
  status: "ok",
  startedAt: T0,
  errorMessage: null,
  downloadBps: 100e6,
  uploadBps: 50e6,
  pingMs: 10,
  pingJitterMs: 1,
  pingLowMs: 8,
  pingHighMs: 14,
  packetLoss: 0,
  downloadLatencyIqmMs: 30,
  uploadLatencyIqmMs: 12,
  downloadBytes: 1000,
  uploadBytes: 500,
  serverName: "Sewan",
  serverLocation: "Brussels",
  serverHost: "speedtest.sewan.be",
  isp: "NordVPN",
  externalIp: "1.1.1.1",
  isVpn: false,
  ...over,
});

const input = (over: Partial<DashboardInput> = {}): DashboardInput => ({
  from: T0,
  to: T0 + D,
  tzOffsetMin: 0,
  targets: [{ id: 1, workerId: "w1", label: "A", bindValue: "eth0", intervalMinutes: 60, enabled: true }],
  workers: [{ id: "w1", name: "Local", site: "default" }],
  filter: {},
  ...over,
});

describe("helpers", () => {
  it("computes percentile stat blocks", () => {
    expect(statBlock([])).toBeNull();
    expect(statBlock([5])).toEqual({ avg: 5, min: 5, max: 5, p50: 5, p95: 5 });
    const s = statBlock([1, 2, 3, 4, 100]);
    expect(s).toMatchObject({ avg: 22, min: 1, max: 100, p50: 3 });
    expect(s?.p95).toBeCloseTo(80.8);
  });

  it("picks a bucket size giving at most 240 buckets", () => {
    expect(pickBucketMs(H)).toBe(60_000);
    expect(pickBucketMs(D)).toBe(10 * 60_000);
    expect(pickBucketMs(30 * D)).toBe(3 * H);
    expect(pickBucketMs(5 * 365 * D)).toBe(D);
  });

  it("aligns day buckets to the client's timezone", () => {
    const t = Date.UTC(2026, 0, 10, 23, 30);
    expect(bucketStart(t, D, 0)).toBe(Date.UTC(2026, 0, 10));
    expect(bucketStart(t, D, 120)).toBe(Date.UTC(2026, 0, 10, 22));
  });

  it("keeps only the last attempt of a test", () => {
    const rows = [
      row({ attemptGroupId: "g", attemptNumber: 1, status: "failed" }),
      row({ attemptGroupId: "g", attemptNumber: 3, status: "ok" }),
      row({ attemptGroupId: "g", attemptNumber: 2, status: "failed" }),
      row({ attemptGroupId: "h" }),
    ];
    const out = finalAttempts(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.attemptGroupId === "g")?.status).toBe("ok");
  });
});

describe("buildDashboard", () => {
  it("buckets series, ignoring failed runs in speed stats but counting them", () => {
    const rows = [
      row({ startedAt: T0 + 1 * H, downloadBps: 100e6 }),
      row({ startedAt: T0 + 1 * H + 60_000, downloadBps: 200e6 }),
      row({ startedAt: T0 + 1 * H + 120_000, status: "failed", downloadBps: null, uploadBps: null, errorMessage: "x" }),
      row({ startedAt: T0 + 5 * H }),
    ];
    const d = buildDashboard(input(), rows);
    expect(d.bucketMs).toBe(10 * 60_000);
    expect(d.series).toHaveLength(2);
    expect(d.series[0]).toMatchObject({ key: "1", n: 3, ok: 2, failed: 1 });
    expect(d.series[0]?.metrics.downloadBps).toMatchObject({ avg: 150e6, min: 100e6, max: 200e6 });
    expect(d.summary).toMatchObject({ tests: 4, ok: 3, failed: 1 });
    expect(d.summary.successRate).toBe(75);
    expect(d.summary.downloadBytes).toBe(3000);
    expect(d.comparison[0]).toMatchObject({ key: "1", tests: 4, failed: 1 });
  });

  it("counts a retried test once, using its last attempt", () => {
    const rows = [
      row({ attemptGroupId: "g", attemptNumber: 1, status: "failed", downloadBps: null, startedAt: T0 + H }),
      row({ attemptGroupId: "g", attemptNumber: 2, status: "ok", startedAt: T0 + H + 30_000 }),
    ];
    const d = buildDashboard(input(), rows);
    expect(d.summary).toMatchObject({ tests: 1, ok: 1, failed: 0 });
  });

  it("ignores running rows and rows outside the range, except for the baseline", () => {
    const rows = [
      row({ status: "running", startedAt: T0 + H }),
      row({ startedAt: T0 - 2 * D, downloadBps: 80e6 }),
      row({ startedAt: T0 - D, downloadBps: 120e6 }),
      row({ startedAt: T0 + H, downloadBps: 60e6 }),
    ];
    const d = buildDashboard(input(), rows);
    expect(d.summary.tests).toBe(1);
    expect(d.baseline[0]).toMatchObject({ latestBps: 60e6, medianBps: 100e6 });
    expect(d.baseline[0]?.deviationPct).toBeCloseTo(-40);
  });

  it("fills data usage per local day with zeros and sums bytes", () => {
    const rows = [row({ startedAt: T0 + H }), row({ startedAt: T0 + 2 * H })];
    const d = buildDashboard(input({ to: T0 + 2 * D }), rows);
    expect(d.usage.map((u) => u.t)).toEqual([T0, T0 + D, T0 + 2 * D]);
    expect(d.usage[0]).toMatchObject({ downloadBytes: 2000, uploadBytes: 1000 });
    expect(d.usage[1]).toMatchObject({ downloadBytes: 0 });
  });

  it("builds the hour-of-day heatmap in the client timezone", () => {
    const rows = [row({ startedAt: T0 + 22 * H, downloadBps: 100e6 }), row({ startedAt: T0 + 22 * H + 60_000, downloadBps: 300e6 })];
    expect(buildDashboard(input(), rows).heatmap).toEqual([{ key: "1", hour: 22, n: 2, downloadBps: 200e6 }]);
    expect(buildDashboard(input({ tzOffsetMin: 120 }), rows).heatmap[0]?.hour).toBe(0);
  });

  it("flags stale targets and reports the last error", () => {
    const rows = [
      row({ startedAt: T0 + H }),
      row({ startedAt: T0 + 20 * H, status: "failed", downloadBps: null, errorMessage: "Network is unreachable" }),
    ];
    const d = buildDashboard(input(), rows);
    expect(d.health[0]).toMatchObject({ lastStatus: "failed", lastOkAt: T0 + H, lastError: "Network is unreachable", stale: true });
    const fresh = buildDashboard(input(), [row({ startedAt: T0 + 23 * H })]);
    expect(fresh.health[0]).toMatchObject({ stale: false, lastError: null });
  });

  it("lists configured targets without runs, but honours filters", () => {
    const two = input({
      targets: [
        { id: 1, workerId: "w1", label: "A", bindValue: "eth0", intervalMinutes: 60, enabled: true },
        { id: 2, workerId: "w2", label: "B", bindValue: "eth1", intervalMinutes: 60, enabled: false },
      ],
      workers: [
        { id: "w1", name: "Local", site: "default" },
        { id: "w2", name: "Remote", site: "lab" },
      ],
    });
    const d = buildDashboard(two, []);
    expect(d.targets.map((t) => t.key)).toEqual(["1", "2"]);
    expect(d.health.find((h) => h.key === "1")?.stale).toBe(true);
    expect(d.health.find((h) => h.key === "2")?.stale).toBe(false);
    expect(buildDashboard({ ...two, filter: { site: "lab" } }, []).targets.map((t) => t.key)).toEqual(["2"]);
    expect(buildDashboard({ ...two, filter: { targetIds: [1] } }, []).targets.map((t) => t.key)).toEqual(["1"]);
  });

  it("keeps runs of deleted targets under a stable key", () => {
    const d = buildDashboard(input({ targets: [] }), [row({ targetId: null, targetLabel: "Old" })]);
    expect(d.targets[0]).toMatchObject({ key: "x:Local:Old", targetId: null, label: "Old" });
  });

  it("aggregates servers and logs identity changes", () => {
    const rows = [
      row({ startedAt: T0 + H, serverName: "Sewan", downloadBps: 100e6 }),
      row({ startedAt: T0 + 2 * H, serverName: "Sewan", downloadBps: 300e6, externalIp: "2.2.2.2" }),
      row({ startedAt: T0 + 3 * H, serverName: "Proximus", serverHost: "p.be", externalIp: "2.2.2.2" }),
    ];
    const d = buildDashboard(input(), rows);
    expect(d.servers[0]).toMatchObject({ name: "Sewan", tests: 2, downloadBps: 200e6 });
    expect(d.identity).toHaveLength(2);
    expect(d.identity[0]).toMatchObject({ externalIp: "2.2.2.2", previousExternalIp: "1.1.1.1" });
    expect(d.identity[1]).toMatchObject({ externalIp: "1.1.1.1", previousExternalIp: null });
  });
});

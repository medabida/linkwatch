import {
  type BaselineEntry,
  DASHBOARD_METRICS,
  type DashboardDto,
  type DashboardMetric,
  type DashboardSummary,
  type DashboardTarget,
  type HealthEntry,
  type HeatmapCell,
  type IdentityChange,
  type RunDto,
  type SeriesPoint,
  type ServerStat,
  type StatBlock,
  type TargetComparison,
  type TargetDto,
  type UsagePoint,
} from "@linkwatch/shared";

export const DASHBOARD_ROW_FIELDS = [
  "id",
  "targetId",
  "targetLabel",
  "workerId",
  "workerName",
  "site",
  "bindValue",
  "attemptGroupId",
  "attemptNumber",
  "status",
  "startedAt",
  "errorMessage",
  "downloadBps",
  "uploadBps",
  "pingMs",
  "pingJitterMs",
  "pingLowMs",
  "pingHighMs",
  "packetLoss",
  "downloadLatencyIqmMs",
  "uploadLatencyIqmMs",
  "downloadBytes",
  "uploadBytes",
  "serverName",
  "serverLocation",
  "serverHost",
  "isp",
  "externalIp",
  "isVpn",
] as const satisfies readonly (keyof RunDto)[];

export type DashboardRow = Pick<RunDto, (typeof DASHBOARD_ROW_FIELDS)[number]>;

export interface DashboardInput {
  from: number;
  to: number;
  tzOffsetMin: number;
  targets: Pick<TargetDto, "id" | "workerId" | "label" | "bindValue" | "intervalMinutes" | "enabled">[];
  workers: { id: string; name: string; site: string }[];
  /** Restricts which configured targets are listed (also used to keep empty targets out when filtering by site). */
  filter: { workerId?: string; site?: string; targetIds?: number[] };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const BASELINE_MS = 7 * DAY;
const BUCKET_STEPS = [
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
];
const MAX_BUCKETS = 240;
const STALE_INTERVALS = 3;
const MAX_IDENTITY = 200;
const MAX_SERVERS = 20;

export function pickBucketMs(rangeMs: number): number {
  return BUCKET_STEPS.find((s) => rangeMs / s <= MAX_BUCKETS) ?? DAY;
}

export function bucketStart(t: number, bucketMs: number, tzOffsetMin: number): number {
  const tz = tzOffsetMin * MINUTE;
  return Math.floor((t + tz) / bucketMs) * bucketMs - tz;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0] as number;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (idx - lo);
}

export function statBlock(values: number[]): StatBlock | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    avg: sum / sorted.length,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const values = (rows: DashboardRow[], f: DashboardMetric | "downloadBytes" | "uploadBytes"): number[] => rows.map((r) => r[f]).filter(num);
const sum = (rows: DashboardRow[], f: "downloadBytes" | "uploadBytes") => values(rows, f).reduce((s, v) => s + v, 0);
const isOk = (r: DashboardRow) => r.status === "ok";

export const keyOf = (r: Pick<DashboardRow, "targetId" | "workerName" | "targetLabel">): string =>
  r.targetId !== null ? String(r.targetId) : `x:${r.workerName}:${r.targetLabel}`;

/** Keeps only the last attempt of every test (retries of the same attempt group are not separate tests). */
export function finalAttempts(rows: DashboardRow[]): DashboardRow[] {
  const byGroup = new Map<string, DashboardRow>();
  for (const r of rows) {
    const prev = byGroup.get(r.attemptGroupId);
    if (!prev || r.attemptNumber > prev.attemptNumber || (r.attemptNumber === prev.attemptNumber && r.id > prev.id))
      byGroup.set(r.attemptGroupId, r);
  }
  return [...byGroup.values()].sort((a, b) => a.startedAt - b.startedAt || a.id - b.id);
}

function metricBlocks(rows: DashboardRow[]): Partial<Record<DashboardMetric, StatBlock>> {
  const out: Partial<Record<DashboardMetric, StatBlock>> = {};
  for (const m of DASHBOARD_METRICS) {
    const b = statBlock(values(rows, m));
    if (b) out[m] = b;
  }
  return out;
}

export function buildDashboard(input: DashboardInput, fetched: DashboardRow[]): DashboardDto {
  const { from, to, tzOffsetMin } = input;
  const tz = tzOffsetMin * MINUTE;
  const bucketMs = pickBucketMs(to - from);
  const all = finalAttempts(fetched.filter((r) => r.status !== "running"));
  const rows = all.filter((r) => r.startedAt >= from && r.startedAt <= to);
  const okRows = rows.filter(isOk);

  const workerById = new Map(input.workers.map((w) => [w.id, w]));
  const targets = new Map<string, DashboardTarget>();
  for (const t of input.targets) {
    const w = workerById.get(t.workerId);
    if (input.filter.workerId && t.workerId !== input.filter.workerId) continue;
    if (input.filter.targetIds && !input.filter.targetIds.includes(t.id)) continue;
    if (input.filter.site && w?.site !== input.filter.site) continue;
    targets.set(String(t.id), {
      key: String(t.id),
      targetId: t.id,
      label: t.label,
      workerName: w?.name ?? "?",
      site: w?.site ?? "",
      bindValue: t.bindValue,
      enabled: t.enabled,
      intervalMinutes: t.intervalMinutes,
    });
  }
  for (const r of all) {
    const key = keyOf(r);
    const prev = targets.get(key);
    targets.set(key, {
      key,
      targetId: r.targetId,
      label: r.targetLabel,
      workerName: r.workerName,
      site: r.site,
      bindValue: r.bindValue,
      enabled: prev?.enabled ?? null,
      intervalMinutes: prev?.intervalMinutes ?? null,
    });
  }

  const groups = new Map<string, DashboardRow[]>();
  for (const r of rows) {
    const k = `${keyOf(r)}|${bucketStart(r.startedAt, bucketMs, tzOffsetMin)}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const series: SeriesPoint[] = [...groups.entries()]
    .map(([k, g]) => {
      const [key, t] = k.split("|") as [string, string];
      const ok = g.filter(isOk);
      return { key, t: Number(t), n: g.length, ok: ok.length, failed: g.length - ok.length, metrics: metricBlocks(ok) };
    })
    .sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));

  const summary: DashboardSummary = {
    tests: rows.length,
    ok: okRows.length,
    failed: rows.length - okRows.length,
    successRate: rows.length ? (okRows.length / rows.length) * 100 : null,
    downloadBps: statBlock(values(okRows, "downloadBps")),
    uploadBps: statBlock(values(okRows, "uploadBps")),
    pingMs: statBlock(values(okRows, "pingMs")),
    pingJitterMs: statBlock(values(okRows, "pingJitterMs")),
    packetLoss: statBlock(values(okRows, "packetLoss")),
    downloadBytes: sum(okRows, "downloadBytes"),
    uploadBytes: sum(okRows, "uploadBytes"),
  };

  const comparison: TargetComparison[] = [...targets.keys()].map((key) => {
    const mine = rows.filter((r) => keyOf(r) === key);
    const ok = mine.filter(isOk);
    return {
      key,
      tests: mine.length,
      ok: ok.length,
      failed: mine.length - ok.length,
      downloadBps: statBlock(values(ok, "downloadBps")),
      uploadBps: statBlock(values(ok, "uploadBps")),
      pingMs: statBlock(values(ok, "pingMs")),
      downloadBytes: sum(ok, "downloadBytes"),
      uploadBytes: sum(ok, "uploadBytes"),
    };
  });

  const usageByDay = new Map<number, UsagePoint>();
  for (let d = bucketStart(from, DAY, tzOffsetMin); d <= to && usageByDay.size < 367; d += DAY)
    usageByDay.set(d, { t: d, downloadBytes: 0, uploadBytes: 0 });
  for (const r of okRows) {
    const d = bucketStart(r.startedAt, DAY, tzOffsetMin);
    const p = usageByDay.get(d) ?? { t: d, downloadBytes: 0, uploadBytes: 0 };
    p.downloadBytes += r.downloadBytes ?? 0;
    p.uploadBytes += r.uploadBytes ?? 0;
    usageByDay.set(d, p);
  }
  const usage = [...usageByDay.values()].sort((a, b) => a.t - b.t);

  const cells = new Map<string, number[]>();
  for (const r of okRows) {
    if (!num(r.downloadBps)) continue;
    const hour = Math.floor(((((r.startedAt + tz) % DAY) + DAY) % DAY) / HOUR);
    const k = `${keyOf(r)}|${hour}`;
    const c = cells.get(k);
    if (c) c.push(r.downloadBps);
    else cells.set(k, [r.downloadBps]);
  }
  const heatmap: HeatmapCell[] = [...cells.entries()].map(([k, v]) => {
    const [key, hour] = k.split("|") as [string, string];
    return { key, hour: Number(hour), n: v.length, downloadBps: v.reduce((s, x) => s + x, 0) / v.length };
  });

  const baseline: BaselineEntry[] = [];
  const health: HealthEntry[] = [];
  for (const [key, target] of targets) {
    const mine = all.filter((r) => keyOf(r) === key);
    const okMine = mine.filter(isOk);
    const withSpeed = okMine.filter((r) => num(r.downloadBps));
    const latest = withSpeed[withSpeed.length - 1];
    const window = withSpeed.filter((r) => r.startedAt >= to - BASELINE_MS && r !== latest);
    const median = statBlock(window.map((r) => r.downloadBps as number))?.p50 ?? null;
    baseline.push({
      key,
      latestBps: latest?.downloadBps ?? null,
      latestAt: latest?.startedAt ?? null,
      medianBps: median,
      deviationPct: latest && median ? (((latest.downloadBps as number) - median) / median) * 100 : null,
    });

    const last = mine[mine.length - 1];
    const lastOk = okMine[okMine.length - 1];
    const lastFailed = [...mine].reverse().find((r) => !isOk(r));
    const interval = target.intervalMinutes;
    health.push({
      key,
      lastRunAt: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      lastOkAt: lastOk?.startedAt ?? null,
      lastError: last && !isOk(last) ? (lastFailed?.errorMessage ?? null) : null,
      stale: target.enabled === true && interval !== null && (lastOk ? to - lastOk.startedAt > STALE_INTERVALS * interval * MINUTE : true),
    });
  }

  const serverGroups = new Map<string, DashboardRow[]>();
  for (const r of okRows) {
    if (!r.serverName) continue;
    const k = `${r.serverName}|${r.serverHost ?? ""}`;
    const g = serverGroups.get(k);
    if (g) g.push(r);
    else serverGroups.set(k, [r]);
  }
  const servers: ServerStat[] = [...serverGroups.values()]
    .map((g) => ({
      name: g[0]?.serverName as string,
      location: g[0]?.serverLocation ?? null,
      host: g[0]?.serverHost ?? null,
      tests: g.length,
      downloadBps: statBlock(values(g, "downloadBps"))?.avg ?? null,
      uploadBps: statBlock(values(g, "uploadBps"))?.avg ?? null,
      pingMs: statBlock(values(g, "pingMs"))?.avg ?? null,
    }))
    .sort((a, b) => b.tests - a.tests)
    .slice(0, MAX_SERVERS);

  const identity: IdentityChange[] = [];
  const lastSeen = new Map<string, { ip: string | null; isp: string | null }>();
  for (const r of okRows) {
    if (!r.externalIp && !r.isp) continue;
    const key = keyOf(r);
    const prev = lastSeen.get(key);
    if (!prev || prev.ip !== r.externalIp || prev.isp !== r.isp) {
      identity.push({
        key,
        at: r.startedAt,
        externalIp: r.externalIp,
        isp: r.isp,
        isVpn: r.isVpn,
        previousExternalIp: prev?.ip ?? null,
        previousIsp: prev?.isp ?? null,
      });
      lastSeen.set(key, { ip: r.externalIp, isp: r.isp });
    }
  }
  identity.reverse();

  return {
    from,
    to,
    bucketMs,
    targets: [...targets.values()],
    series,
    summary,
    comparison,
    usage,
    heatmap,
    baseline,
    health,
    servers,
    identity: identity.slice(0, MAX_IDENTITY),
  };
}

import type { DashboardMetric, DashboardTarget, SeriesPoint, StatBlock } from "@linkwatch/shared";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RANGES = [
  { id: "1h", label: "1 hour", ms: HOUR },
  { id: "6h", label: "6 hours", ms: 6 * HOUR },
  { id: "24h", label: "24 hours", ms: DAY },
  { id: "7d", label: "7 days", ms: 7 * DAY },
  { id: "30d", label: "30 days", ms: 30 * DAY },
] as const;
export const DEFAULT_RANGE = "7d";

export type StatKey = keyof StatBlock;
export const STATS: { id: StatKey; label: string }[] = [
  { id: "avg", label: "Average" },
  { id: "p50", label: "Median (p50)" },
  { id: "p95", label: "p95" },
  { id: "min", label: "Min" },
  { id: "max", label: "Max" },
];

export interface DashboardParams {
  /** A preset id, or "custom". */
  range: string;
  from: number;
  to: number;
  workerId?: string;
  site?: string;
  targetIds?: number[];
  stat: StatKey;
  compare: boolean;
}

/** Client timezone offset in minutes east of UTC (the API's `tzOffsetMin`). */
export const localTzOffsetMin = () => -new Date().getTimezoneOffset();

/** `to` is rounded up to the minute so the query key stays stable between refreshes and the newest run is included. */
export function paramsFromUrl(sp: URLSearchParams, now = Date.now()): DashboardParams {
  const from = Number(sp.get("from"));
  const to = Number(sp.get("to"));
  const custom = sp.get("range") === "custom" && Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from;
  const preset = RANGES.find((r) => r.id === sp.get("range")) ?? (RANGES.find((r) => r.id === DEFAULT_RANGE) as (typeof RANGES)[number]);
  const end = Math.ceil(now / MINUTE) * MINUTE;
  const stat = STATS.find((s) => s.id === sp.get("stat"))?.id ?? "avg";
  const ids = (sp.get("targets") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    range: custom ? "custom" : preset.id,
    from: custom ? from : end - preset.ms,
    to: custom ? to : end,
    workerId: sp.get("workerId") || undefined,
    site: sp.get("site") || undefined,
    targetIds: ids.length ? ids : undefined,
    stat,
    compare: sp.get("compare") === "1",
  };
}

export function bucketGrid(from: number, to: number, bucketMs: number, tzOffsetMin: number): number[] {
  const tz = tzOffsetMin * MINUTE;
  const start = Math.floor((from + tz) / bucketMs) * bucketMs - tz;
  const out: number[] = [];
  for (let t = start; t <= to && out.length < 2000; t += bucketMs) out.push(t);
  return out;
}

export interface LineRow {
  t: number;
  [seriesKey: string]: number | null;
}

/**
 * One row per bucket of the full time grid (so missing data shows as a gap), one column per target.
 * `shiftMs` moves another period's points onto this period (compare mode); `suffix` keeps the columns apart.
 */
export function pivot(opts: {
  series: SeriesPoint[];
  grid: number[];
  bucketMs: number;
  tzOffsetMin: number;
  metric: DashboardMetric;
  stat: StatKey;
  scale?: number;
  shiftMs?: number;
  suffix?: string;
  into?: LineRow[];
}): LineRow[] {
  const { series, grid, bucketMs, tzOffsetMin, metric, stat, scale = 1, shiftMs = 0, suffix = "" } = opts;
  const rows = opts.into ?? grid.map((t) => ({ t }) as LineRow);
  const index = new Map(rows.map((r, i) => [r.t, i]));
  const tz = tzOffsetMin * MINUTE;
  for (const p of series) {
    const block = p.metrics[metric];
    if (!block) continue;
    const t = shiftMs ? Math.floor((p.t + shiftMs + tz) / bucketMs) * bucketMs - tz : p.t;
    const i = index.get(t);
    if (i !== undefined) (rows[i] as LineRow)[`${p.key}${suffix}`] = block[stat] / scale;
  }
  return rows;
}

export const PALETTE = ["#4aa3ff", "#3fb950", "#d29922", "#bc8cff", "#f778ba", "#39c5cf", "#ff7b54", "#a5d6ff", "#7ee787", "#e3b341"];
export const colorFor = (index: number) => PALETTE[index % PALETTE.length] as string;

export function targetName(t: Pick<DashboardTarget, "label" | "workerName">, all: Pick<DashboardTarget, "label">[]): string {
  return all.filter((o) => o.label === t.label).length > 1 ? `${t.label} (${t.workerName})` : t.label;
}

/** Percentage change, null when there is nothing to compare against. */
export function changePct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function tickFormatter(rangeMs: number): (t: number) => string {
  if (rangeMs <= 36 * HOUR) return (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (rangeMs <= 8 * DAY) return (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (t) => new Date(t).toLocaleDateString([], { day: "2-digit", month: "short" });
}

/** Green (fast) to red (slow) on a dark background, for the hour-of-day heatmap. */
export function heatColor(value: number, min: number, max: number): string {
  const ratio = max > min ? (value - min) / (max - min) : 1;
  const hue = Math.round(ratio * 120);
  return `hsl(${hue} 55% 32%)`;
}

export function relativeTime(t: number | null, now = Date.now()): string {
  if (t == null) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export const mbps = (bps: number | null | undefined) => (bps == null ? null : bps / 1_000_000);

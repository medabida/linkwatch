import type { DashboardMetric, DashboardTarget } from "@linkwatch/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ComparisonChart, ReliabilityChart, type ReliabilityRow, UsageChart } from "../components/dashboard/BarCharts.js";
import { Kpis } from "../components/dashboard/Kpis.js";
import { LineMetricChart } from "../components/dashboard/LineMetricChart.js";
import { BaselinePanel, HealthPanel, IdentityPanel } from "../components/dashboard/Tables.js";
import { OutageTimeline } from "../components/dashboard/Timeline.js";
import { api } from "../lib/api.js";
import {
  bucketGrid,
  colorFor,
  type DashboardParams,
  type LineRow,
  localTzOffsetMin,
  paramsFromUrl,
  pivot,
  RANGES,
  STATS,
  tickFormatter,
} from "../lib/dashboard.js";
import { toInputDateTime } from "../lib/format.js";

const REFRESH_MS = 30_000;

export function HomePage() {
  const [sp, setSp] = useSearchParams();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` moves the "now" of preset ranges forward
  const params = useMemo(() => paramsFromUrl(sp), [sp, tick]);
  const tz = localTzOffsetMin();

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  const workers = useQuery({ queryKey: ["workers"], queryFn: api.workers });
  const targetList = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });
  const sites = [...new Set((workers.data ?? []).map((w) => w.site))].sort();

  const request = (from: number, to: number) => ({
    from,
    to,
    workerId: params.workerId,
    site: params.site,
    targetIds: params.targetIds,
    tzOffsetMin: tz,
  });
  const current = useQuery({
    queryKey: ["dashboard", request(params.from, params.to)],
    queryFn: () => api.dashboard(request(params.from, params.to)),
    placeholderData: keepPreviousData,
  });
  const span = params.to - params.from;
  const previous = useQuery({
    queryKey: ["dashboard", request(params.from - span, params.from)],
    queryFn: () => api.dashboard(request(params.from - span, params.from)),
    enabled: params.compare,
    placeholderData: keepPreviousData,
  });

  const d = current.data;
  const prev = params.compare ? previous.data : undefined;

  const view = useMemo(() => {
    if (!d) return null;
    const grid = bucketGrid(d.from, d.to, d.bucketMs, tz);
    const colors: Record<string, string> = Object.fromEntries(d.targets.map((t, i) => [t.key, colorFor(i)]));
    const active = d.targets.filter((t) => d.series.some((p) => p.key === t.key));
    const line = (metric: DashboardMetric, scale = 1): LineRow[] => {
      const base = { grid, bucketMs: d.bucketMs, tzOffsetMin: tz, metric, stat: params.stat, scale };
      const rows = pivot({ ...base, series: d.series });
      if (prev) pivot({ ...base, series: prev.series, shiftMs: span, suffix: ":prev", into: rows });
      return rows;
    };
    const ping = line("pingMs");
    const only = active.length === 1 ? active[0] : undefined;
    if (only) {
      const base = { series: d.series, grid, bucketMs: d.bucketMs, tzOffsetMin: tz };
      const lows = pivot({ ...base, metric: "pingLowMs", stat: "min" });
      const highs = pivot({ ...base, metric: "pingHighMs", stat: "max" });
      ping.forEach((row, i) => {
        const lo = lows[i]?.[only.key];
        const hi = highs[i]?.[only.key];
        if (typeof lo === "number" && typeof hi === "number") {
          row.bandLow = lo;
          row.bandSpan = hi - lo;
        }
      });
    }
    const reliability: ReliabilityRow[] = grid.map((t) => ({ t, ok: 0, failed: 0 }));
    const at = new Map(reliability.map((r) => [r.t, r]));
    for (const p of d.series) {
      const r = at.get(p.t);
      if (r) {
        r.ok += p.ok;
        r.failed += p.failed;
      }
    }
    return {
      grid,
      colors,
      active,
      tick: tickFormatter(d.to - d.from),
      download: line("downloadBps", 1e6),
      upload: line("uploadBps", 1e6),
      ping,
      jitter: line("pingJitterMs"),
      dlLatency: line("downloadLatencyIqmMs"),
      ulLatency: line("uploadLatencyIqmMs"),
      loss: line("packetLoss"),
      reliability,
      band: Boolean(only),
    };
  }, [d, prev, params.stat, tz, span]);

  const statLabel = STATS.find((s) => s.id === params.stat)?.label.toLowerCase() ?? "";
  const toggleTarget = (id: number) => {
    const set = new Set(params.targetIds ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    update({ targets: [...set].join(",") || undefined });
  };
  const lineProps = (targets: DashboardTarget[]) => ({
    targets,
    colors: view?.colors ?? {},
    tick: view?.tick ?? (() => ""),
    compare: params.compare,
  });

  return (
    <section>
      <h1>Home</h1>
      <Filters
        params={params}
        update={update}
        workers={workers.data ?? []}
        sites={sites}
        targets={targetList.data ?? []}
        onToggleTarget={toggleTarget}
      />

      {current.error && (
        <p className="banner banner-error" role="alert">
          {(current.error as Error).message}
        </p>
      )}
      {current.isLoading && <p className="muted">Loading…</p>}

      {d && view && (
        <div className={current.isFetching ? "dash dash-busy" : "dash"}>
          {d.summary.tests === 0 && <p className="banner banner-info">No finished tests in this range yet.</p>}
          <Kpis summary={d.summary} previous={prev?.summary} stat={params.stat} />

          <div className="dash-grid">
            <BaselinePanel targets={d.targets} baseline={d.baseline} />
            <HealthPanel targets={d.targets} health={d.health} />

            <LineMetricChart title="Download speed" hint={statLabel} data={view.download} unit="Mbps" {...lineProps(view.active)} />
            <LineMetricChart title="Upload speed" hint={statLabel} data={view.upload} unit="Mbps" {...lineProps(view.active)} />
            <LineMetricChart
              title="Ping"
              hint={view.band ? `${statLabel}, shaded: min to max` : statLabel}
              data={view.ping}
              unit="ms"
              band={view.band}
              {...lineProps(view.active)}
            />
            <LineMetricChart title="Jitter" hint={statLabel} data={view.jitter} unit="ms" decimals={2} {...lineProps(view.active)} />
            <LineMetricChart
              title="Latency under load: download"
              hint={`${statLabel}, bufferbloat`}
              data={view.dlLatency}
              unit="ms"
              {...lineProps(view.active)}
            />
            <LineMetricChart
              title="Latency under load: upload"
              hint={`${statLabel}, bufferbloat`}
              data={view.ulLatency}
              unit="ms"
              {...lineProps(view.active)}
            />
            <ReliabilityChart data={view.reliability} tick={view.tick} />
            <LineMetricChart title="Packet loss" hint={statLabel} data={view.loss} unit="%" decimals={2} {...lineProps(view.active)} />

            <OutageTimeline targets={d.targets} series={d.series} from={d.from} to={d.to} />
            <ComparisonChart targets={view.active} comparison={d.comparison} stat={params.stat} />
            <UsageChart data={d.usage} />
            <IdentityPanel targets={d.targets} changes={d.identity} />
          </div>
        </div>
      )}
    </section>
  );
}

function Filters({
  params,
  update,
  workers,
  sites,
  targets,
  onToggleTarget,
}: {
  params: DashboardParams;
  update: (patch: Record<string, string | undefined>) => void;
  workers: { id: string; name: string }[];
  sites: string[];
  targets: { id: number; label: string }[];
  onToggleTarget: (id: number) => void;
}) {
  const selected = new Set(params.targetIds ?? []);
  const setCustom = (key: "from" | "to", value: string) => {
    const t = new Date(value).getTime();
    if (!Number.isFinite(t)) return;
    update({ range: "custom", from: String(key === "from" ? t : params.from), to: String(key === "to" ? t : params.to) });
  };
  return (
    <div className="filters">
      <label>
        Range
        <select
          aria-label="Time range"
          value={params.range}
          onChange={(e) =>
            e.target.value === "custom"
              ? update({ range: "custom", from: String(params.from), to: String(params.to) })
              : update({ range: e.target.value, from: undefined, to: undefined })
          }
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              Last {r.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {params.range === "custom" && (
        <>
          <label>
            From
            <input
              type="datetime-local"
              aria-label="From"
              value={toInputDateTime(params.from)}
              onChange={(e) => setCustom("from", e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              aria-label="To"
              value={toInputDateTime(params.to)}
              onChange={(e) => setCustom("to", e.target.value)}
            />
          </label>
        </>
      )}
      <label>
        Worker
        <select
          aria-label="Filter by worker"
          value={params.workerId ?? ""}
          onChange={(e) => update({ workerId: e.target.value || undefined })}
        >
          <option value="">All</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Site
        <select aria-label="Filter by site" value={params.site ?? ""} onChange={(e) => update({ site: e.target.value || undefined })}>
          <option value="">All</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Statistic
        <select
          aria-label="Statistic"
          value={params.stat}
          onChange={(e) => update({ stat: e.target.value === "avg" ? undefined : e.target.value })}
        >
          {STATS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={params.compare} onChange={(e) => update({ compare: e.target.checked ? "1" : undefined })} />
        Compare with previous period
      </label>
      {targets.length > 0 && (
        <fieldset className="chips" aria-label="Interfaces">
          <legend>Interfaces {selected.size === 0 && <small className="muted">(all)</small>}</legend>
          {targets.map((t) => (
            <label key={t.id} className={selected.has(t.id) ? "chip chip-on" : "chip"}>
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => onToggleTarget(t.id)} />
              {t.label}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

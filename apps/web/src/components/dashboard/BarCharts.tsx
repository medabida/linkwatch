import type { DashboardTarget, TargetComparison, UsagePoint } from "@linkwatch/shared";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type StatKey, targetName } from "../../lib/dashboard.js";
import { Card, Empty } from "./Card.js";
import { AXIS, CHART_HEIGHT, GRID, TOOLTIP } from "./chartTheme.js";

export interface ReliabilityRow {
  t: number;
  ok: number;
  failed: number;
}

export function ReliabilityChart({ data, tick }: { data: ReliabilityRow[]; tick: (t: number) => string }) {
  const hasData = data.some((r) => r.ok + r.failed > 0);
  return (
    <Card title="Reliability" hint="tests per bucket (retries count once)">
      {!hasData ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="t" tickFormatter={tick} {...AXIS} minTickGap={40} />
            <YAxis {...AXIS} width={32} allowDecimals={false} />
            <Tooltip {...TOOLTIP} labelFormatter={(t) => new Date(Number(t)).toLocaleString()} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="ok" name="OK" stackId="a" fill="#3fb950" isAnimationActive={false} />
            <Bar dataKey="failed" name="Failed / timeout" stackId="a" fill="#f85149" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function ComparisonChart({
  targets,
  comparison,
  stat,
}: {
  targets: DashboardTarget[];
  comparison: TargetComparison[];
  stat: StatKey;
}) {
  const byKey = new Map(comparison.map((c) => [c.key, c]));
  const data = targets
    .map((t) => {
      const c = byKey.get(t.key);
      return {
        key: t.key,
        name: targetName(t, targets),
        download: c?.downloadBps ? c.downloadBps[stat] / 1e6 : null,
        upload: c?.uploadBps ? c.uploadBps[stat] / 1e6 : null,
        ping: c?.pingMs ? c.pingMs[stat] : null,
      };
    })
    .filter((d) => d.download !== null || d.upload !== null || d.ping !== null);
  const num = (v: unknown, unit: string) => (typeof v === "number" ? `${v.toFixed(1)} ${unit}` : "—");
  return (
    <Card title="Interface comparison" hint="speed and ping by interface" wide>
      {data.length === 0 ? (
        <Empty />
      ) : (
        <div className="split">
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} width={48} />
              <Tooltip {...TOOLTIP} formatter={(v) => num(v, "Mbps")} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="download" name="Download (Mbps)" fill="#4aa3ff" maxBarSize={70} isAnimationActive={false} />
              <Bar dataKey="upload" name="Upload (Mbps)" fill="#3fb950" maxBarSize={70} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} width={40} />
              <Tooltip {...TOOLTIP} formatter={(v) => num(v, "ms")} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="ping" name="Ping (ms)" fill="#d29922" maxBarSize={70} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function UsageChart({ data }: { data: UsagePoint[] }) {
  const gb = data.map((d) => ({ t: d.t, download: d.downloadBytes / 1e9, upload: d.uploadBytes / 1e9 }));
  const hasData = gb.some((d) => d.download + d.upload > 0);
  const day = (t: number) => new Date(t).toLocaleDateString([], { day: "2-digit", month: "short" });
  return (
    <Card title="Data usage" hint="consumed by the speed tests, per day">
      {!hasData ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={gb} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="t" tickFormatter={day} {...AXIS} minTickGap={30} />
            <YAxis {...AXIS} width={64} unit=" GB" />
            <Tooltip
              {...TOOLTIP}
              labelFormatter={(t) => day(Number(t))}
              formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)} GB` : "—")}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="download" name="Download" stackId="a" fill="#4aa3ff" isAnimationActive={false} />
            <Bar dataKey="upload" name="Upload" stackId="a" fill="#3fb950" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

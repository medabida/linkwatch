import { type DashboardSummary, formatBps } from "@linkwatch/shared";
import { changePct, type StatKey } from "../../lib/dashboard.js";
import { bytes, ms, pct } from "../../lib/format.js";

interface Kpi {
  label: string;
  value: string;
  /** Percentage change vs the previous period; `goodWhen` says which direction is an improvement. */
  change: number | null;
  goodWhen: "up" | "down";
  sub?: string;
}

function build(s: DashboardSummary, prev: DashboardSummary | undefined, stat: StatKey): Kpi[] {
  const pick = (b: { [K in StatKey]: number } | null | undefined) => b?.[stat] ?? null;
  return [
    {
      label: "Download",
      value: formatBps(pick(s.downloadBps)),
      change: changePct(pick(s.downloadBps), pick(prev?.downloadBps)),
      goodWhen: "up",
    },
    { label: "Upload", value: formatBps(pick(s.uploadBps)), change: changePct(pick(s.uploadBps), pick(prev?.uploadBps)), goodWhen: "up" },
    { label: "Ping", value: ms(pick(s.pingMs)), change: changePct(pick(s.pingMs), pick(prev?.pingMs)), goodWhen: "down" },
    {
      label: "Jitter",
      value: ms(pick(s.pingJitterMs)),
      change: changePct(pick(s.pingJitterMs), pick(prev?.pingJitterMs)),
      goodWhen: "down",
    },
    {
      label: "Success rate",
      value: s.successRate === null ? "—" : pct(s.successRate),
      change: changePct(s.successRate, prev?.successRate),
      goodWhen: "up",
      sub: `${s.ok} ok, ${s.failed} failed`,
    },
    { label: "Tests", value: String(s.tests), change: changePct(s.tests, prev?.tests), goodWhen: "up" },
    {
      label: "Data used",
      value: bytes(s.downloadBytes + s.uploadBytes),
      change: changePct(s.downloadBytes + s.uploadBytes, prev ? prev.downloadBytes + prev.uploadBytes : null),
      goodWhen: "down",
      sub: `${bytes(s.downloadBytes)} down, ${bytes(s.uploadBytes)} up`,
    },
  ];
}

export function Kpis({ summary, previous, stat }: { summary: DashboardSummary; previous?: DashboardSummary; stat: StatKey }) {
  return (
    <div className="kpis">
      {build(summary, previous, stat).map((k) => {
        const good = k.change === null || Math.abs(k.change) < 1 ? null : k.change > 0 === (k.goodWhen === "up");
        return (
          <div key={k.label} className="kpi">
            <span className="muted">{k.label}</span>
            <strong>{k.value}</strong>
            {k.change !== null && (
              <small className={good === null ? "muted" : good ? "dev-ok" : "dev-bad"} title="Change vs the previous period">
                {Math.abs(k.change) < 1 ? "no change" : `${k.change > 0 ? "▲" : "▼"} ${Math.abs(k.change).toFixed(0)}%`}
              </small>
            )}
            {k.sub && <small className="muted">{k.sub}</small>}
          </div>
        );
      })}
    </div>
  );
}

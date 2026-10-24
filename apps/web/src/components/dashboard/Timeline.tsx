import type { DashboardTarget, SeriesPoint } from "@linkwatch/shared";
import { targetName } from "../../lib/dashboard.js";
import { Card, Empty } from "./Card.js";

export function OutageTimeline({ targets, series, grid }: { targets: DashboardTarget[]; series: SeriesPoint[]; grid: number[] }) {
  const at = new Map(series.map((p) => [`${p.key}|${p.t}`, p]));
  const rows = targets.filter((t) => series.some((p) => p.key === t.key));
  return (
    <Card title="Outage timeline" hint="green: all tests ok, amber: some failed, red: all failed" wide>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="timeline">
          {rows.map((t) => (
            <div key={t.key} className="timeline-row">
              <span className="heat-label" title={`${t.workerName} · ${t.label}`}>
                {targetName(t, targets)} <small className="muted">{t.workerName}</small>
              </span>
              <div className="timeline-cells">
                {grid.map((time) => {
                  const p = at.get(`${t.key}|${time}`);
                  const state = !p ? "none" : p.failed === 0 ? "ok" : p.ok === 0 ? "down" : "partial";
                  return (
                    <span
                      key={time}
                      className={`tl tl-${state}`}
                      title={`${new Date(time).toLocaleString()}: ${p ? `${p.ok} ok, ${p.failed} failed` : "no tests"}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

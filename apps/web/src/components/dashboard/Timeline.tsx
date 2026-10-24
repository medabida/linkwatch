import type { DashboardTarget, SeriesPoint } from "@linkwatch/shared";
import { targetName } from "../../lib/dashboard.js";
import { Card, Empty } from "./Card.js";

export function OutageTimeline({
  targets,
  series,
  from,
  to,
}: {
  targets: DashboardTarget[];
  series: SeriesPoint[];
  from: number;
  to: number;
}) {
  const rows = targets.filter((t) => series.some((p) => p.key === t.key));
  const span = Math.max(1, to - from);
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - from) / span) * 100))}%`;
  return (
    <Card title="Outage timeline" hint="one dot per test round. green: all ok, amber: some failed, red: all failed" wide>
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
                {series
                  .filter((p) => p.key === t.key)
                  .map((p) => (
                    <span
                      key={p.t}
                      className={`tl-dot tl-${p.failed === 0 ? "ok" : p.ok === 0 ? "down" : "partial"}`}
                      style={{ left: pos(p.t) }}
                      title={`${new Date(p.t).toLocaleString()}: ${p.ok} ok, ${p.failed} failed`}
                    />
                  ))}
              </div>
            </div>
          ))}
          <div className="timeline-row">
            <span className="heat-label" />
            <div className="timeline-axis muted">
              <span>{new Date(from).toLocaleString()}</span>
              <span>{new Date(to).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

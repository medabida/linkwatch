import type { DashboardTarget, HeatmapCell } from "@linkwatch/shared";
import { formatBps } from "@linkwatch/shared";
import { heatColor, targetName } from "../../lib/dashboard.js";
import { Card, Empty } from "./Card.js";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function Heatmap({ targets, cells }: { targets: DashboardTarget[]; cells: HeatmapCell[] }) {
  const rows = targets.filter((t) => cells.some((c) => c.key === t.key));
  const speeds = cells.map((c) => c.downloadBps);
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const at = new Map(cells.map((c) => [`${c.key}|${c.hour}`, c]));
  return (
    <Card title="Download by hour of day" hint="average over the range, your local time. Red is slow, green is fast" wide>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="heat" aria-label="Download speed by hour of day">
          <thead>
            <tr>
              <th aria-label="Interface" />
              {HOURS.map((h) => (
                <th key={h} className="heat-hour">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.key}>
                <th scope="row" className="heat-label">
                  {targetName(t, targets)}
                </th>
                {HOURS.map((h) => {
                  const c = at.get(`${t.key}|${h}`);
                  return (
                    <td
                      key={h}
                      className="heat-cell"
                      style={c ? { background: heatColor(c.downloadBps, min, max) } : undefined}
                      title={
                        c
                          ? `${targetName(t, targets)} at ${h}:00: ${formatBps(c.downloadBps)} (${c.n} test${c.n === 1 ? "" : "s"})`
                          : `${h}:00: no data`
                      }
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

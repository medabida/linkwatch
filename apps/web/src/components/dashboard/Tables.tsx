import { type BaselineEntry, type DashboardTarget, formatBps, type HealthEntry, type IdentityChange } from "@linkwatch/shared";
import { relativeTime, targetName } from "../../lib/dashboard.js";
import { dateTime } from "../../lib/format.js";
import { Card, Empty } from "./Card.js";

const label = (key: string, targets: DashboardTarget[]) => {
  const t = targets.find((x) => x.key === key);
  return t ? targetName(t, targets) : key;
};

export function BaselinePanel({ targets, baseline }: { targets: DashboardTarget[]; baseline: BaselineEntry[] }) {
  const rows = baseline.filter((b) => b.latestBps !== null);
  return (
    <Card title="Speed vs 7-day baseline" hint="latest download compared with that interface's own median">
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Interface</th>
              <th>Latest</th>
              <th>7-day median</th>
              <th>Deviation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const d = b.deviationPct;
              const cls = d === null ? "" : d <= -25 ? "dev-bad" : d <= -10 ? "dev-warn" : "dev-ok";
              return (
                <tr key={b.key}>
                  <td>{label(b.key, targets)}</td>
                  <td>{formatBps(b.latestBps)}</td>
                  <td>{formatBps(b.medianBps)}</td>
                  <td className={cls}>{d === null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(0)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function HealthPanel({ targets, health }: { targets: DashboardTarget[]; health: HealthEntry[] }) {
  return (
    <Card title="Interface health" hint="last test and last success">
      {health.length === 0 ? (
        <Empty text="No interfaces yet." />
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>Interface</th>
              <th>Last test</th>
              <th>Last success</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {health.map((h) => (
              <tr key={h.key}>
                <td>
                  {label(h.key, targets)} <small className="muted">{targets.find((t) => t.key === h.key)?.workerName}</small>
                </td>
                <td>{relativeTime(h.lastRunAt)}</td>
                <td>{relativeTime(h.lastOkAt)}</td>
                <td>
                  {h.stale ? (
                    <span className="badge badge-failed" title={h.lastError ?? undefined}>
                      stale
                    </span>
                  ) : h.lastStatus && h.lastStatus !== "ok" ? (
                    <span className="badge badge-timeout" title={h.lastError ?? undefined}>
                      {h.lastStatus}
                    </span>
                  ) : (
                    <span className="badge badge-ok">{h.lastStatus ?? "no data"}</span>
                  )}
                  {h.lastError && <small className="error-text"> {h.lastError.slice(0, 60)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function IdentityPanel({ targets, changes }: { targets: DashboardTarget[]; changes: IdentityChange[] }) {
  return (
    <Card title="Network identity" hint="external IP / ISP seen by each interface, newest first">
      {changes.length === 0 ? (
        <Empty />
      ) : (
        <table className="dash-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Interface</th>
              <th>External IP</th>
              <th>ISP</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => {
              const first = c.previousExternalIp === null && c.previousIsp === null;
              return (
                <tr key={`${c.key}|${c.at}`}>
                  <td>{dateTime(c.at)}</td>
                  <td>{label(c.key, targets)}</td>
                  <td>{c.externalIp ?? "—"}</td>
                  <td>
                    {c.isp ?? "—"} {c.isVpn && <small className="muted">VPN</small>}
                  </td>
                  <td className="muted">{first ? "first seen" : `from ${c.previousExternalIp ?? "?"} (${c.previousIsp ?? "?"})`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

import type { AlertEventDto } from "@linkwatch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ChannelsTab } from "../components/alerting/ChannelsTab.js";
import { RulesTab } from "../components/alerting/RulesTab.js";
import { api } from "../lib/api.js";
import { relativeTime } from "../lib/dashboard.js";
import { dateTime } from "../lib/format.js";

const TABS = [
  { id: "active", label: "Active" },
  { id: "rules", label: "Rules" },
  { id: "history", label: "History" },
  { id: "channels", label: "Channels" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const span = (e: AlertEventDto) => {
  const m = Math.round(((e.resolvedAt ?? Date.now()) - e.firedAt) / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function ActiveTab() {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ["alerts", "events", "active"], queryFn: () => api.alertEvents("active"), refetchInterval: 30_000 });
  const ack = useMutation({ mutationFn: api.ackAlert, onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }) });
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Alert</th>
            <th>Where</th>
            <th>What</th>
            <th>Since</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {events.data?.map((e) => (
            <tr key={e.id}>
              <td>
                <span className={`badge sev-${e.severity}`}>{e.severity}</span>
              </td>
              <td>{e.ruleName}</td>
              <td>{e.subjectLabel}</td>
              <td>{e.message}</td>
              <td title={dateTime(e.firedAt)}>{relativeTime(e.firedAt)}</td>
              <td className="actions">
                {e.acknowledgedAt ? (
                  <small className="muted">acknowledged</small>
                ) : (
                  <button type="button" onClick={() => ack.mutate(e.id)} title="Stops reminders for this alert">
                    Acknowledge
                  </button>
                )}
              </td>
            </tr>
          ))}
          {events.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                No active alerts. Everything is fine.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTab() {
  const events = useQuery({ queryKey: ["alerts", "events", "all"], queryFn: () => api.alertEvents("all", 200) });
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fired</th>
            <th>Severity</th>
            <th>Alert</th>
            <th>Where</th>
            <th>What</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.data?.map((e) => (
            <tr key={e.id}>
              <td>{dateTime(e.firedAt)}</td>
              <td>
                <span className={`badge sev-${e.severity}`}>{e.severity}</span>
              </td>
              <td>{e.ruleName}</td>
              <td>{e.subjectLabel}</td>
              <td>{e.message}</td>
              <td>
                {e.state === "firing" ? (
                  <span className="error-text">firing for {span(e)}</span>
                ) : (
                  <span className="muted">resolved after {span(e)}</span>
                )}
              </td>
            </tr>
          ))}
          {events.data?.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Nothing has fired yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AlertingPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: TabId = TABS.find((t) => t.id === requested)?.id ?? "active";
  return (
    <section>
      <h1>Alerting</h1>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab tab-active" : "tab"}
            onClick={() => setParams(t.id === "active" ? {} : { tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "active" && <ActiveTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "channels" && <ChannelsTab />}
    </section>
  );
}

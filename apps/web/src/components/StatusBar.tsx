import { formatBps } from "@linkwatch/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { useActiveRuns } from "./LiveProvider.js";

export function StatusBar() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const { data: workers } = useQuery({ queryKey: ["workers"], queryFn: api.workers, refetchInterval: 5000 });
  const active = Object.values(useActiveRuns());
  const nameOf = (id?: string) => workers?.find((w) => w.id === id)?.name;
  const trouble = (workers ?? []).filter(
    (w) => w.enabled && w.kind === "remote" && (w.status === "offline" || w.status === "incompatible"),
  );

  return (
    <div className="status-stack">
      {health && !health.worker.alive && (
        <div className="banner banner-error">
          The local worker is not connected. Its tests will be recorded as failed until it reconnects (the master restarts it
          automatically).
        </div>
      )}
      {trouble.length > 0 && (
        <div className="banner banner-warn">
          {trouble.map((w) => (
            <div key={w.id}>
              Worker <strong>{w.name}</strong> is {w.status === "incompatible" ? "running an incompatible version" : "offline"}.
            </div>
          ))}
        </div>
      )}
      {health?.engine && !health.engine.available && <div className="banner banner-warn">{health.engine.hint}</div>}
      {active.length > 0 && (
        <div className="banner banner-info" role="status" aria-label="live status">
          {active.map((r) => (
            <div key={r.targetId} className="live-row">
              <strong>{r.label}</strong>
              {nameOf(r.workerId) && <span className="muted">@{nameOf(r.workerId)}</span>}
              {r.state === "queued" ? (
                <span>{r.attempt ? `retrying (next attempt ${r.attempt + 1}/${r.maxAttempts})` : "queued"}</span>
              ) : (
                <span>
                  running{r.attempt && r.attempt > 1 ? ` (attempt ${r.attempt}/${r.maxAttempts})` : ""}
                  {r.phase ? ` — ${r.phase}` : ""}
                  {r.progress !== undefined ? ` ${Math.round(r.progress * 100)}%` : ""}
                  {r.value !== undefined && (r.phase === "download" || r.phase === "upload") ? ` · ${formatBps(r.value)}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

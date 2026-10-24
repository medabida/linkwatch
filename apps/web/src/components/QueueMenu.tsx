import { formatBps, type QueueRunningDto } from "@linkwatch/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { useActiveRuns } from "./LiveProvider.js";

const TRIGGER_LABEL = { manual: "manual", startup: "startup", schedule: "scheduled" } as const;

function phaseText(r: QueueRunningDto & { phase?: string; progress?: number; value?: number }): string {
  const parts: string[] = [];
  parts.push(r.phase ?? "starting");
  if (r.progress !== undefined) parts.push(`${Math.round(r.progress * 100)}%`);
  if (r.value !== undefined && (r.phase === "download" || r.phase === "upload")) parts.push(formatBps(r.value));
  return parts.join(" · ");
}

export function QueueMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const live = useActiveRuns();
  const { data } = useQuery({ queryKey: ["queue"], queryFn: api.queue, refetchInterval: 5000 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const running = data?.running ?? [];
  const queued = data?.queued ?? [];
  const sites = new Set([...running, ...queued].map((x) => x.site));
  const busy = running.length + queued.length > 0;

  return (
    <div className="queue-menu" ref={root}>
      <button
        type="button"
        className={busy ? "queue-btn queue-btn-busy" : "queue-btn"}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Test queue"
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? (
          <>
            <span className="queue-dot" aria-hidden="true" /> {running.length} running
            {queued.length > 0 && <span className="muted"> · {queued.length} queued</span>}
          </>
        ) : (
          "Queue idle"
        )}
        <span aria-hidden="true"> ▾</span>
      </button>
      {open && (
        <section className="queue-panel" aria-label="Test queue details">
          <h4>In progress</h4>
          {running.length === 0 ? (
            <p className="muted queue-empty">Nothing is running.</p>
          ) : (
            <ul>
              {running.map((r) => {
                const l = live[r.targetId];
                const view = { ...r, phase: l?.phase ?? r.phase, progress: l?.progress ?? r.progress, value: l?.value ?? r.value };
                return (
                  <li key={r.targetId}>
                    <div className="queue-row">
                      <strong>{r.label}</strong>
                      <span className="muted">@{r.workerName}</span>
                      {sites.size > 1 && <span className="chip-site">{r.site}</span>}
                      {(view.attempt ?? 0) > 1 && <span className="muted">attempt {view.attempt}</span>}
                    </div>
                    <div className="queue-sub">
                      <span>{phaseText(view)}</span>
                      {view.progress !== undefined && (
                        <progress max={100} value={Math.round(view.progress * 100)} aria-label={`${r.label} progress`} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <h4>Queue {queued.length > 0 && <small className="muted">({queued.length})</small>}</h4>
          {queued.length === 0 ? (
            <p className="muted queue-empty">Nothing is waiting.</p>
          ) : (
            <ol>
              {queued.map((q) => (
                <li key={q.targetId}>
                  <div className="queue-row">
                    <strong>{q.label}</strong>
                    <span className="muted">@{q.workerName}</span>
                    {sites.size > 1 && <span className="chip-site">{q.site}</span>}
                    <span className="muted queue-trigger">{TRIGGER_LABEL[q.trigger]}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

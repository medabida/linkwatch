import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function StatusBar() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5000 });
  const { data: workers } = useQuery({ queryKey: ["workers"], queryFn: api.workers, refetchInterval: 5000 });
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
    </div>
  );
}

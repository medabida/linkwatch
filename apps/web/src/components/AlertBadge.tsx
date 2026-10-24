import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";

/** Top bar shortcut to the Alerting page with the number of open alerts. */
export function AlertBadge() {
  const { data } = useQuery({
    queryKey: ["alerts", "events", "active"],
    queryFn: () => api.alertEvents("active"),
    refetchInterval: 30_000,
  });
  const n = data?.length ?? 0;
  const critical = data?.some((e) => e.severity === "critical");
  return (
    <Link
      to="/alerting"
      className={n === 0 ? "alert-badge" : critical ? "alert-badge alert-badge-critical" : "alert-badge alert-badge-warning"}
      aria-label={n === 0 ? "No active alerts" : `${n} active alert${n === 1 ? "" : "s"}`}
    >
      <span aria-hidden="true">🔔</span>
      {n > 0 && <strong>{n}</strong>}
    </Link>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { describeScheduling } from "../lib/format.js";

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
  const s = settings.data;

  return (
    <section>
      <h1>Settings</h1>
      {settings.error && (
        <p className="banner banner-error" role="alert">
          {(settings.error as Error).message}
        </p>
      )}
      {save.error && (
        <p className="banner banner-error" role="alert">
          {(save.error as Error).message}
        </p>
      )}

      <h2>Scheduling</h2>
      <p className="muted">Which speed tests may run at the same time. Changes apply immediately to tests that are waiting.</p>
      {s ? (
        <div className="settings">
          <label className="setting">
            <input
              type="checkbox"
              role="switch"
              aria-label="Parallel sites"
              checked={s.parallelSites}
              aria-checked={s.parallelSites}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ parallelSites: e.target.checked })}
            />
            <span>
              <strong>Parallel sites</strong>
              <small className="muted">
                Workers in different sites may test at the same time. When off, only one site is active at a time (all of its tests finish
                before the next site starts).
              </small>
            </span>
          </label>
          <label className="setting">
            <input
              type="checkbox"
              role="switch"
              aria-label="Parallel interfaces"
              checked={s.parallelInterfaces}
              aria-checked={s.parallelInterfaces}
              disabled={save.isPending}
              onChange={(e) => save.mutate({ parallelInterfaces: e.target.checked })}
            />
            <span>
              <strong>Parallel interfaces</strong>
              <small className="muted">
                Interfaces on different workers of the same site may test at the same time. When off, a site runs one test at a time.
                Interfaces of one worker always run one after another.
              </small>
            </span>
          </label>
          <p className="banner banner-info" role="status">
            {describeScheduling(s)}
          </p>
        </div>
      ) : (
        !settings.error && <p className="muted">Loading…</p>
      )}
      <p className="muted">
        Notification channels (Telegram) are configured on the <Link to="/alerting?tab=channels">Alerting page</Link>.
      </p>
    </section>
  );
}

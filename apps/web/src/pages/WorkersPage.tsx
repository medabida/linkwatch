import {
  formatBps,
  interfaceOptions,
  ipOptions,
  type RunDto,
  type TargetDto,
  type WorkerDto,
  type WorkerTokenDto,
} from "@linkwatch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Modal } from "../components/Modal.js";
import { PairingPanel } from "../components/PairingPanel.js";
import { ApiError, api } from "../lib/api.js";
import { dateTime, ms } from "../lib/format.js";
import { STATUS_LABEL, uptime } from "../lib/workers.js";

const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

function AddWorker({ sites, onCreated, onCancel }: { sites: string[]; onCreated: (p: WorkerTokenDto) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [site, setSite] = useState("default");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createWorker({ name, site: site || "default" }),
    onSuccess: onCreated,
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required");
    setError(null);
    create.mutate();
  };
  return (
    <Modal title="Add worker" onClose={onCancel}>
      <form className="form" onSubmit={submit} noValidate>
        {error && <p className="error">{error}</p>}
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Garage Pi" />
        </label>
        <label>
          Site (workers in the same site test one at a time)
          <input value={site} onChange={(e) => setSite(e.target.value)} list="sites" />
          <datalist id="sites">
            {sites.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <div className="actions">
          <button type="submit" disabled={create.isPending}>
            Create
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface CardProps {
  worker: WorkerDto;
  targets: TargetDto[];
  lastRuns: Map<number, RunDto>;
  sites: string[];
  onPair: (p: WorkerTokenDto) => void;
  onNotice: (m: string) => void;
}

function WorkerCard({ worker: w, targets, lastRuns, sites, onPair, onNotice }: CardProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(w.name);
  const [site, setSite] = useState(w.site);
  const [error, setError] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ["workers"] });

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.updateWorker>[1]) => api.updateWorker(w.id, patch),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      done();
    },
    onError: (e) => setError(errorText(e)),
  });
  const rotate = useMutation({
    mutationFn: () => api.rotateWorkerToken(w.id),
    onSuccess: (p) => {
      done();
      onPair(p);
    },
    onError: (e) => onNotice(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteWorker(w.id),
    onSuccess: () => {
      done();
      void qc.invalidateQueries({ queryKey: ["targets"] });
    },
    onError: (e) => onNotice(errorText(e)),
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshWorker(w.id),
    onSuccess: ({ requested }) => onNotice(requested ? "Asked the worker to report its interfaces." : "Worker is not connected."),
  });
  const runNow = useMutation({
    mutationFn: () => api.runNow({ workerId: w.id }),
    onSuccess: ({ queued }) =>
      onNotice(queued ? `${queued} test${queued === 1 ? "" : "s"} queued on ${w.name}.` : `Nothing queued on ${w.name}.`),
    onError: (e) => onNotice(errorText(e)),
  });

  const detected = (t: TargetDto) =>
    !w.interfaces ||
    (t.bindType === "interface"
      ? interfaceOptions(w.interfaces).some((o) => o.name === t.bindValue)
      : ipOptions(w.interfaces).some((o) => o.address === t.bindValue));

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ name, site });
  };

  return (
    <article className={`card worker-card worker-${w.status}`} aria-label={`Worker ${w.name}`}>
      <header>
        <h2>{w.name}</h2>
        <span className={`badge badge-worker-${w.status}`}>{STATUS_LABEL[w.status]}</span>
        <span className="badge">{w.kind}</span>
        <span className="muted">site: {w.site}</span>
      </header>
      {w.statusDetail && w.status !== "waiting" && <p className="warn-text">{w.statusDetail}</p>}

      {editing && (
        <Modal title={`Edit ${w.name}`} onClose={() => setEditing(false)}>
          <form className="form" onSubmit={submitEdit} noValidate>
            {error && <p className="error">{error}</p>}
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Site
              <input value={site} onChange={(e) => setSite(e.target.value)} list={`sites-${w.id}`} />
              <datalist id={`sites-${w.id}`}>
                {sites.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </label>
            <div className="actions">
              <button type="submit">Save</button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {
        <dl className="facts">
          <dt>Last seen</dt>
          <dd>{w.status === "online" ? "now" : dateTime(w.lastSeenAt)}</dd>
          {w.status === "online" && (
            <>
              <dt>Connected</dt>
              <dd>
                {uptime(w.connectedSince)} · latency {ms(w.rttMs)}
              </dd>
            </>
          )}
          {w.machine && (
            <>
              <dt>Machine</dt>
              <dd>
                {w.machine.hostname} · {w.machine.platform} {w.machine.arch} · Node {w.machine.nodeVersion} · worker{" "}
                {w.machine.workerVersion}
              </dd>
            </>
          )}
          {w.engine && (
            <>
              <dt>Engine</dt>
              <dd>
                {w.engine.available ? `${w.engine.name} ${w.engine.version ?? ""}` : <span className="warn-text">{w.engine.hint}</span>}
              </dd>
            </>
          )}
          <dt>Activity</dt>
          <dd>
            {w.activity ? (
              <>
                running <strong>{w.activity.targetLabel}</strong>
                {w.activity.phase ? ` — ${w.activity.phase}` : ""}
                {w.activity.progress !== undefined ? ` ${Math.round(w.activity.progress * 100)}%` : ""}
                {w.activity.value !== undefined && (w.activity.phase === "download" || w.activity.phase === "upload")
                  ? ` · ${formatBps(w.activity.value)}`
                  : ""}
              </>
            ) : (
              "idle"
            )}
          </dd>
        </dl>
      }

      <h3>Interfaces</h3>
      {w.interfaces ? (
        <ul className="chips">
          {w.interfaces.map((i) => (
            <li key={i.name} title={i.addresses.map((a) => a.address).join(", ")}>
              {i.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Not reported yet.</p>
      )}
      {w.interfacesUpdatedAt && <small className="muted">updated {dateTime(w.interfacesUpdatedAt)}</small>}

      <h3>Targets ({w.targetCount})</h3>
      {targets.length === 0 ? (
        <p className="muted">No targets. Add one in Monitoring.</p>
      ) : (
        <ul className="target-list">
          {targets.map((t) => {
            const last = lastRuns.get(t.id);
            return (
              <li key={t.id}>
                <strong>{t.label}</strong> <code>{t.bindValue}</code>
                {!detected(t) && <span className="warn-text"> not detected on this worker</span>}
                {!t.enabled && <span className="muted"> (disabled)</span>}
                {last && (
                  <span className={`badge badge-${last.status}`}>
                    {last.status}
                    {last.status === "ok" ? ` ${formatBps(last.downloadBps)}` : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="actions">
        <button type="button" onClick={() => runNow.mutate()} disabled={w.status !== "online"}>
          Run now
        </button>
        <button type="button" onClick={() => refresh.mutate()} disabled={w.status !== "online"}>
          Refresh interfaces
        </button>
        <button
          type="button"
          onClick={() => {
            setName(w.name);
            setSite(w.site);
            setError(null);
            setEditing(true);
          }}
        >
          Edit
        </button>
        <button type="button" onClick={() => update.mutate({ enabled: !w.enabled })}>
          {w.enabled ? "Disable" : "Enable"}
        </button>
        {w.kind === "remote" && (
          <>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Rotate the token of "${w.name}"? It will be disconnected until you run the new command on it.`))
                  rotate.mutate();
              }}
            >
              Rotate token
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (window.confirm(`Remove "${w.name}" and its ${w.targetCount} target(s)? Past runs are kept.`)) remove.mutate();
              }}
            >
              Remove
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function WorkersPage() {
  const workers = useQuery({ queryKey: ["workers"], queryFn: api.workers, refetchInterval: 5000 });
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });
  const recent = useQuery({
    queryKey: ["runs", "latest-per-target"],
    queryFn: () => api.runs({ page: 1, pageSize: 100, sortBy: "startedAt", sortDir: "desc" }),
  });
  const [adding, setAdding] = useState(false);
  const [pairing, setPairing] = useState<WorkerTokenDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const qc = useQueryClient();

  const lastRuns = new Map<number, RunDto>();
  for (const r of recent.data?.rows ?? []) if (r.targetId !== null && !lastRuns.has(r.targetId)) lastRuns.set(r.targetId, r);
  const sites = [...new Set((workers.data ?? []).map((w) => w.site))].sort();

  return (
    <section>
      <h1>Workers</h1>
      {notice && (
        <p className="banner banner-info" role="status">
          {notice}
        </p>
      )}
      {pairing && <PairingPanel pairing={pairing} onClose={() => setPairing(null)} />}
      {workers.error && <p className="error">{errorText(workers.error)}</p>}

      <div className="worker-grid">
        {workers.data?.map((w) => (
          <WorkerCard
            key={w.id}
            worker={w}
            targets={(targets.data ?? []).filter((t) => t.workerId === w.id)}
            lastRuns={lastRuns}
            sites={sites}
            onPair={setPairing}
            onNotice={setNotice}
          />
        ))}
      </div>

      <p>
        <button type="button" onClick={() => setAdding(true)}>
          Add worker
        </button>
      </p>
      {adding && (
        <AddWorker
          sites={sites}
          onCancel={() => setAdding(false)}
          onCreated={(p) => {
            setAdding(false);
            setPairing(p);
            void qc.invalidateQueries({ queryKey: ["workers"] });
          }}
        />
      )}
    </section>
  );
}

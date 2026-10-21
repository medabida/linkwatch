import {
  DEFAULT_TIMEOUT_SECONDS,
  interfaceOptions,
  ipOptions,
  MAX_TIMEOUT_SECONDS,
  MIN_INTERVAL_MINUTES,
  MIN_TIMEOUT_SECONDS,
  type TargetDto,
  targetCreateSchema,
} from "@linkwatch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { BindPicker } from "../components/BindPicker.js";
import { Modal } from "../components/Modal.js";
import { ApiError, api } from "../lib/api.js";

interface FormState {
  workerId: string;
  label: string;
  bindType: "interface" | "ip";
  bindValue: string;
  intervalMinutes: string;
  timeoutSeconds: string;
  enabled: boolean;
}

const EMPTY: FormState = {
  workerId: "",
  label: "",
  bindType: "interface",
  bindValue: "",
  intervalMinutes: "60",
  timeoutSeconds: String(DEFAULT_TIMEOUT_SECONDS),
  enabled: true,
};

const fromTarget = (t: TargetDto): FormState => ({
  workerId: t.workerId,
  label: t.label,
  bindType: t.bindType,
  bindValue: t.bindValue,
  intervalMinutes: String(t.intervalMinutes),
  timeoutSeconds: String(t.timeoutSeconds),
  enabled: t.enabled,
});

export function MonitoringPage() {
  const qc = useQueryClient();
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });
  const workers = useQuery({ queryKey: ["workers"], queryFn: api.workers });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const workerList = workers.data ?? [];
  const workerById = new Map(workerList.map((w) => [w.id, w]));
  const selectedWorkerId = form.workerId || workerList[0]?.id || "";
  const selectedWorker = workerById.get(selectedWorkerId);

  const isDetected = (t: TargetDto) => {
    const list = workerById.get(t.workerId)?.interfaces;
    if (!list) return true;
    return t.bindType === "interface"
      ? interfaceOptions(list).some((o) => o.name === t.bindValue)
      : ipOptions(list).some((o) => o.address === t.bindValue);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ["targets"] });
  const refreshInterfaces = useMutation({
    mutationFn: () => api.refreshWorker(selectedWorkerId),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["workers"] }),
  });
  const reset = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
    setErrors({});
  };

  const save = useMutation({
    mutationFn: (input: ReturnType<typeof targetCreateSchema.parse>) =>
      editingId === null ? api.createTarget(input) : api.updateTarget(editingId, input),
    onSuccess: () => {
      reset();
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      else setErrors({ form: (e as Error).message });
    },
  });
  const remove = useMutation({ mutationFn: api.deleteTarget, onSuccess: () => void refresh() });
  const toggle = useMutation({
    mutationFn: (t: TargetDto) =>
      api.updateTarget(t.id, {
        workerId: t.workerId,
        label: t.label,
        bindType: t.bindType,
        bindValue: t.bindValue,
        intervalMinutes: t.intervalMinutes,
        timeoutSeconds: t.timeoutSeconds,
        enabled: !t.enabled,
      }),
    onSuccess: () => void refresh(),
  });
  const runNow = useMutation({
    mutationFn: (opts: { targetId?: number; workerId?: string }) => api.runNow(opts),
    onSuccess: ({ queued }) =>
      setNotice(
        queued > 0
          ? `${queued} test${queued === 1 ? "" : "s"} queued.`
          : "Nothing was queued (already queued or running, or the worker is disabled).",
      ),
    onError: (e) => setNotice((e as Error).message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = targetCreateSchema.safeParse({ ...form, workerId: selectedWorkerId });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <section>
      <h1>Monitoring</h1>
      {notice && (
        <p className="banner banner-info" role="status">
          {notice}
        </p>
      )}

      <h2>Interfaces</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Worker</th>
              <th>Bind</th>
              <th>Interval</th>
              <th>Timeout</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {targets.data?.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>{workerById.get(t.workerId)?.name ?? "—"}</td>
                <td>
                  {t.bindType}: <code>{t.bindValue}</code>
                  {!isDetected(t) && (
                    <small className="warn-text" title="The worker no longer reports this interface">
                      {" "}
                      not detected
                    </small>
                  )}
                </td>
                <td>{t.intervalMinutes} min</td>
                <td>{t.timeoutSeconds}s</td>
                <td>
                  <input type="checkbox" aria-label={`Enable ${t.label}`} checked={t.enabled} onChange={() => toggle.mutate(t)} />
                </td>
                <td className="actions">
                  <button type="button" onClick={() => runNow.mutate({ targetId: t.id })}>
                    Run now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormOpen(true);
                      setEditingId(t.id);
                      setForm(fromTarget(t));
                      setErrors({});
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Delete "${t.label}"? Its past runs are kept.`)) remove.mutate(t.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {targets.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No interfaces configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY);
            setErrors({});
            setFormOpen(true);
          }}
        >
          Add interface
        </button>
        {!!targets.data?.length && (
          <button type="button" onClick={() => runNow.mutate({})}>
            Run all enabled now
          </button>
        )}
      </div>

      {formOpen && (
        <Modal title={editingId === null ? "Add interface" : "Edit interface"} onClose={reset}>
          <form onSubmit={submit} className="form" noValidate>
            {errors.form && <p className="error">{errors.form}</p>}
            <label>
              Label
              <input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="ISP A" />
              {errors.label && <span className="error">{errors.label}</span>}
            </label>
            <label>
              Worker
              <select value={selectedWorkerId} onChange={(e) => setForm((f) => ({ ...f, workerId: e.target.value, bindValue: "" }))}>
                {workerList.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.status})
                  </option>
                ))}
              </select>
              {errors.workerId && <span className="error">{errors.workerId}</span>}
            </label>
            <label>
              Bind by
              <select
                value={form.bindType}
                onChange={(e) => setForm((f) => ({ ...f, bindType: e.target.value as FormState["bindType"], bindValue: "" }))}
              >
                <option value="interface">Interface name</option>
                <option value="ip">Source IP</option>
              </select>
            </label>
            <BindPicker
              bindType={form.bindType}
              value={form.bindValue}
              onChange={(v) => set("bindValue", v)}
              detected={selectedWorker?.interfaces ?? undefined}
              onRefresh={() => refreshInterfaces.mutate()}
              refreshing={refreshInterfaces.isPending}
              error={errors.bindValue}
              hostName={selectedWorker?.name}
            />
            {selectedWorker && selectedWorker.status !== "online" && (
              <p className="warn-text" role="note">
                {selectedWorker.name} is {selectedWorker.status}: showing its last known interfaces.
              </p>
            )}
            <label>
              Interval (minutes, min {MIN_INTERVAL_MINUTES})
              <input type="number" value={form.intervalMinutes} onChange={(e) => set("intervalMinutes", e.target.value)} />
              {errors.intervalMinutes && <span className="error">{errors.intervalMinutes}</span>}
            </label>
            <label>
              Timeout (seconds, {MIN_TIMEOUT_SECONDS}–{MAX_TIMEOUT_SECONDS})
              <input type="number" value={form.timeoutSeconds} onChange={(e) => set("timeoutSeconds", e.target.value)} />
              {errors.timeoutSeconds && <span className="error">{errors.timeoutSeconds}</span>}
            </label>
            <label className="inline">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              Enabled
            </label>
            <div className="actions">
              <button type="submit" disabled={save.isPending}>
                {editingId === null ? "Add" : "Save"}
              </button>
              <button type="button" onClick={reset}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

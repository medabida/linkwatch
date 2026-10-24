import { type AlertRuleDto, type AlertScope, type AlertType, LATENCY_METRICS, SPEED_METRICS } from "@linkwatch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  channelNames,
  describeCondition,
  describeScope,
  EMPTY_RULE,
  fromRule,
  inputOf,
  LATENCY_LABEL,
  type RuleForm,
  SPEED_LABEL,
  TEMPLATES,
  TYPE_LABEL,
  toInput,
} from "../../lib/alerts.js";
import { ApiError, api } from "../../lib/api.js";
import { Modal } from "../Modal.js";

const RESULT_BASED: AlertType[] = ["test_failed", "speed", "latency", "packet_loss"];

export function RulesTab() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["alerts", "rules"], queryFn: api.alertRules });
  const channels = useQuery({ queryKey: ["alerts", "channels"], queryFn: api.channels });
  const workers = useQuery({ queryKey: ["workers"], queryFn: api.workers });
  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });
  const [editing, setEditing] = useState<AlertRuleDto | "new" | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_RULE);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const workerList = workers.data ?? [];
  const targetList = targets.data ?? [];
  const channelList = channels.data ?? [];
  const sites = [...new Set(workerList.map((w) => w.site))].sort();

  const refresh = () => qc.invalidateQueries({ queryKey: ["alerts"] });
  const close = () => {
    setEditing(null);
    setErrors({});
  };
  const open = (r: AlertRuleDto | "new") => {
    setEditing(r);
    setErrors({});
    setForm(r === "new" ? { ...EMPTY_RULE, channelIds: channelList.map((c) => c.id) } : fromRule(r));
  };

  const save = useMutation({
    mutationFn: (input: NonNullable<ReturnType<typeof toInput>["data"]>) =>
      editing === "new" || editing === null ? api.createAlertRule(input) : api.updateAlertRule(editing.id, input),
    onSuccess: () => {
      close();
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      else setErrors({ form: (e as Error).message });
    },
  });
  const toggle = useMutation({
    mutationFn: (r: AlertRuleDto) => api.updateAlertRule(r.id, { ...inputOf(r), enabled: !r.enabled }),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: () => void refresh() });

  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const flip = (k: "channelIds" | "targetIds", id: number) =>
    setForm((f) => ({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = toInput(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };
  const err = (...paths: string[]) => {
    const p = paths.find((x) => errors[x]);
    return p ? <span className="error">{errors[p]}</span> : null;
  };
  const needsConsecutive = RESULT_BASED.includes(form.type);

  return (
    <div>
      <p className="muted">
        A rule watches one kind of problem on some interfaces or workers. It fires after the condition holds, notifies the chosen channels
        once, and announces when it clears.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>When</th>
              <th>Applies to</th>
              <th>Severity</th>
              <th>Notifies</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.data?.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name} <small className="muted">{TYPE_LABEL[r.condition.type]}</small>
                </td>
                <td>{describeCondition(r.condition)}</td>
                <td>{describeScope(r.scope, workerList, targetList)}</td>
                <td>
                  <span className={`badge sev-${r.severity}`}>{r.severity}</span>
                </td>
                <td>{channelNames(r.channelIds, channelList)}</td>
                <td>
                  <input type="checkbox" aria-label={`Enable ${r.name}`} checked={r.enabled} onChange={() => toggle.mutate(r)} />
                </td>
                <td className="actions">
                  <button type="button" onClick={() => open(r)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (window.confirm(`Delete rule "${r.name}"? Its history is kept.`)) remove.mutate(r.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rules.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No rules yet. Add one from a template.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button type="button" onClick={() => open("new")}>
          Add rule
        </button>
      </div>

      {editing && (
        <Modal title={editing === "new" ? "Add alert rule" : "Edit alert rule"} onClose={close} width="640px">
          <form onSubmit={submit} className="form" noValidate>
            {errors.form && <p className="error">{errors.form}</p>}
            {editing === "new" && (
              <label>
                Start from a template
                <select
                  value=""
                  onChange={(e) => {
                    const t = TEMPLATES[Number(e.target.value)];
                    if (t) setForm((f) => ({ ...f, ...t.form }));
                  }}
                >
                  <option value="">Choose…</option>
                  {TEMPLATES.map((t, i) => (
                    <option key={t.label} value={i}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Name
              <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Interface down" />
              {err("name")}
            </label>
            <label>
              Alert when
              <select value={form.type} onChange={(e) => set("type", e.target.value as RuleForm["type"])}>
                {(Object.keys(TYPE_LABEL) as AlertType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>

            {form.type === "test_failed" && (
              <label>
                Failed tests in a row (after retries)
                <input type="number" value={form.consecutive} onChange={(e) => set("consecutive", e.target.value)} />
                {err("condition.consecutive")}
              </label>
            )}
            {form.type === "stale" && (
              <label>
                Missed intervals without a successful test
                <input type="number" value={form.intervals} onChange={(e) => set("intervals", e.target.value)} />
                {err("condition.intervals")}
              </label>
            )}
            {form.type === "worker_offline" && (
              <label>
                Offline for more than (minutes)
                <input type="number" value={form.minutes} onChange={(e) => set("minutes", e.target.value)} />
                {err("condition.minutes")}
              </label>
            )}
            {form.type === "speed" && (
              <>
                <label>
                  Metric
                  <select value={form.speedMetric} onChange={(e) => set("speedMetric", e.target.value as RuleForm["speedMetric"])}>
                    {SPEED_METRICS.map((m) => (
                      <option key={m} value={m}>
                        {SPEED_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Compare with
                  <select value={form.speedMode} onChange={(e) => set("speedMode", e.target.value as RuleForm["speedMode"])}>
                    <option value="baseline">The interface's own 7-day average</option>
                    <option value="absolute">A fixed speed</option>
                  </select>
                </label>
                <label>
                  {form.speedMode === "baseline" ? "Alert when under (% of the 7-day average)" : "Alert when under (Mbps)"}
                  <input type="number" value={form.speedThreshold} onChange={(e) => set("speedThreshold", e.target.value)} />
                  {err("condition.threshold")}
                </label>
              </>
            )}
            {form.type === "latency" && (
              <>
                <label>
                  Metric
                  <select value={form.latencyMetric} onChange={(e) => set("latencyMetric", e.target.value as RuleForm["latencyMetric"])}>
                    {LATENCY_METRICS.map((m) => (
                      <option key={m} value={m}>
                        {LATENCY_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Alert when above (ms)
                  <input type="number" value={form.thresholdMs} onChange={(e) => set("thresholdMs", e.target.value)} />
                  {err("condition.thresholdMs")}
                </label>
              </>
            )}
            {form.type === "packet_loss" && (
              <label>
                Alert when above (%)
                <input type="number" value={form.thresholdPct} onChange={(e) => set("thresholdPct", e.target.value)} />
                {err("condition.thresholdPct")}
              </label>
            )}
            {needsConsecutive && form.type !== "test_failed" && (
              <label>
                Sustained for (tests in a row)
                <input type="number" value={form.consecutive} onChange={(e) => set("consecutive", e.target.value)} />
                {err("condition.consecutive")}
              </label>
            )}

            <label>
              Applies to
              <select value={form.scopeKind} onChange={(e) => set("scopeKind", e.target.value as AlertScope["kind"])}>
                <option value="all">Everything</option>
                <option value="site">A site</option>
                <option value="worker">A worker</option>
                <option value="targets">Specific interfaces</option>
              </select>
            </label>
            {form.scopeKind === "site" && (
              <label>
                Site
                <select value={form.site} onChange={(e) => set("site", e.target.value)}>
                  <option value="">Choose…</option>
                  {sites.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {err("scope.site")}
              </label>
            )}
            {form.scopeKind === "worker" && (
              <label>
                Worker
                <select value={form.workerId} onChange={(e) => set("workerId", e.target.value)}>
                  <option value="">Choose…</option>
                  {workerList.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                {err("scope.workerId")}
              </label>
            )}
            {form.scopeKind === "targets" && (
              <fieldset className="check-list">
                <legend>Interfaces</legend>
                {targetList.map((t) => (
                  <label key={t.id} className="inline">
                    <input type="checkbox" checked={form.targetIds.includes(t.id)} onChange={() => flip("targetIds", t.id)} />
                    {t.label} <small className="muted">@{workerList.find((w) => w.id === t.workerId)?.name}</small>
                  </label>
                ))}
                {err("scope.targetIds")}
              </fieldset>
            )}

            <label>
              Severity
              <select value={form.severity} onChange={(e) => set("severity", e.target.value as RuleForm["severity"])}>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <fieldset className="check-list">
              <legend>Notify (the app always shows alerts)</legend>
              {channelList.length === 0 && <p className="muted">No channels yet. Add one in the Channels tab.</p>}
              {channelList.map((c) => (
                <label key={c.id} className="inline">
                  <input type="checkbox" checked={form.channelIds.includes(c.id)} onChange={() => flip("channelIds", c.id)} />
                  {c.name}
                </label>
              ))}
            </fieldset>
            <label>
              Don't notify again within (minutes) after it cleared and fired again
              <input type="number" value={form.cooldownMinutes} onChange={(e) => set("cooldownMinutes", e.target.value)} />
              {err("cooldownMinutes")}
            </label>
            <label>
              Remind every (minutes) while still firing, 0 = never
              <input type="number" value={form.renotifyMinutes} onChange={(e) => set("renotifyMinutes", e.target.value)} />
              {err("renotifyMinutes")}
            </label>
            <label className="inline">
              <input type="checkbox" checked={form.notifyRecovery} onChange={(e) => set("notifyRecovery", e.target.checked)} />
              Send a message when it clears
            </label>
            <label className="inline">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              Enabled
            </label>
            <div className="actions">
              <button type="submit" disabled={save.isPending}>
                {editing === "new" ? "Add" : "Save"}
              </button>
              <button type="button" onClick={close}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

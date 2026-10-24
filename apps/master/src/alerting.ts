import type { Repos } from "@linkwatch/db";
import {
  type AlertCondition,
  type AlertEventDto,
  type AlertRuleDto,
  type AlertScope,
  DEFAULT_SITE,
  formatBps,
  MIN_BASELINE_SAMPLES,
  type RunDto,
  type TargetDto,
} from "@linkwatch/shared";
import type { EventBus } from "./events.js";
import type { WorkerHub } from "./hub.js";
import type { Notify } from "./notifier.js";

export interface AlertingDeps {
  repos: Repos;
  hub: WorkerHub;
  bus: EventBus;
  notify: Notify;
  now?: () => number;
  log?: (msg: string) => void;
  sweepEveryMs?: number;
}

interface Subject {
  kind: "target" | "worker";
  id: string;
  label: string;
}

/** `breach` true opens or keeps an alert, false closes it, null means "no data: leave it as it is". `oneShot` alerts are events, not states. */
type Verdict = { breach: boolean; message: string; value?: number | null; oneShot?: boolean } | null;

const MINUTE = 60_000;
const BASELINE_MS = 7 * 24 * 60 * MINUTE;
const RESULT_TYPES: ReadonlySet<AlertCondition["type"]> = new Set(["test_failed", "speed", "latency", "packet_loss", "ip_change"]);
const METRIC_LABEL = {
  downloadBps: "download",
  uploadBps: "upload",
  pingMs: "ping",
  pingJitterMs: "jitter",
  downloadLatencyIqmMs: "latency under download load",
  uploadLatencyIqmMs: "latency under upload load",
} as const;

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / MINUTE));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.floor(h / 24)} days`;
}

export function inScope(scope: AlertScope, target: TargetDto, workerSite: string): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "site":
      return workerSite === scope.site;
    case "worker":
      return target.workerId === scope.workerId;
    case "targets":
      return scope.targetIds.includes(target.id);
  }
}

export function createAlerting({ repos, hub, bus, notify, now = Date.now, log = () => {}, sweepEveryMs = MINUTE }: AlertingDeps) {
  const pending = new Set<Promise<unknown>>();
  let timer: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;

  const changed = (eventId: number | null) => bus.emit({ type: "alert_changed", runId: null, targetId: null, payload: { eventId } });
  const siteOf = (workerId: string) => repos.workers.get(workerId)?.site ?? DEFAULT_SITE;
  const targetLabel = (t: TargetDto) => `${t.label} @${repos.workers.get(t.workerId)?.name ?? t.workerId}`;

  /** Whether a target is being monitored at all (disabled targets and workers never alert). */
  const targetActive = (t: TargetDto) => t.enabled && !!repos.workers.get(t.workerId)?.enabled;

  function workerInScope(scope: AlertScope, workerId: string): boolean {
    const w = repos.workers.get(workerId);
    if (!w) return false;
    if (scope.kind === "all") return true;
    if (scope.kind === "site") return w.site === scope.site;
    if (scope.kind === "worker") return w.id === scope.workerId;
    return repos.targets.listByWorker(workerId).some((t) => scope.targetIds.includes(t.id));
  }

  function send(rule: AlertRuleDto, text: string): void {
    for (const id of rule.channelIds) {
      const channel = repos.alerts.channels.getRaw(id);
      if (!channel?.enabled) continue;
      const p = notify(channel.config, text)
        .then((r) => {
          repos.alerts.channels.recordResult(id, r.ok ? null : r.error);
          if (!r.ok) log(`[alerts] sending to "${channel.name}" failed: ${r.error}`);
        })
        .catch((e) => log(`[alerts] notifier crashed: ${e instanceof Error ? e.message : e}`));
      pending.add(p);
      void p.finally(() => pending.delete(p));
    }
  }

  const icon = (rule: AlertRuleDto) => (rule.severity === "critical" ? "🔴" : "🟠");
  const firingText = (rule: AlertRuleDto, e: AlertEventDto, reminder = false) =>
    `${icon(rule)} [${rule.severity}] ${rule.name}${reminder ? " (still firing)" : ""}\n${e.subjectLabel}: ${e.message}`;

  function fire(rule: AlertRuleDto, subject: Subject, v: NonNullable<Verdict>): void {
    const e = repos.alerts.events.open({
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      subjectKind: subject.kind,
      subjectId: subject.id,
      subjectLabel: subject.label,
      message: v.message,
      value: v.value ?? null,
    });
    const last = repos.alerts.events.lastFor(rule.id, subject.id, e.id);
    const suppressed = last?.notifiedAt != null && now() - last.notifiedAt < rule.cooldownMinutes * MINUTE;
    if (!suppressed) {
      send(rule, firingText(rule, e));
      repos.alerts.events.markNotified(e.id);
    }
    if (v.oneShot) repos.alerts.events.resolve(e.id);
    changed(e.id);
  }

  function close(e: AlertEventDto, rule: AlertRuleDto | undefined, announce: boolean): void {
    const done = repos.alerts.events.resolve(e.id);
    if (!done) return;
    if (announce && rule?.notifyRecovery && e.notifiedAt !== null) {
      send(rule, `✅ Resolved: ${rule.name}\n${e.subjectLabel} (after ${duration((done.resolvedAt ?? now()) - e.firedAt)})`);
    }
    changed(e.id);
  }

  function apply(rule: AlertRuleDto, subject: Subject, v: Verdict): void {
    if (!v) return;
    const active = repos.alerts.events.findActive(rule.id, subject.id);
    if (v.breach) {
      if (!active) {
        fire(rule, subject, v);
        return;
      }
      if (active.message !== v.message) repos.alerts.events.update(active.id, { message: v.message, value: v.value ?? null });
      const due =
        rule.renotifyMinutes > 0 &&
        !active.acknowledgedAt &&
        now() - (active.notifiedAt ?? active.firedAt) >= rule.renotifyMinutes * MINUTE;
      if (due) {
        send(rule, firingText(rule, { ...active, message: v.message }, true));
        repos.alerts.events.markNotified(active.id);
      }
      return;
    }
    if (active) close(active, rule, true);
  }

  /** Verdict for one result-based rule after a target finished a test (final attempt). */
  function evaluateResult(rule: AlertRuleDto, target: TargetDto): Verdict {
    const c = rule.condition;
    switch (c.type) {
      case "test_failed": {
        const finals = repos.runs.lastFinal(target.id, c.consecutive);
        if (finals.length === 0) return null;
        const bad = finals.length >= c.consecutive && finals.every((r) => r.status !== "ok");
        const reason = finals[0]?.errorMessage ?? finals[0]?.status;
        return { breach: bad, message: `${c.consecutive} failed test${c.consecutive > 1 ? "s" : ""} in a row (last: ${reason})` };
      }
      case "speed":
      case "latency":
      case "packet_loss":
        return evaluateMetric(c, target);
      case "ip_change": {
        const oks = repos.runs.lastFinal(target.id, 10).filter((r) => r.status === "ok" && r.externalIp);
        const [cur, prev] = oks;
        if (!cur || !prev || cur.externalIp === prev.externalIp) return null;
        return { breach: true, oneShot: true, message: `external IP changed from ${prev.externalIp} to ${cur.externalIp}` };
      }
      default:
        return null;
    }
  }

  function evaluateMetric(c: Extract<AlertCondition, { type: "speed" | "latency" | "packet_loss" }>, target: TargetDto): Verdict {
    const finals = repos.runs.lastFinal(target.id, c.consecutive);
    const latest = finals[0];
    if (latest?.status !== "ok") return null;
    const metric = c.type === "packet_loss" ? "packetLoss" : c.metric;
    const metricOf = (r: RunDto) => r[metric] as number | null;
    if (metricOf(latest) === null) return null;

    let breaching: (r: RunDto) => boolean;
    let describe: (value: number) => string;
    if (c.type === "speed") {
      const label = METRIC_LABEL[c.metric];
      if (c.mode === "absolute") {
        const limit = c.threshold * 1e6;
        breaching = (r) => (metricOf(r) ?? Number.POSITIVE_INFINITY) < limit;
        describe = (v) => `${label} ${formatBps(v)} is below ${formatBps(limit)}`;
      } else {
        const oldest = finals[finals.length - 1] as RunDto;
        const base = repos.runs.avgMetric(target.id, c.metric, latest.startedAt - BASELINE_MS, oldest.startedAt);
        if (base.avg === null || base.n < MIN_BASELINE_SAMPLES) return null;
        const limit = (base.avg * c.threshold) / 100;
        breaching = (r) => (metricOf(r) ?? Number.POSITIVE_INFINITY) < limit;
        describe = (v) => `${label} ${formatBps(v)} is under ${c.threshold}% of the 7-day average (${formatBps(base.avg as number)})`;
      }
    } else if (c.type === "latency") {
      breaching = (r) => (metricOf(r) ?? Number.NEGATIVE_INFINITY) > c.thresholdMs;
      describe = (v) => `${METRIC_LABEL[c.metric]} ${v.toFixed(1)} ms is above ${c.thresholdMs} ms`;
    } else {
      breaching = (r) => (metricOf(r) ?? Number.NEGATIVE_INFINITY) > c.thresholdPct;
      describe = (v) => `packet loss ${v.toFixed(2)}% is above ${c.thresholdPct}%`;
    }
    const breach = finals.length >= c.consecutive && finals.every((r) => r.status === "ok" && breaching(r));
    const v = metricOf(latest);
    return { breach, value: v, message: breach && v !== null ? describe(v) : "back to normal" };
  }

  function onRunFinished(targetId: number): void {
    const target = repos.targets.get(targetId);
    if (!target || !targetActive(target)) return;
    const site = siteOf(target.workerId);
    for (const rule of repos.alerts.rules.list()) {
      if (!rule.enabled || !RESULT_TYPES.has(rule.condition.type) || !inScope(rule.scope, target, site)) continue;
      try {
        apply(rule, { kind: "target", id: String(target.id), label: targetLabel(target) }, evaluateResult(rule, target));
      } catch (e) {
        log(`[alerts] rule "${rule.name}" failed: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Time-based rules (stale interfaces, offline workers) and clean-up of alerts that no longer apply. */
  function sweep(): void {
    const t = now();
    const rules = repos.alerts.rules.list();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const c = rule.condition;
      try {
        if (c.type === "stale") {
          for (const target of repos.targets.list()) {
            if (!targetActive(target) || !inScope(rule.scope, target, siteOf(target.workerId))) continue;
            const ref = repos.runs.lastOkAt(target.id) ?? target.createdAt;
            const limit = c.intervals * target.intervalMinutes * MINUTE;
            const stale = t - ref > limit;
            apply(
              rule,
              { kind: "target", id: String(target.id), label: targetLabel(target) },
              { breach: stale, message: `no successful test for ${duration(t - ref)} (expected every ${target.intervalMinutes} min)` },
            );
          }
        } else if (c.type === "worker_offline") {
          for (const w of repos.workers.list()) {
            if (!w.enabled || !workerInScope(rule.scope, w.id)) continue;
            const offline = !hub.isConnected(w.id);
            const since = w.lastSeenAt ?? w.createdAt;
            apply(
              rule,
              { kind: "worker", id: w.id, label: w.name },
              { breach: offline && t - since > c.minutes * MINUTE, message: `offline for ${duration(t - since)}` },
            );
          }
        }
      } catch (e) {
        log(`[alerts] rule "${rule.name}" failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    reconcile();
  }

  /** Silently closes alerts whose rule, target or worker is gone, disabled or out of scope. */
  function reconcile(): void {
    for (const e of repos.alerts.events.activeList()) {
      const rule = e.ruleId === null ? undefined : repos.alerts.rules.get(e.ruleId);
      let applies = !!rule?.enabled;
      if (applies && rule) {
        if (e.subjectKind === "target") {
          const target = repos.targets.get(Number(e.subjectId));
          applies = !!target && targetActive(target) && inScope(rule.scope, target, siteOf(target.workerId));
        } else {
          const w = repos.workers.get(e.subjectId);
          applies = !!w?.enabled && workerInScope(rule.scope, w.id);
        }
      }
      if (!applies) close(e, rule, false);
    }
  }

  return {
    start() {
      unsubscribe = bus.subscribe((e) => {
        if (e.type === "run_finished" && e.targetId !== null && !e.payload.willRetry) onRunFinished(e.targetId);
      });
      timer = setInterval(sweep, sweepEveryMs);
      sweep();
    },
    stop() {
      unsubscribe?.();
      if (timer) clearInterval(timer);
    },
    onRunFinished,
    /** Call after rules were created, changed or deleted so time-based rules evaluate now and stale alerts close. */
    sweep,
    acknowledge(id: number): AlertEventDto | undefined {
      const e = repos.alerts.events.acknowledge(id);
      if (e) changed(e.id);
      return e;
    },
    sendTest: (channelId: number, text: string) => {
      const channel = repos.alerts.channels.getRaw(channelId);
      if (!channel) return undefined;
      return notify(channel.config, text).then((r) => {
        repos.alerts.channels.recordResult(channelId, r.ok ? null : r.error);
        return r;
      });
    },
    whenIdle: async () => {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}

export type Alerting = ReturnType<typeof createAlerting>;

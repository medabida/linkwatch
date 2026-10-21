import { randomUUID } from "node:crypto";
import type { Repos } from "@linkwatch/db";
import type { TestFailureKind } from "@linkwatch/protocol";
import { DEFAULT_SITE, MAX_ATTEMPTS, type RunTrigger, type TargetDto, type WorkerActivity } from "@linkwatch/shared";
import type { EventBus } from "./events.js";
import { failureText, type WorkerHub } from "./hub.js";

export interface DispatcherDeps {
  repos: Repos;
  hub: WorkerHub;
  bus: EventBus;
  newId?: () => string;
  log?: (msg: string) => void;
}

interface QueueItem {
  targetId: number;
  trigger: RunTrigger;
}

interface SiteQueue {
  items: QueueItem[];
  runningTargetId: number | null;
  processing: Promise<void> | null;
}

const MAX_STORED_OUTPUT = 20_000;
const RETRYABLE: ReadonlySet<TestFailureKind> = new Set(["failed", "timeout"]);

/**
 * Per-target interval timers feeding one serial queue per SITE: workers in the same site never
 * test at the same time, different sites run in parallel.
 */
export function createDispatcher({ repos, hub, bus, newId = randomUUID, log = () => {} }: DispatcherDeps) {
  const targets = new Map<number, TargetDto>();
  const timers = new Map<number, NodeJS.Timeout>();
  const sites = new Map<string, SiteQueue>();
  const targetSite = new Map<number, string>();
  const activities = new Map<string, WorkerActivity>();
  /** targets whose first ("startup") run waits for their worker to connect */
  const awaitingStartup = new Set<number>();
  const abort = new AbortController();
  let stopped = false;

  const siteQueue = (site: string): SiteQueue => {
    const existing = sites.get(site);
    if (existing) return existing;
    const q: SiteQueue = { items: [], runningTargetId: null, processing: null };
    sites.set(site, q);
    return q;
  };
  const siteOf = (t: TargetDto) => repos.workers.get(t.workerId)?.site ?? DEFAULT_SITE;

  function isActive(t: TargetDto): boolean {
    const w = repos.workers.get(t.workerId);
    return !!w?.enabled;
  }

  function enqueue(targetId: number, trigger: RunTrigger): boolean {
    if (stopped) return false;
    const target = targets.get(targetId);
    if (!target || !isActive(target)) return false;
    const site = siteOf(target);
    const q = siteQueue(site);
    if (q.runningTargetId === targetId || q.items.some((i) => i.targetId === targetId)) return false;
    q.items.push({ targetId, trigger });
    targetSite.set(targetId, site);
    bus.emit({ type: "run_queued", runId: null, targetId, payload: { label: target.label, workerId: target.workerId } });
    q.processing ??= drain(q);
    return true;
  }

  async function drain(q: SiteQueue): Promise<void> {
    try {
      while (q.items.length > 0 && !stopped) {
        const item = q.items.shift();
        const target = item && targets.get(item.targetId);
        if (!item || !target) continue;
        q.runningTargetId = target.id;
        try {
          await runTarget(target, item.trigger);
        } catch (e) {
          log(`[${target.label}] unexpected dispatcher error: ${e instanceof Error ? e.message : e}`);
        } finally {
          q.runningTargetId = null;
          activities.delete(target.workerId);
        }
      }
    } finally {
      q.processing = null;
    }
  }

  /** One target: up to MAX_ATTEMPTS immediate attempts (only for failed/timeout), one stored run per attempt. */
  async function runTarget(target: TargetDto, trigger: RunTrigger): Promise<void> {
    const attemptGroupId = newId();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (abort.signal.aborted) return;
      const worker = repos.workers.get(target.workerId);
      if (!worker) return;
      const runId = repos.runs.start({
        workerId: worker.id,
        workerName: worker.name,
        site: worker.site,
        targetId: target.id,
        targetLabel: target.label,
        bindType: target.bindType,
        bindValue: target.bindValue,
        attemptGroupId,
        attemptNumber: attempt,
        trigger,
        engine: worker.info?.engine.name ?? "unknown",
      });
      const base = { label: target.label, workerId: worker.id };
      bus.emit({ type: "run_started", runId, targetId: target.id, payload: { ...base, attempt, maxAttempts: MAX_ATTEMPTS } });
      const activity: WorkerActivity = { runId, targetId: target.id, targetLabel: target.label, attempt };
      activities.set(worker.id, activity);

      const outcome = await hub.runTest({
        workerId: worker.id,
        runId,
        target: { bindType: target.bindType, bindValue: target.bindValue },
        timeoutMs: target.timeoutSeconds * 1000,
        signal: abort.signal,
        onProgress: (p) => {
          Object.assign(activity, p);
          bus.emit({ type: "run_progress", runId, targetId: target.id, payload: { ...base, ...p } });
        },
      });

      let status: "ok" | "failed" | "timeout";
      let retryable = false;
      if (outcome.ok) {
        status = "ok";
        repos.runs.finish(runId, {
          status,
          metrics: outcome.metrics,
          engineVersion: outcome.engine.version,
          rawJson: JSON.stringify(outcome.raw),
        });
      } else {
        status = outcome.kind === "timeout" ? "timeout" : "failed";
        retryable = RETRYABLE.has(outcome.kind);
        const message = outcome.message || failureText(outcome.kind);
        repos.runs.finish(runId, {
          status,
          errorMessage: message,
          exitCode: outcome.exitCode ?? null,
          stderr: outcome.stderr ? outcome.stderr.slice(-MAX_STORED_OUTPUT) : null,
          rawJson: outcome.stdout ? JSON.stringify({ stdout: outcome.stdout.slice(-MAX_STORED_OUTPUT) }) : null,
        });
        log(`[${target.label}@${worker.name}] attempt ${attempt}/${MAX_ATTEMPTS} ${outcome.kind}: ${message}`);
      }
      const willRetry = status !== "ok" && retryable && attempt < MAX_ATTEMPTS && !abort.signal.aborted;
      bus.emit({ type: "run_finished", runId, targetId: target.id, payload: { ...base, status, attempt, willRetry } });
      if (!willRetry) return;
    }
  }

  function setTimer(t: TargetDto) {
    clearTimer(t.id);
    timers.set(
      t.id,
      setInterval(() => enqueue(t.id, "schedule"), t.intervalMinutes * 60_000),
    );
  }
  function clearTimer(id: number) {
    const timer = timers.get(id);
    if (timer) clearInterval(timer);
    timers.delete(id);
  }

  function startup(t: TargetDto) {
    if (hub.isConnected(t.workerId)) enqueue(t.id, "startup");
    else awaitingStartup.add(t.id);
  }

  /** Reconcile with the latest targets. New enabled targets get a first run as soon as their worker is connected. */
  function reload() {
    const list = repos.targets.list();
    const seen = new Set<number>();
    for (const t of list) {
      seen.add(t.id);
      const prev = targets.get(t.id);
      targets.set(t.id, t);
      if (!t.enabled) {
        clearTimer(t.id);
        awaitingStartup.delete(t.id);
        continue;
      }
      if (!prev?.enabled) {
        setTimer(t);
        startup(t);
      } else if (prev.intervalMinutes !== t.intervalMinutes) {
        setTimer(t);
      }
    }
    for (const id of [...targets.keys()]) {
      if (seen.has(id)) continue;
      targets.delete(id);
      clearTimer(id);
      awaitingStartup.delete(id);
    }
    for (const q of sites.values()) {
      for (let i = q.items.length - 1; i >= 0; i--) {
        const item = q.items[i];
        const t = item && targets.get(item.targetId);
        if (item && (!t?.enabled || !isActive(t)) && item.trigger !== "manual") q.items.splice(i, 1);
      }
    }
  }

  const offConnected = hub.onConnected((workerId) => {
    for (const t of targets.values()) {
      if (t.workerId === workerId && awaitingStartup.delete(t.id)) enqueue(t.id, "startup");
    }
  });

  /** Queue a manual run for one target, all enabled targets, or all targets of one worker. Returns how many were queued. */
  function runNow(opts: { targetId?: number; workerId?: string } = {}): number {
    const ids =
      opts.targetId !== undefined
        ? [opts.targetId]
        : [...targets.values()].filter((t) => t.enabled && (!opts.workerId || t.workerId === opts.workerId)).map((t) => t.id);
    return ids.filter((id) => enqueue(id, "manual")).length;
  }

  async function stop() {
    stopped = true;
    offConnected();
    abort.abort();
    for (const id of [...timers.keys()]) clearTimer(id);
    for (const q of sites.values()) q.items.length = 0;
    await Promise.all([...sites.values()].map((q) => q.processing));
  }

  return {
    reload,
    runNow,
    stop,
    activityOf: (workerId: string): WorkerActivity | null => activities.get(workerId) ?? null,
    whenIdle: async () => {
      for (const q of sites.values()) while (q.processing) await q.processing;
    },
    get state() {
      return Object.fromEntries([...sites].map(([s, q]) => [s, { running: q.runningTargetId, queued: q.items.map((i) => i.targetId) }]));
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;

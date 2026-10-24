import { randomUUID } from "node:crypto";
import type { Repos } from "@linkwatch/db";
import type { TestFailureKind } from "@linkwatch/protocol";
import {
  DEFAULT_SITE,
  MAX_ATTEMPTS,
  type QueueDto,
  type RunTrigger,
  type SettingsDto,
  type TargetDto,
  type WorkerActivity,
} from "@linkwatch/shared";
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
  workerId: string;
  site: string;
}

interface RunningTest {
  workerId: string;
  site: string;
  startedAt: number;
  done: Promise<void>;
}

const MAX_STORED_OUTPUT = 20_000;
const RETRYABLE: ReadonlySet<TestFailureKind> = new Set(["failed", "timeout"]);

/**
 * Per-target interval timers feeding one FIFO queue. What may run at the same time follows the settings:
 *  - a worker never runs two tests at once;
 *  - without `parallelSites`, only one site is active at a time;
 *  - without `parallelInterfaces`, a site runs one test at a time (otherwise its workers may overlap).
 * A queued test that is blocked does not hold back tests it does not conflict with, but never gets overtaken
 * by a later test that does (so nothing starves).
 */
export function createDispatcher({ repos, hub, bus, newId = randomUUID, log = () => {} }: DispatcherDeps) {
  const targets = new Map<number, TargetDto>();
  const timers = new Map<number, NodeJS.Timeout>();
  const queue: QueueItem[] = [];
  const running = new Map<number, RunningTest>();
  const activities = new Map<string, WorkerActivity>();
  /** targets whose first ("startup") run waits for their worker to connect */
  const awaitingStartup = new Set<number>();
  const abort = new AbortController();
  let stopped = false;

  const siteOf = (t: TargetDto) => repos.workers.get(t.workerId)?.site ?? DEFAULT_SITE;

  function isActive(t: TargetDto): boolean {
    const w = repos.workers.get(t.workerId);
    return !!w?.enabled;
  }

  /** True when `a` and `b` must not run at the same time under the current settings. */
  function conflicts(a: { workerId: string; site: string }, b: { workerId: string; site: string }, cfg: SettingsDto): boolean {
    if (a.workerId === b.workerId) return true;
    if (a.site === b.site) return !cfg.parallelInterfaces;
    return !cfg.parallelSites;
  }

  function enqueue(targetId: number, trigger: RunTrigger): boolean {
    if (stopped) return false;
    const target = targets.get(targetId);
    if (!target || !isActive(target)) return false;
    if (running.has(targetId) || queue.some((i) => i.targetId === targetId)) return false;
    queue.push({ targetId, trigger, workerId: target.workerId, site: siteOf(target) });
    bus.emit({ type: "run_queued", runId: null, targetId, payload: { label: target.label, workerId: target.workerId } });
    pump();
    return true;
  }

  /** Starts every queued test that is allowed to run now. Called on enqueue, on completion and when settings change. */
  function pump(): void {
    if (stopped) return;
    const cfg = repos.settings.get();
    const skipped: QueueItem[] = [];
    for (let i = 0; i < queue.length; ) {
      const item = queue[i] as QueueItem;
      const blocked = [...running.values()].some((r) => conflicts(item, r, cfg)) || skipped.some((s) => conflicts(item, s, cfg));
      if (blocked) {
        skipped.push(item);
        i++;
        continue;
      }
      queue.splice(i, 1);
      start(item);
    }
  }

  function start(item: QueueItem): void {
    const target = targets.get(item.targetId);
    if (!target) return;
    const entry: RunningTest = { workerId: item.workerId, site: item.site, startedAt: Date.now(), done: Promise.resolve() };
    entry.done = (async () => {
      try {
        await runTarget(target, item.trigger);
      } catch (e) {
        log(`[${target.label}] unexpected dispatcher error: ${e instanceof Error ? e.message : e}`);
      } finally {
        running.delete(target.id);
        activities.delete(target.workerId);
        pump();
      }
    })();
    running.set(target.id, entry);
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
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i];
      const t = item && targets.get(item.targetId);
      if (item && (!t?.enabled || !isActive(t)) && item.trigger !== "manual") queue.splice(i, 1);
    }
    pump();
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
    queue.length = 0;
    await Promise.all([...running.values()].map((r) => r.done));
  }

  return {
    reload,
    runNow,
    stop,
    activityOf: (workerId: string): WorkerActivity | null => activities.get(workerId) ?? null,
    whenIdle: async () => {
      while (running.size > 0) await Promise.all([...running.values()].map((r) => r.done));
    },
    /** Tests in progress and the waiting queue (in the order they will be considered). */
    snapshot(): QueueDto {
      const label = (id: number) => targets.get(id)?.label ?? `#${id}`;
      const workerName = (id: string) => repos.workers.get(id)?.name ?? id;
      return {
        running: [...running].map(([targetId, r]) => {
          const a = activities.get(r.workerId);
          return {
            targetId,
            label: label(targetId),
            workerId: r.workerId,
            workerName: workerName(r.workerId),
            site: r.site,
            attempt: a?.targetId === targetId ? a.attempt : null,
            phase: a?.phase,
            progress: a?.progress,
            value: a?.value,
            startedAt: r.startedAt,
          };
        }),
        queued: queue.map((i) => ({
          targetId: i.targetId,
          label: label(i.targetId),
          workerId: i.workerId,
          workerName: workerName(i.workerId),
          site: i.site,
          trigger: i.trigger,
        })),
      };
    },
    /** Per site: the first running target (null if none), all running targets and the queued ones. */
    get state() {
      const sites = new Set([...running.values()].map((r) => r.site).concat(queue.map((i) => i.site)));
      return Object.fromEntries(
        [...sites].map((site) => {
          const ids = [...running].filter(([, r]) => r.site === site).map(([id]) => id);
          return [site, { running: ids[0] ?? null, runningAll: ids, queued: queue.filter((i) => i.site === site).map((i) => i.targetId) }];
        }),
      );
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;

import { createDb, createRepos, type Repos } from "@linkwatch/db";
import { emptyMetrics, type RunEventDto } from "@linkwatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDispatcher } from "./dispatcher.js";
import { createEventBus } from "./events.js";
import type { RunTestRequest, TestOutcome, WorkerHub } from "./hub.js";

const OK: TestOutcome = {
  ok: true,
  metrics: { ...emptyMetrics(), downloadBps: 1e8 },
  raw: { x: 1 },
  engine: { name: "ookla", version: "1.2" },
};
const fail = (kind: Extract<TestOutcome, { ok: false }>["kind"], message = kind): TestOutcome => ({ ok: false, kind, message });

let repos: Repos;
let connected: Set<string>;
let connectListeners: Array<(id: string) => void>;
let events: RunEventDto[];
let runTest: ReturnType<typeof vi.fn<(r: RunTestRequest) => Promise<TestOutcome>>>;
let dispatcher: ReturnType<typeof createDispatcher>;

const addWorker = (id: string, site = "default", enabled = true) => {
  repos.workers.create({ id, secret: "s", name: id, site });
  if (!enabled) repos.workers.update(id, { enabled: false });
};
const addTarget = (workerId: string, label: string, over = {}) =>
  repos.targets.create({
    workerId,
    label,
    bindType: "interface",
    bindValue: label,
    intervalMinutes: 10,
    timeoutSeconds: 60,
    enabled: true,
    ...over,
  });

beforeEach(() => {
  vi.useFakeTimers();
  repos = createRepos(createDb(":memory:"));
  connected = new Set();
  connectListeners = [];
  events = [];
  runTest = vi.fn(async () => OK);
  const hub = {
    isConnected: (id: string) => connected.has(id),
    onConnected: (fn: (id: string) => void) => {
      connectListeners.push(fn);
      return () => {};
    },
    runTest,
  } as unknown as WorkerHub;
  const bus = createEventBus();
  bus.subscribe((e) => events.push(e));
  dispatcher = createDispatcher({ repos, hub, bus, newId: () => "grp" });
});
afterEach(async () => {
  await dispatcher.stop();
  vi.useRealTimers();
});

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await dispatcher.whenIdle();
};
const runs = () => repos.runs.list({ page: 1, pageSize: 50, sortBy: "id", sortDir: "asc" }).rows;

describe("startup", () => {
  it("runs a new target immediately when its worker is connected and stores the result", async () => {
    addWorker("w1");
    connected.add("w1");
    addTarget("w1", "A");
    dispatcher.reload();
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(runTest.mock.calls[0]?.[0]).toMatchObject({
      workerId: "w1",
      target: { bindType: "interface", bindValue: "A" },
      timeoutMs: 60_000,
    });
    expect(runs()).toMatchObject([
      { status: "ok", trigger: "startup", workerId: "w1", workerName: "w1", site: "default", downloadBps: 1e8, engineVersion: "1.2" },
    ]);
    expect(events.map((e) => e.type)).toEqual(["run_queued", "run_started", "run_finished"]);
  });

  it("waits for the worker to connect instead of recording an offline failure at boot", async () => {
    addWorker("w1");
    addTarget("w1", "A");
    dispatcher.reload();
    await settle();
    expect(runTest).not.toHaveBeenCalled();
    expect(runs()).toHaveLength(0);
    connected.add("w1");
    for (const l of connectListeners) l("w1");
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
    for (const l of connectListeners) l("w1");
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
  });

  it("never schedules targets of disabled workers", async () => {
    addWorker("w1", "default", false);
    connected.add("w1");
    addTarget("w1", "A");
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(runTest).not.toHaveBeenCalled();
  });
});

describe("schedule", () => {
  it("repeats on the target's interval and picks up interval changes", async () => {
    addWorker("w1");
    connected.add("w1");
    const t = addTarget("w1", "A", { intervalMinutes: 10 });
    dispatcher.reload();
    await settle();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(2);
    repos.targets.update(t.id, {
      label: "A",
      bindType: "interface",
      bindValue: "A",
      intervalMinutes: 5,
      timeoutSeconds: 60,
      enabled: true,
    });
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(3);
    expect(runs().at(-1)?.trigger).toBe("schedule");
  });

  it("stops timers for disabled and removed targets", async () => {
    addWorker("w1");
    connected.add("w1");
    const t = addTarget("w1", "A");
    dispatcher.reload();
    await settle();
    repos.targets.remove(t.id);
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
  });
});

describe("serialisation per site", () => {
  const gate = () => {
    const open: Array<() => void> = [];
    runTest.mockImplementation(
      (r) =>
        new Promise<TestOutcome>((res) => {
          open.push(() => res(OK));
          void r;
        }),
    );
    return open;
  };

  it("runs workers of the same site one at a time", async () => {
    addWorker("w1", "home");
    addWorker("w2", "home");
    connected.add("w1").add("w2");
    addTarget("w1", "A");
    addTarget("w2", "B");
    const open = gate();
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveLength(1);
    expect(dispatcher.state.home).toMatchObject({ queued: [2] });
    expect(dispatcher.activityOf("w1")).toMatchObject({ targetLabel: "A", attempt: 1 });
    open[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveLength(2);
    open[1]?.();
    await settle();
    expect(runs().map((r) => r.workerName)).toEqual(["w1", "w2"]);
    expect(dispatcher.activityOf("w1")).toBeNull();
  });

  it("runs different sites in parallel", async () => {
    addWorker("w1", "home");
    addWorker("w2", "office");
    connected.add("w1").add("w2");
    addTarget("w1", "A");
    addTarget("w2", "B");
    const open = gate();
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveLength(2);
    for (const o of open) o();
    await settle();
  });

  it("does not queue a target that is already queued or running", async () => {
    addWorker("w1");
    connected.add("w1");
    addTarget("w1", "A");
    const open = gate();
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatcher.runNow()).toBe(0);
    open[0]?.();
    await settle();
  });
});

describe("concurrency settings", () => {
  const gate = () => {
    const open: Array<() => void> = [];
    runTest.mockImplementation(() => new Promise<TestOutcome>((res) => open.push(() => res(OK))));
    return open;
  };
  const labels = () => runTest.mock.calls.map(([r]) => r.target.bindValue);
  const go = async () => {
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(0);
  };
  const release = async (open: Array<() => void>, i: number) => {
    open[i]?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  const setup = () => {
    addWorker("w1", "home");
    addWorker("w2", "home");
    addWorker("w3", "office");
    connected.add("w1").add("w2").add("w3");
  };

  it("lets interfaces of different workers in a site overlap when parallel interfaces is on", async () => {
    setup();
    repos.settings.update({ parallelInterfaces: true });
    addTarget("w1", "A");
    addTarget("w2", "B");
    const open = gate();
    await go();
    expect(labels()).toEqual(["A", "B"]);
    for (const o of open) o();
    await settle();
  });

  it("still never runs two tests on one worker, even with everything parallel", async () => {
    setup();
    repos.settings.update({ parallelInterfaces: true, parallelSites: true });
    addTarget("w1", "A");
    addTarget("w1", "B");
    addTarget("w3", "C");
    const open = gate();
    await go();
    expect(labels()).toEqual(["A", "C"]);
    await release(open, 0);
    expect(labels()).toEqual(["A", "C", "B"]);
    for (const o of open) o();
    await settle();
  });

  it("runs one site at a time when parallel sites is off", async () => {
    setup();
    repos.settings.update({ parallelSites: false });
    addTarget("w1", "A");
    addTarget("w3", "C");
    const open = gate();
    await go();
    expect(labels()).toEqual(["A"]);
    expect(dispatcher.state.office).toMatchObject({ running: null, queued: [2] });
    await release(open, 0);
    expect(labels()).toEqual(["A", "C"]);
    for (const o of open) o();
    await settle();
  });

  it("is fully serial with both switches off", async () => {
    setup();
    repos.settings.update({ parallelSites: false, parallelInterfaces: false });
    addTarget("w1", "A");
    addTarget("w2", "B");
    addTarget("w3", "C");
    const open = gate();
    await go();
    expect(labels()).toEqual(["A"]);
    await release(open, 0);
    expect(labels()).toEqual(["A", "B"]);
    await release(open, 1);
    expect(labels()).toEqual(["A", "B", "C"]);
    for (const o of open) o();
    await settle();
  });

  it("overlaps interfaces inside the active site but does not let a later test starve another site", async () => {
    setup();
    repos.settings.update({ parallelSites: false, parallelInterfaces: true });
    addWorker("w4", "home");
    connected.add("w4");
    addTarget("w1", "A1");
    addTarget("w3", "B1");
    addTarget("w2", "A2");
    const open = gate();
    await go();
    expect(labels()).toEqual(["A1"]);
    await release(open, 0);
    expect(labels()).toEqual(["A1", "B1"]);
    await release(open, 1);
    expect(labels()).toEqual(["A1", "B1", "A2"]);
    for (const o of open) o();
    await settle();
  });

  it("applies a settings change to waiting tests on the next reload", async () => {
    setup();
    addTarget("w1", "A");
    addTarget("w2", "B");
    const open = gate();
    await go();
    expect(labels()).toEqual(["A"]);
    repos.settings.update({ parallelInterfaces: true });
    await go();
    expect(labels()).toEqual(["A", "B"]);
    for (const o of open) o();
    await settle();
  });

  it("reports every running target of a site in state", async () => {
    setup();
    repos.settings.update({ parallelInterfaces: true });
    addTarget("w1", "A");
    addTarget("w2", "B");
    const open = gate();
    await go();
    expect(dispatcher.state.home).toMatchObject({ running: 1, runningAll: [1, 2], queued: [] });
    for (const o of open) o();
    await settle();
  });
});

describe("snapshot", () => {
  it("lists running tests with progress and the waiting queue in order", async () => {
    addWorker("w1", "home");
    addWorker("w2", "home");
    connected.add("w1").add("w2");
    addTarget("w1", "A");
    addTarget("w2", "B");
    addTarget("w1", "C");
    let report: (p: { phase: string; progress: number; value: number }) => void = () => {};
    const open: Array<() => void> = [];
    runTest.mockImplementation(
      (r) =>
        new Promise<TestOutcome>((res) => {
          report = (p) => r.onProgress?.(p as never);
          open.push(() => res(OK));
        }),
    );
    expect(dispatcher.snapshot()).toEqual({ running: [], queued: [] });
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(0);
    report({ phase: "download", progress: 0.4, value: 5e7 });
    const snap = dispatcher.snapshot();
    expect(snap.running).toHaveLength(1);
    expect(snap.running[0]).toMatchObject({
      targetId: 1,
      label: "A",
      workerName: "w1",
      site: "home",
      attempt: 1,
      phase: "download",
      progress: 0.4,
      value: 5e7,
    });
    expect(snap.queued.map((q) => [q.label, q.workerName, q.trigger])).toEqual([
      ["B", "w2", "startup"],
      ["C", "w1", "startup"],
    ]);
    for (let i = 0; i < 3; i++) {
      open[i]?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    await settle();
    expect(dispatcher.snapshot()).toEqual({ running: [], queued: [] });
  });
});

describe("retries and failures", () => {
  const setup = () => {
    addWorker("w1");
    connected.add("w1");
    addTarget("w1", "A");
    dispatcher.reload();
  };

  it.each(["failed", "timeout"] as const)("retries %s up to 3 attempts in one group", async (kind) => {
    runTest.mockResolvedValue(fail(kind, "boom"));
    setup();
    await settle();
    expect(runTest).toHaveBeenCalledTimes(3);
    const rows = runs();
    expect(rows.map((r) => r.attemptNumber)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((r) => r.attemptGroupId)).size).toBe(1);
    expect(rows.every((r) => r.status === (kind === "timeout" ? "timeout" : "failed") && r.errorMessage === "boom")).toBe(true);
    expect(events.filter((e) => e.type === "run_finished").map((e) => e.payload.willRetry)).toEqual([true, true, false]);
  });

  it("stops retrying after a success", async () => {
    runTest.mockResolvedValueOnce(fail("failed")).mockResolvedValueOnce(OK);
    setup();
    await settle();
    expect(runs().map((r) => r.status)).toEqual(["failed", "ok"]);
  });

  it.each(["offline", "lost", "unresponsive", "unavailable", "aborted", "busy"] as const)("does not retry %s", async (kind) => {
    runTest.mockResolvedValue(fail(kind));
    setup();
    await settle();
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(runs()).toMatchObject([{ status: "failed" }]);
  });

  it("records an offline run for a due test whose worker is gone", async () => {
    runTest.mockResolvedValue(fail("offline", "Worker offline"));
    addWorker("w1");
    connected.add("w1");
    addTarget("w1", "A");
    dispatcher.reload();
    await settle();
    connected.clear();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await settle();
    expect(runs().at(-1)).toMatchObject({ status: "failed", errorMessage: "Worker offline", trigger: "schedule" });
  });

  it("stores stderr/stdout from failures, truncated", async () => {
    runTest.mockResolvedValue({ ok: false, kind: "unavailable", message: "m", exitCode: 3, stderr: "e".repeat(30_000), stdout: "o" });
    setup();
    await settle();
    const row = repos.runs.get(runs()[0]?.id ?? 0);
    expect(row?.exitCode).toBe(3);
    expect(row?.stderr).toHaveLength(20_000);
    expect(row?.rawJson).toBe('{"stdout":"o"}');
  });

  it("relays progress to the bus and the worker's activity", async () => {
    runTest.mockImplementation(async (r) => {
      r.onProgress?.({ phase: "download", progress: 0.5, value: 1e7 });
      expect(dispatcher.activityOf("w1")).toMatchObject({ phase: "download", progress: 0.5 });
      return OK;
    });
    setup();
    await settle();
    expect(events.find((e) => e.type === "run_progress")?.payload).toMatchObject({ phase: "download", workerId: "w1" });
  });
});

describe("runNow and shutdown", () => {
  it("queues manual runs for one target, one worker or everything", async () => {
    addWorker("w1");
    addWorker("w2", "other");
    connected.add("w1").add("w2");
    const a = addTarget("w1", "A", { enabled: false });
    addTarget("w2", "B");
    addTarget("w1", "C");
    dispatcher.reload();
    await settle();
    runTest.mockClear();
    expect(dispatcher.runNow({ targetId: a.id })).toBe(1);
    await settle();
    expect(dispatcher.runNow({ workerId: "w1" })).toBe(1);
    await settle();
    expect(dispatcher.runNow()).toBe(2);
    await settle();
    expect(dispatcher.runNow({ targetId: 999 })).toBe(0);
  });

  it("aborts the in-flight run on stop and runs nothing more", async () => {
    addWorker("w1");
    connected.add("w1");
    addTarget("w1", "A");
    addTarget("w1", "B");
    let signal: AbortSignal | undefined;
    runTest.mockImplementation(
      (r) =>
        new Promise<TestOutcome>((res) => {
          signal = r.signal;
          r.signal?.addEventListener("abort", () => res(fail("aborted")));
        }),
    );
    dispatcher.reload();
    await vi.advanceTimersByTimeAsync(0);
    await dispatcher.stop();
    expect(signal?.aborted).toBe(true);
    expect(runTest).toHaveBeenCalledTimes(1);
    expect(dispatcher.runNow()).toBe(0);
  });
});

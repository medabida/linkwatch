import { emptyMetrics, runsQuerySchema } from "@linkwatch/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { createRepos, type Repos } from "./repos.js";

let repos: Repos;
let t = 1_000;
beforeEach(() => {
  t = 1_000;
  repos = createRepos(createDb(":memory:"), () => (t += 10));
  wid = repos.workers.create({ id: "w1", secret: "s", name: "Local", kind: "local" }).id;
  target.workerId = wid;
});

let wid = "";
const target = {
  workerId: "",
  label: "A",
  bindType: "interface" as const,
  bindValue: "eth0",
  intervalMinutes: 30,
  timeoutSeconds: 120,
  enabled: true,
};
const newRun = (targetId: number | null, over = {}) => ({
  workerId: wid || null,
  workerName: "Local",
  site: "default",
  targetId,
  targetLabel: "A",
  bindType: "interface" as const,
  bindValue: "eth0",
  attemptGroupId: "g1",
  attemptNumber: 1,
  trigger: "schedule" as const,
  engine: "ookla",
  ...over,
});
const q = (o = {}) => runsQuerySchema.parse(o);

describe("targets", () => {
  it("creates, lists, updates and removes", () => {
    const a = repos.targets.create(target);
    expect(repos.targets.list()).toHaveLength(1);
    expect(repos.targets.update(a.id, { ...target, label: "B" })?.label).toBe("B");
    expect(repos.targets.update(999, target)).toBeUndefined();
    expect(repos.targets.remove(a.id)).toBe(true);
    expect(repos.targets.remove(a.id)).toBe(false);
  });

  it("keeps runs (with snapshot) when their target is deleted", () => {
    const a = repos.targets.create(target);
    const id = repos.runs.start(newRun(a.id));
    repos.targets.remove(a.id);
    const run = repos.runs.get(id);
    expect(run?.targetId).toBeNull();
    expect(run?.targetLabel).toBe("A");
  });
});

describe("runs", () => {
  it("records a successful run with metrics and duration", () => {
    const id = repos.runs.start(newRun(null));
    expect(repos.runs.get(id)?.status).toBe("running");
    repos.runs.finish(id, { status: "ok", metrics: { ...emptyMetrics(), downloadBps: 5e7, isVpn: false }, rawJson: '{"a":1}' });
    const r = repos.runs.get(id);
    expect(r).toMatchObject({ status: "ok", downloadBps: 5e7, isVpn: false, rawJson: '{"a":1}' });
    expect(r?.durationMs).toBeGreaterThan(0);
  });

  it("records failures with error details", () => {
    const id = repos.runs.start(newRun(null));
    repos.runs.finish(id, { status: "timeout", errorMessage: "boom", exitCode: 1, stderr: "x" });
    expect(repos.runs.get(id)).toMatchObject({ status: "timeout", errorMessage: "boom", exitCode: 1 });
  });

  it("fails interrupted runs", () => {
    const a = repos.runs.start(newRun(null));
    const b = repos.runs.start(newRun(null));
    repos.runs.finish(b, { status: "ok" });
    expect(repos.runs.failInterrupted()).toBe(1);
    expect(repos.runs.get(a)?.status).toBe("failed");
    expect(repos.runs.get(b)?.status).toBe("ok");
  });

  it("paginates, sorts and filters; list omits raw json", () => {
    const tg = repos.targets.create(target);
    for (let i = 0; i < 5; i++) {
      const id = repos.runs.start(newRun(i < 3 ? tg.id : null));
      repos.runs.finish(id, { status: i === 4 ? "failed" : "ok", metrics: { ...emptyMetrics(), downloadBps: i * 100 }, rawJson: "{}" });
    }
    const page1 = repos.runs.list(q({ pageSize: 2 }));
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0]?.id).toBe(5);
    expect("rawJson" in (page1.rows[0] as object)).toBe(false);
    expect(repos.runs.list(q({ pageSize: 2, page: 3 })).rows).toHaveLength(1);
    expect(repos.runs.list(q({ sortBy: "downloadBps", sortDir: "asc" })).rows[0]?.downloadBps).toBe(0);
    expect(repos.runs.list(q({ status: "failed" })).total).toBe(1);
    expect(repos.runs.list(q({ targetId: tg.id })).total).toBe(3);
    expect(repos.runs.list(q({ from: 1_000_000 })).total).toBe(0);
  });
});

describe("workers", () => {
  it("creates, updates, enforces unique names", () => {
    const w = repos.workers.create({ id: "w2", secret: "x", name: "Pi", site: "garage" });
    expect(w).toMatchObject({ kind: "remote", site: "garage", enabled: true, info: null });
    expect(() => repos.workers.create({ id: "w3", secret: "x", name: "Pi" })).toThrow();
    expect(repos.workers.update("w2", { enabled: false, site: "x" })).toMatchObject({ enabled: false, site: "x" });
    expect(repos.workers.update("nope", { name: "z" })).toBeUndefined();
    expect(repos.workers.setSecret("w2", "new")).toBe(true);
    expect(repos.workers.get("w2")?.secret).toBe("new");
  });

  it("ensureLocal is idempotent", () => {
    const again = repos.workers.ensureLocal({ id: "other", secret: "zz", name: "X" });
    expect(again.id).toBe("w1");
    expect(repos.workers.getLocal()?.id).toBe("w1");
  });

  it("stores connection info and interfaces", () => {
    const info = {
      hostname: "h",
      platform: "linux",
      arch: "x",
      osRelease: "1",
      nodeVersion: "v24",
      workerVersion: "0.2.0",
      engine: { name: "ookla", available: true, version: "1", hint: null },
    };
    repos.workers.markConnected("w1", info);
    repos.workers.saveInterfaces("w1", [{ name: "eth0", addresses: [] }]);
    const w = repos.workers.get("w1");
    expect(w?.info).toEqual(info);
    expect(w?.interfaces).toEqual([{ name: "eth0", addresses: [] }]);
    expect(w?.lastConnectedAt).not.toBeNull();
    repos.workers.touch("w1");
  });

  it("removing a worker deletes its targets but keeps runs", () => {
    const tg = repos.targets.create(target);
    const id = repos.runs.start(newRun(tg.id));
    expect(repos.targets.listByWorker(wid)).toHaveLength(1);
    repos.workers.remove(wid);
    expect(repos.targets.list()).toHaveLength(0);
    expect(repos.runs.get(id)).toMatchObject({ workerId: null, workerName: "Local", site: "default" });
  });

  it("filters runs by worker and site", () => {
    repos.workers.create({ id: "w2", secret: "x", name: "Pi", site: "s2" });
    repos.runs.start(newRun(null));
    repos.runs.start(newRun(null, { workerId: "w2", workerName: "Pi", site: "s2" }));
    expect(repos.runs.list(q({ workerId: "w2" })).total).toBe(1);
    expect(repos.runs.list(q({ site: "default" })).total).toBe(1);
  });
});

describe("settings", () => {
  it("defaults to the pre-settings behaviour and persists partial updates", () => {
    expect(repos.settings.get()).toEqual({ parallelSites: true, parallelInterfaces: false });
    expect(repos.settings.update({ parallelInterfaces: true })).toEqual({ parallelSites: true, parallelInterfaces: true });
    expect(repos.settings.update({ parallelSites: false })).toEqual({ parallelSites: false, parallelInterfaces: true });
    expect(repos.settings.get()).toEqual({ parallelSites: false, parallelInterfaces: true });
  });
});

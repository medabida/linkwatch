import http from "node:http";
import { createDb, createRepos, type Repos } from "@linkwatch/db";
import { CLOSE_PONG_TIMEOUT, CLOSE_REPLACED, formatToken, generateSecret, generateWorkerId, WS_PATH } from "@linkwatch/protocol";
import { emptyMetrics } from "@linkwatch/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createWorkerHub, type HubOptions, type WorkerHub } from "./hub.js";
import { info, portOf, type TestWorker, testWorker, until } from "./hub.testutil.js";

let repos: Repos;
let hub: WorkerHub;
let server: http.Server;
let url: string;
let id: string;
let secret: string;
let workers: TestWorker[] = [];
let clock = 1_000_000;

async function setup(opts: Partial<HubOptions> = {}) {
  clock = 1_000_000;
  repos = createRepos(createDb(":memory:"));
  id = generateWorkerId();
  secret = generateSecret();
  repos.workers.create({ id, secret, name: "Pi", site: "garage" });
  hub = createWorkerHub({ repos, now: () => clock, ...opts });
  server = http.createServer();
  hub.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${portOf(server)}${WS_PATH}`;
}
const connect = (over: Partial<Parameters<typeof testWorker>[0]> = {}) => {
  const w = testWorker({ url, workerId: id, secret, ...over });
  workers.push(w);
  return w;
};
const ready = async (over = {}) => {
  const w = connect(over);
  await w.ready();
  return w;
};

afterEach(async () => {
  for (const w of workers) w.ws.terminate();
  workers = [];
  await hub.close();
  await new Promise((r) => server.close(r));
});

describe("handshake", () => {
  beforeEach(() => setup());

  it("accepts valid credentials, proves itself to the worker and records connection info", async () => {
    const w = await ready();
    expect(w.last("ready")).toEqual({ type: "ready", workerId: id, name: "Pi" });
    expect(w.masterProofOk).toBe(true);
    expect(hub.isConnected(id)).toBe(true);
    expect(hub.statusOf(id).status).toBe("online");
    const row = repos.workers.get(id);
    expect(row?.info).toEqual(info);
    expect(row?.lastConnectedAt).not.toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const w = await ready({ secret: generateSecret() });
    expect(w.last("reject")).toMatchObject({ reason: "bad_credentials" });
    expect(hub.isConnected(id)).toBe(false);
    await until(() => w.isClosed());
  });

  it("answers unknown worker ids exactly like bad secrets (no id enumeration)", async () => {
    const w = await ready({ workerId: generateWorkerId(), secret: generateSecret() });
    expect(w.types()).toEqual(["challenge", "reject"]);
    expect(w.last("reject")).toMatchObject({ reason: "bad_credentials", message: "authentication failed" });
  });

  it("rejects incompatible protocol versions after authentication", async () => {
    const w = await ready({ protocol: 99 });
    expect(w.last("reject")).toMatchObject({ reason: "incompatible" });
    expect(hub.statusOf(id)).toMatchObject({ status: "incompatible" });
    const bad = await ready({ protocol: 99, secret: generateSecret() });
    expect(bad.last("reject")).toMatchObject({ reason: "bad_credentials" });
  });

  it("rejects disabled workers", async () => {
    repos.workers.update(id, { enabled: false });
    const w = await ready();
    expect(w.last("reject")).toMatchObject({ reason: "disabled" });
    expect(hub.statusOf(id).status).toBe("disabled");
  });

  it("closes on garbage and on out-of-order messages", async () => {
    const raw = new WebSocket(url);
    await new Promise((r) => raw.once("open", r));
    raw.send("not json");
    await new Promise((r) => raw.once("close", r));
    const w = connect();
    await w.ready();
    const raw2 = new WebSocket(url);
    await new Promise((r) => raw2.once("open", r));
    raw2.send(JSON.stringify({ type: "pong", t: 1 }));
    await new Promise((r) => raw2.once("close", r));
  });

  it("destroys upgrades on other paths", async () => {
    const other = new WebSocket(`ws://127.0.0.1:${portOf(server)}/nope`);
    const err = await new Promise((r) => other.once("error", r));
    expect(err).toBeDefined();
  });

  it("replaces an older connection of the same worker", async () => {
    const a = await ready();
    const b = await ready();
    await until(() => a.isClosed());
    expect(a.closed.code).toBe(CLOSE_REPLACED);
    expect(hub.isConnected(id)).toBe(true);
    expect(b.isClosed()).toBe(false);
  });

  it("stores reported interfaces and status", async () => {
    const w = await ready();
    w.send({ type: "interfaces", interfaces: [{ name: "eth0", addresses: [] }] });
    await until(() => repos.workers.get(id)?.interfaces !== null);
    expect(repos.workers.get(id)?.interfaces).toEqual([{ name: "eth0", addresses: [] }]);
    w.send({ type: "status", info: { ...info, workerVersion: "0.2.1" } });
    await until(() => repos.workers.get(id)?.info?.workerVersion === "0.2.1");
  });

  it("notifies connect and change listeners", async () => {
    const connected: string[] = [];
    const changes: string[] = [];
    hub.onConnected((w) => connected.push(w));
    hub.onChange((w) => changes.push(w));
    const w = await ready();
    expect(connected).toEqual([id]);
    w.close();
    await until(() => !hub.isConnected(id));
    expect(changes).toEqual([id, id]);
  });
});

describe("throttling", () => {
  beforeEach(() => setup({ maxFailures: 2, throttleWindowMs: 5000 }));

  it("blocks an IP after repeated failures and recovers after the window", async () => {
    await ready({ secret: generateSecret() });
    await ready({ secret: generateSecret() });
    const blocked = await ready();
    expect(blocked.last("reject")).toMatchObject({ reason: "throttled" });
    clock += 6000;
    const ok = await ready();
    expect(ok.last("ready")).toBeDefined();
  });
});

describe("handshake timeout", () => {
  beforeEach(() => setup({ handshakeTimeoutMs: 80 }));
  it("drops connections that never finish authenticating", async () => {
    const w = connect({ stallAfterHello: true });
    await until(() => w.isClosed());
  });
});

describe("liveness", () => {
  beforeEach(() => setup({ pingIntervalMs: 20, pongTimeoutMs: 80 }));

  it("pings, measures round-trip time, and keeps healthy connections", async () => {
    const w = await ready();
    await until(() => w.types().filter((t) => t === "ping").length >= 3);
    await until(() => hub.connection(id)?.rttMs !== null);
    expect(w.isClosed()).toBe(false);
  });

  it("closes connections that stop answering pings", async () => {
    clock = Date.now();
    await hub.close();
    server.close();
    await setup({ pingIntervalMs: 20, pongTimeoutMs: 80, now: Date.now });
    const w = await ready({ autoPong: false });
    await until(() => w.isClosed(), 2000);
    expect(w.closed.code).toBe(CLOSE_PONG_TIMEOUT);
    await until(() => !hub.isConnected(id));
  });
});

describe("status", () => {
  beforeEach(() => setup({ offlineGraceMs: 10_000 }));

  it("waiting -> online -> reconnecting -> offline", async () => {
    expect(hub.statusOf(id).status).toBe("waiting");
    const w = await ready();
    expect(hub.statusOf(id).status).toBe("online");
    w.close();
    await until(() => !hub.isConnected(id));
    expect(hub.statusOf(id).status).toBe("reconnecting");
    clock += 10_001;
    expect(hub.statusOf(id).status).toBe("offline");
    expect(hub.statusOf("missing").status).toBe("offline");
  });

  it("is offline (not waiting) for a worker that connected before the master restarted", () => {
    repos.workers.markConnected(id, info);
    expect(hub.statusOf(id).status).toBe("offline");
  });
});

describe("runTest", () => {
  beforeEach(() => setup({ watchdogMarginMs: 40 }));
  const req = (over = {}) => ({
    workerId: id,
    runId: 5,
    target: { bindType: "interface" as const, bindValue: "eth0" },
    timeoutMs: 100,
    ...over,
  });

  it("fails fast when the worker is not connected", async () => {
    expect(await hub.runTest(req())).toMatchObject({ ok: false, kind: "offline", message: "Worker offline" });
  });

  it("dispatches, relays progress and resolves with the result", async () => {
    const w = await ready();
    const progress: unknown[] = [];
    const p = hub.runTest(req({ onProgress: (x: unknown) => progress.push(x) }));
    await until(() => w.types().includes("run_test"));
    expect(w.last("run_test")).toMatchObject({ runId: 5, target: { bindType: "interface", bindValue: "eth0" }, timeoutMs: 100 });
    w.send({ type: "progress", runId: 5, phase: "download", progress: 0.4, value: 9 });
    w.send({
      type: "result",
      runId: 5,
      metrics: { ...emptyMetrics(), downloadBps: 1e8 },
      raw: { a: 1 },
      engine: { name: "ookla", version: "1" },
    });
    const out = await p;
    expect(out).toMatchObject({ ok: true, metrics: { downloadBps: 1e8 }, raw: { a: 1 } });
    expect(progress).toEqual([{ phase: "download", progress: 0.4, value: 9 }]);
  });

  it("relays failures", async () => {
    const w = await ready();
    const p = hub.runTest(req());
    await until(() => w.types().includes("run_test"));
    w.send({ type: "failure", runId: 5, kind: "timeout", message: "slow", exitCode: 2, stderr: "e" });
    expect(await p).toEqual({ ok: false, kind: "timeout", message: "slow", exitCode: 2, stderr: "e", stdout: undefined });
  });

  it("ignores results for unknown runs", async () => {
    const w = await ready();
    const p = hub.runTest(req());
    await until(() => w.types().includes("run_test"));
    w.send({ type: "result", runId: 999, metrics: emptyMetrics(), raw: null, engine: { name: "o", version: null } });
    w.send({ type: "failure", runId: 5, kind: "failed", message: "x" });
    expect(await p).toMatchObject({ kind: "failed" });
  });

  it("resolves as 'lost' when the connection drops mid-test", async () => {
    const w = await ready();
    const p = hub.runTest(req({ timeoutMs: 60_000 }));
    await until(() => w.types().includes("run_test"));
    w.ws.terminate();
    expect(await p).toMatchObject({ ok: false, kind: "lost" });
  });

  it("resolves as 'unresponsive' when the worker never answers (and tells it to abort)", async () => {
    const w = await ready();
    const out = await hub.runTest(req({ timeoutMs: 20 }));
    expect(out).toMatchObject({ ok: false, kind: "unresponsive" });
    await until(() => w.types().includes("abort"));
    expect(w.last("abort")).toEqual({ type: "abort", runId: 5 });
  });

  it("forwards an abort signal to the worker", async () => {
    const w = await ready();
    const ac = new AbortController();
    const p = hub.runTest(req({ signal: ac.signal, timeoutMs: 60_000 }));
    await until(() => w.types().includes("run_test"));
    ac.abort();
    await until(() => w.types().includes("abort"));
    w.send({ type: "failure", runId: 5, kind: "aborted", message: "aborted" });
    expect(await p).toMatchObject({ kind: "aborted" });
  });

  it("supports requests for interfaces/status and disconnecting", async () => {
    const w = await ready();
    expect(hub.requestInterfaces(id)).toBe(true);
    expect(hub.requestStatus(id)).toBe(true);
    await until(() => w.types().includes("request_interfaces") && w.types().includes("request_status"));
    hub.disconnect(id, 4004, "rotated");
    await until(() => w.isClosed());
    expect(w.closed.code).toBe(4004);
    expect(hub.requestInterfaces(id)).toBe(false);
  });

  it("rejects the old token after rotation", async () => {
    const w = await ready();
    repos.workers.setSecret(id, generateSecret());
    hub.disconnect(id);
    await until(() => w.isClosed());
    const again = await ready();
    expect(again.last("reject")).toMatchObject({ reason: "bad_credentials" });
    expect(formatToken(id, secret)).toContain(id);
  });
});

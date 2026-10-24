import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createDb, createRepos } from "@linkwatch/db";
import { parseToken, WS_PATH } from "@linkwatch/protocol";
import { emptyMetrics, type WorkerDto } from "@linkwatch/shared";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, ensureLocalWorker } from "./app.js";
import { createDispatcher } from "./dispatcher.js";
import { createEventBus } from "./events.js";
import { createWorkerHub } from "./hub.js";
import { portOf, testWorker, until } from "./hub.testutil.js";

let repos: ReturnType<typeof createRepos>;
let bus: ReturnType<typeof createEventBus>;
let hub: ReturnType<typeof createWorkerHub>;
let dispatcher: ReturnType<typeof createDispatcher>;
let reloads = 0;
const app = (webDist = "/nonexistent") => createApp({ repos, hub, dispatcher, bus, webDist });
const body = { label: "ISP A", bindType: "interface", bindValue: "eth0", intervalMinutes: 30 };

beforeEach(() => {
  repos = createRepos(createDb(":memory:"));
  ensureLocalWorker(repos);
  bus = createEventBus();
  hub = createWorkerHub({ repos });
  dispatcher = createDispatcher({ repos, hub, bus });
  reloads = 0;
  const reload = dispatcher.reload;
  dispatcher.reload = () => {
    reloads++;
    reload();
  };
});
afterEach(async () => {
  await dispatcher.stop();
  await hub.close();
});

describe("targets", () => {
  it("creates with defaults and reloads the dispatcher", async () => {
    const res = await request(app()).post("/api/targets").send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ label: "ISP A", timeoutSeconds: 120, enabled: true });
    expect(reloads).toBe(1);
    expect((await request(app()).get("/api/targets")).body).toHaveLength(1);
  });

  it("validates input", async () => {
    const res = await request(app())
      .post("/api/targets")
      .send({ ...body, intervalMinutes: 1 });
    expect(res.status).toBe(400);
    expect(res.body.issues[0]).toMatchObject({ path: "intervalMinutes" });
    expect(reloads).toBe(0);
  });

  it("updates and deletes, each reloading the dispatcher", async () => {
    const { body: t } = await request(app()).post("/api/targets").send(body);
    const up = await request(app())
      .put(`/api/targets/${t.id}`)
      .send({ ...body, label: "B", enabled: false });
    expect(up.body).toMatchObject({ label: "B", enabled: false });
    expect((await request(app()).delete(`/api/targets/${t.id}`)).status).toBe(204);
    expect(reloads).toBe(3);
  });

  it("404s on unknown ids and 400s on bad ids", async () => {
    expect((await request(app()).put("/api/targets/99").send(body)).status).toBe(404);
    expect((await request(app()).delete("/api/targets/99")).status).toBe(404);
    expect((await request(app()).delete("/api/targets/abc")).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const res = await request(app()).post("/api/targets").set("Content-Type", "application/json").send("{nope");
    expect(res.status).toBe(400);
  });
});

describe("duplicate targets", () => {
  it("rejects the same binding twice on one worker but allows it on another or with another type", async () => {
    const other = (await request(app()).post("/api/workers").send({ name: "Pi" })).body.worker.id;
    const a = await request(app()).post("/api/targets").send(body);
    expect(
      (
        await request(app())
          .post("/api/targets")
          .send({ ...body, label: "Again" })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app())
          .post("/api/targets")
          .send({ ...body, workerId: other })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app())
          .post("/api/targets")
          .send({ ...body, bindType: "ip", bindValue: "10.0.0.2" })
      ).status,
    ).toBe(201);
    const b = await request(app())
      .post("/api/targets")
      .send({ ...body, bindValue: "eth1" });
    expect((await request(app()).put(`/api/targets/${b.body.id}`).send(body)).status).toBe(409);
    expect(
      (
        await request(app())
          .put(`/api/targets/${a.body.id}`)
          .send({ ...body, label: "Renamed" })
      ).status,
    ).toBe(200);
  });
});

describe("workers", () => {
  const create = async (name = "Pi", site?: string) =>
    (await request(app()).post("/api/workers").send({ name, site })).body as { worker: WorkerDto; token: string };

  it("lists the local worker without secrets", async () => {
    const res = await request(app()).get("/api/workers");
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      name: "Local",
      kind: "local",
      status: "waiting",
      site: "default",
      enabled: true,
      targetCount: 0,
      interfaces: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(repos.workers.getLocal()?.secret ?? "?");
  });

  it("creates a worker and returns a pairing token once", async () => {
    const res = await request(app()).post("/api/workers").send({ name: "Garage Pi", site: "garage" });
    expect(res.status).toBe(201);
    expect(res.body.worker).toMatchObject({ name: "Garage Pi", site: "garage", kind: "remote", status: "waiting" });
    const parsed = parseToken(res.body.token);
    expect(parsed?.workerId).toBe(res.body.worker.id);
    expect(parsed?.secret).toBe(repos.workers.get(res.body.worker.id)?.secret);
    expect(JSON.stringify((await request(app()).get("/api/workers")).body)).not.toContain(parsed?.secret ?? "?");
  });

  it("defaults the site and validates input", async () => {
    expect((await create("A")).worker.site).toBe("default");
    expect((await request(app()).post("/api/workers").send({ name: "" })).status).toBe(400);
  });

  it("rejects duplicate names with 409", async () => {
    await create("Pi");
    expect((await request(app()).post("/api/workers").send({ name: "Pi" })).status).toBe(409);
    const other = await create("Pi2");
    expect((await request(app()).patch(`/api/workers/${other.worker.id}`).send({ name: "Pi" })).status).toBe(409);
    expect((await request(app()).patch(`/api/workers/${other.worker.id}`).send({ name: "Pi2" })).status).toBe(200);
  });

  it("renames, moves site, disables and reloads the dispatcher", async () => {
    const { worker } = await create();
    const res = await request(app()).patch(`/api/workers/${worker.id}`).send({ name: "New", site: "attic", enabled: false });
    expect(res.body).toMatchObject({ name: "New", site: "attic", enabled: false, status: "disabled" });
    expect(reloads).toBe(1);
    expect((await request(app()).patch("/api/workers/nope").send({ name: "x" })).status).toBe(404);
    expect((await request(app()).patch(`/api/workers/${worker.id}`).send({ site: "" })).status).toBe(400);
  });

  it("rotates a token (invalidating the old one) but not for the local worker", async () => {
    const { worker, token } = await create();
    const res = await request(app()).post(`/api/workers/${worker.id}/rotate-token`);
    expect(res.status).toBe(200);
    expect(res.body.token).not.toBe(token);
    expect(parseToken(res.body.token)?.secret).toBe(repos.workers.get(worker.id)?.secret);
    const local = repos.workers.getLocal()?.id;
    expect((await request(app()).post(`/api/workers/${local}/rotate-token`)).status).toBe(400);
    expect((await request(app()).post("/api/workers/nope/rotate-token")).status).toBe(404);
  });

  it("removes a worker with its targets but not the local worker", async () => {
    const { worker } = await create();
    await request(app())
      .post("/api/targets")
      .send({ ...body, workerId: worker.id });
    expect((await request(app()).get(`/api/targets?workerId=${worker.id}`)).body).toHaveLength(1);
    expect((await request(app()).delete(`/api/workers/${worker.id}`)).status).toBe(204);
    expect((await request(app()).get("/api/targets")).body).toHaveLength(0);
    expect((await request(app()).delete(`/api/workers/${repos.workers.getLocal()?.id}`)).status).toBe(400);
    expect((await request(app()).delete("/api/workers/nope")).status).toBe(404);
  });

  it("assigns targets to a worker, defaulting to the local one", async () => {
    const { worker } = await create();
    const a = await request(app()).post("/api/targets").send(body);
    expect(a.body.workerId).toBe(repos.workers.getLocal()?.id);
    const b = await request(app())
      .post("/api/targets")
      .send({ ...body, label: "B", bindValue: "eth1", workerId: worker.id });
    expect(b.body.workerId).toBe(worker.id);
    expect(
      (
        await request(app())
          .post("/api/targets")
          .send({ ...body, workerId: "nope" })
      ).status,
    ).toBe(400);
    const moved = await request(app())
      .put(`/api/targets/${a.body.id}`)
      .send({ ...body, workerId: worker.id });
    expect(moved.body.workerId).toBe(worker.id);
    expect(
      (
        await request(app())
          .put(`/api/targets/${a.body.id}`)
          .send({ ...body, workerId: "nope" })
      ).status,
    ).toBe(400);
    expect((await request(app()).get("/api/workers")).body.find((w: WorkerDto) => w.id === worker.id).targetCount).toBe(2);
  });

  it("shows a connected worker as online with machine info, then disconnects it on rotate", async () => {
    const { worker, token } = await create();
    const server = app().listen(0);
    hub.attach(server);
    const parsed = parseToken(token);
    const w = testWorker({ url: `ws://127.0.0.1:${portOf(server)}${WS_PATH}`, workerId: worker.id, secret: parsed?.secret ?? "" });
    try {
      await w.ready();
      w.send({ type: "interfaces", interfaces: [{ name: "eth0", addresses: [] }] });
      await until(() => repos.workers.get(worker.id)?.interfaces !== null);
      const dto = (await request(app()).get("/api/workers")).body.find((x: WorkerDto) => x.id === worker.id);
      expect(dto).toMatchObject({
        status: "online",
        machine: { hostname: "pi", workerVersion: "0.2.0" },
        engine: { name: "ookla", available: true },
        interfaces: [{ name: "eth0" }],
      });
      expect(dto.connectedSince).not.toBeNull();
      expect((await request(app()).post(`/api/workers/${worker.id}/refresh`)).body).toEqual({ requested: true });
      await request(app()).post(`/api/workers/${worker.id}/rotate-token`);
      await until(() => w.isClosed());
      expect((await request(app()).post(`/api/workers/${worker.id}/refresh`)).body).toEqual({ requested: false });
    } finally {
      w.ws.terminate();
      server.closeAllConnections();
      server.close();
    }
  });
});

describe("runs", () => {
  const seed = () => {
    const tg = repos.targets.create({
      workerId: repos.workers.getLocal()?.id ?? "",
      label: "A",
      bindType: "interface",
      bindValue: "eth0",
      intervalMinutes: 10,
      timeoutSeconds: 120,
      enabled: true,
    });
    for (const status of ["ok", "failed", "ok"] as const) {
      const id = repos.runs.start({
        workerId: repos.workers.getLocal()?.id ?? null,
        workerName: "Local",
        site: "default",
        targetId: tg.id,
        targetLabel: "A",
        bindType: "interface",
        bindValue: "eth0",
        attemptGroupId: "g",
        attemptNumber: 1,
        trigger: "schedule",
        engine: "ookla",
      });
      repos.runs.finish(
        id,
        status === "ok"
          ? { status, metrics: { ...emptyMetrics(), downloadBps: 1e8 }, rawJson: '{"x":1}' }
          : { status, errorMessage: "no net" },
      );
    }
    return tg;
  };

  it("lists with pagination, sorting and filtering, without raw json", async () => {
    const tg = seed();
    const res = await request(app()).get("/api/runs?pageSize=2&sortBy=downloadBps&sortDir=desc");
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.rows[0].rawJson).toBeUndefined();
    expect((await request(app()).get("/api/runs?status=failed")).body.rows[0]).toMatchObject({ errorMessage: "no net" });
    expect((await request(app()).get(`/api/runs?targetId=${tg.id + 1}`)).body.total).toBe(0);
  });

  it("rejects invalid queries", async () => {
    expect((await request(app()).get("/api/runs?sortBy=rawJson")).status).toBe(400);
    expect((await request(app()).get("/api/runs?pageSize=9999")).status).toBe(400);
  });

  it("returns run detail with parsed raw JSON", async () => {
    seed();
    const res = await request(app()).get("/api/runs/1");
    expect(res.body).toMatchObject({ id: 1, status: "ok", raw: { x: 1 } });
    expect(res.body.rawJson).toBeUndefined();
    expect((await request(app()).get("/api/runs/999")).status).toBe(404);
  });

  it("queues manual runs (nothing is queued while the worker is not connected)", async () => {
    const tg = seed();
    const res = await request(app()).post("/api/runs/run-now").send({ targetId: tg.id });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 0 });
    expect((await request(app()).post("/api/runs/run-now").send({})).status).toBe(202);
    expect((await request(app()).post("/api/runs/run-now").send({ targetId: 999 })).status).toBe(404);
    expect((await request(app()).post("/api/runs/run-now").send({ workerId: "nope" })).status).toBe(404);
    expect((await request(app()).post("/api/runs/run-now").send({ workerId: repos.workers.getLocal()?.id })).status).toBe(202);
  });

  it("filters runs by worker and site", async () => {
    seed();
    const local = repos.workers.getLocal()?.id;
    expect((await request(app()).get(`/api/runs?workerId=${local}`)).body.total).toBe(3);
    expect((await request(app()).get("/api/runs?workerId=other")).body.total).toBe(0);
    expect((await request(app()).get("/api/runs?site=default")).body.total).toBe(3);
    expect((await request(app()).get("/api/runs?site=nope")).body.total).toBe(0);
  });
});

describe("dashboard", () => {
  it("aggregates runs and validates the query", async () => {
    const local = repos.workers.getLocal()?.id ?? "";
    const tg = repos.targets.create({
      workerId: local,
      label: "A",
      bindType: "interface",
      bindValue: "eth0",
      intervalMinutes: 10,
      timeoutSeconds: 120,
      enabled: true,
    });
    const id = repos.runs.start({
      workerId: local,
      workerName: "Local",
      site: "default",
      targetId: tg.id,
      targetLabel: "A",
      bindType: "interface",
      bindValue: "eth0",
      attemptGroupId: "g",
      attemptNumber: 1,
      trigger: "schedule",
      engine: "ookla",
    });
    repos.runs.finish(id, { status: "ok", metrics: { ...emptyMetrics(), downloadBps: 1e8, downloadBytes: 10 } });
    const now = Date.now();
    const res = await request(app()).get(`/api/dashboard?from=${now - 3_600_000}&to=${now + 1000}&tzOffsetMin=60`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ tests: 1, ok: 1, downloadBytes: 10 });
    expect(res.body.targets).toHaveLength(1);
    expect(res.body.series[0].metrics.downloadBps.avg).toBe(1e8);
    const other = await request(app()).get(`/api/dashboard?from=${now - 3_600_000}&to=${now + 1000}&targetIds=${tg.id + 1}`);
    expect(other.body.summary.tests).toBe(0);
    expect((await request(app()).get(`/api/dashboard?from=${now}&to=${now - 1}`)).status).toBe(400);
    expect((await request(app()).get("/api/dashboard")).status).toBe(400);
    expect((await request(app()).get(`/api/dashboard?from=0&to=${now}`)).status).toBe(400);
    expect((await request(app()).get(`/api/dashboard?from=${now - 1000}&to=${now}&targetIds=a`)).status).toBe(400);
  });
});

describe("health & interfaces", () => {
  it("reports worker down and no engine before the local worker ever connected", async () => {
    const res = await request(app()).get("/api/health");
    expect(res.body).toEqual({ engine: null, worker: { alive: false, lastSeenAt: null, version: null } });
  });

  it("reports the local worker's engine status and version", async () => {
    const engine = { name: "ookla", available: false, version: null, hint: "install it" };
    const local = repos.workers.getLocal();
    repos.workers.markConnected(local?.id ?? "", {
      hostname: "h",
      platform: "p",
      arch: "a",
      osRelease: "r",
      nodeVersion: "v",
      workerVersion: "0.2.0",
      engine,
    });
    const res = await request(app()).get("/api/health");
    expect(res.body).toMatchObject({ engine, worker: { alive: false, version: "0.2.0" } });
  });

  it("lists the local worker's reported interfaces", async () => {
    expect((await request(app()).get("/api/interfaces")).body).toEqual([]);
    repos.workers.saveInterfaces(repos.workers.getLocal()?.id ?? "", [{ name: "eth0", addresses: [] }]);
    expect((await request(app()).get("/api/interfaces")).body[0]).toMatchObject({ name: "eth0" });
  });

  it("404s unknown api routes as json", async () => {
    const res = await request(app()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("static UI", () => {
  it("serves index.html with SPA fallback when a build exists", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkwatch-web-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html>ui</html>");
    const a = app(dir);
    expect((await request(a).get("/")).text).toContain("ui");
    expect((await request(a).get("/history/deep")).text).toContain("ui");
    expect((await request(a).get("/api/nope")).status).toBe(404);
  });
});

describe("SSE /api/events", () => {
  it("streams events emitted on the bus after connecting and cleans up on close", async () => {
    bus.emit({ type: "run_started", runId: 1, targetId: 1, payload: {} });
    const server = app().listen(0);
    const port = (server.address() as AddressInfo).port;
    const ac = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: ac.signal });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      bus.emit({ type: "run_progress", runId: 1, targetId: 1, payload: { phase: "download" } });
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let text = "";
      while (!text.includes("run_progress")) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) break;
        text += dec.decode(chunk.value);
      }
      expect(text).toContain("event: run");
      expect(text).toContain('"type":"run_progress"');
      expect(text).not.toContain("run_started");
      expect(bus.size).toBe(1);
    } finally {
      ac.abort();
      server.closeAllConnections();
      server.close();
    }
    await vi.waitFor(() => expect(bus.size).toBe(0));
  });
});

import type { AddressInfo } from "node:net";
import {
  encode,
  generateNonce,
  generateSecret,
  type MasterMessage,
  masterProof,
  parseWorkerMessage,
  proofsMatch,
  type WorkerMessage,
  workerProof,
} from "@linkwatch/protocol";
import { emptyMetrics } from "@linkwatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { EngineError, type EngineRunOptions, type EngineTarget, type SpeedTestEngine } from "../engine/types.js";
import { createWorkerClient } from "./client.js";

const WID = "w0123456789abcdef";
const secret = generateSecret();

interface Conn {
  ws: WebSocket;
  received: WorkerMessage[];
  send: (m: MasterMessage) => void;
}

/** Minimal master that performs the real handshake, so the client is tested against the protocol, not itself. */
async function fakeMaster(opts: { wrongSecret?: boolean; reject?: "bad_credentials" | "incompatible"; silent?: boolean } = {}) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.once("listening", r));
  const conns: Conn[] = [];
  wss.on("connection", (ws) => {
    const conn: Conn = { ws, received: [], send: (m) => ws.send(encode(m)) };
    conns.push(conn);
    let nonceW = "";
    const nonceM = generateNonce();
    ws.on("message", (d) => {
      const p = parseWorkerMessage(d as Buffer);
      if (!p.ok) return;
      conn.received.push(p.msg);
      if (p.msg.type === "hello") {
        if (opts.silent) return;
        nonceW = p.msg.nonce;
        if (opts.reject) return conn.send({ type: "reject", reason: opts.reject, message: "no" });
        conn.send({ type: "challenge", nonce: nonceM, proof: masterProof(opts.wrongSecret ? generateSecret() : secret, nonceW, nonceM) });
      } else if (p.msg.type === "auth") {
        if (proofsMatch(workerProof(secret, nonceW, nonceM), p.msg.proof)) conn.send({ type: "ready", workerId: WID, name: "Pi" });
        else conn.send({ type: "reject", reason: "bad_credentials", message: "no" });
      }
    });
  });
  const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/ws/worker`;
  return {
    url,
    conns,
    close: () =>
      new Promise<void>((r) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => r());
      }),
  };
}

const ok = { downloadBps: 1e8 };
function fakeEngine(
  run?: (
    t: EngineTarget,
    o: EngineRunOptions,
  ) => Promise<never | { metrics: ReturnType<typeof emptyMetrics>; engineVersion: string | null; raw: unknown }>,
): SpeedTestEngine {
  return {
    name: "fake",
    isAvailable: async () => ({ name: "fake", available: true, version: "9", hint: null }),
    run: run ?? (async () => ({ metrics: { ...emptyMetrics(), ...ok }, engineVersion: "9", raw: { r: 1 } })),
  };
}

const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const types = (c: Conn) => c.received.map((m) => m.type);

let master: Awaited<ReturnType<typeof fakeMaster>>;
let clients: Array<ReturnType<typeof createWorkerClient>> = [];
const make = (over: Partial<Parameters<typeof createWorkerClient>[0]> = {}) => {
  const c = createWorkerClient({
    masterUrl: master.url,
    workerId: WID,
    secret,
    engine: fakeEngine(),
    listInterfaces: () => [{ name: "eth0", addresses: [] }],
    backoff: { baseMs: 20, maxMs: 40, badCredentialsMaxMs: 60 },
    ...over,
  });
  clients.push(c);
  return c;
};

beforeEach(async () => {
  master = await fakeMaster();
});
afterEach(async () => {
  await Promise.all(clients.map((c) => c.stop()));
  clients = [];
  await master.close();
});

describe("handshake", () => {
  it("authenticates, reports interfaces and calls onPaired", async () => {
    const onPaired = vi.fn();
    const c = make({ onPaired });
    c.start();
    await until(() => c.state === "ready");
    await until(() => types(master.conns[0]).includes("interfaces"));
    expect(onPaired).toHaveBeenCalledWith({ name: "Pi" });
    const auth = master.conns[0].received.find((m) => m.type === "auth");
    expect(auth).toMatchObject({ type: "auth", info: { workerVersion: "0.2.0", engine: { available: true } } });
    expect(master.conns[0].received.find((m) => m.type === "interfaces")).toMatchObject({ interfaces: [{ name: "eth0" }] });
  });

  it("never sends the secret", async () => {
    const c = make();
    c.start();
    await until(() => c.state === "ready");
    expect(JSON.stringify(master.conns[0].received)).not.toContain(secret);
  });

  it("refuses a master that cannot prove the token", async () => {
    await master.close();
    master = await fakeMaster({ wrongSecret: true });
    const onPaired = vi.fn();
    const c = make({ onPaired });
    c.start();
    await until(() => master.conns.length >= 2);
    expect(onPaired).not.toHaveBeenCalled();
    expect(master.conns[0].received.some((m) => m.type === "auth")).toBe(false);
  });

  it("backs off and retries after a rejection", async () => {
    await master.close();
    master = await fakeMaster({ reject: "bad_credentials" });
    const log = vi.fn();
    const c = make({ log });
    c.start();
    await until(() => master.conns.length >= 3);
    expect(log.mock.calls.some(([m]) => String(m).includes("pairing invalid"))).toBe(true);
  });

  it("times out a master that never answers", async () => {
    await master.close();
    master = await fakeMaster({ silent: true });
    const c = make({ handshakeTimeoutMs: 100 });
    c.start();
    await until(() => master.conns.length >= 2);
    expect(c.state).not.toBe("ready");
  });
});

describe("running tests", () => {
  const run = { type: "run_test", runId: 7, target: { bindType: "interface", bindValue: "eth0" }, timeoutMs: 5000 } as const;

  it("runs a test and reports progress and result", async () => {
    const engine = fakeEngine(async (_t, o) => {
      o.onProgress?.({ phase: "download", progress: 0.5, value: 5e7 });
      return { metrics: { ...emptyMetrics(), downloadBps: 1e8 }, engineVersion: "9", raw: { r: 1 } };
    });
    const c = make({ engine });
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].send(run);
    await until(() => types(master.conns[0]).includes("result"));
    const msgs = master.conns[0].received;
    expect(msgs.find((m) => m.type === "progress")).toMatchObject({ runId: 7, phase: "download" });
    expect(msgs.find((m) => m.type === "result")).toMatchObject({
      runId: 7,
      metrics: { downloadBps: 1e8 },
      engine: { name: "fake", version: "9" },
    });
    expect(c.activeRunId).toBeNull();
  });

  it("maps engine errors to failures", async () => {
    const engine = fakeEngine(async () => {
      throw new EngineError("slow", "timeout", { exitCode: 1, stderr: "boom" });
    });
    const c = make({ engine });
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].send(run);
    await until(() => types(master.conns[0]).includes("failure"));
    expect(master.conns[0].received.find((m) => m.type === "failure")).toMatchObject({
      runId: 7,
      kind: "timeout",
      message: "slow",
      exitCode: 1,
      stderr: "boom",
    });
  });

  it("maps unexpected errors to a 'failed' failure", async () => {
    const c = make({
      engine: fakeEngine(async () => {
        throw new Error("kaput");
      }),
    });
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].send(run);
    await until(() => types(master.conns[0]).includes("failure"));
    expect(master.conns[0].received.find((m) => m.type === "failure")).toMatchObject({ kind: "failed", message: "kaput" });
  });

  it("rejects a second test while busy and supports abort", async () => {
    const engine = fakeEngine(
      (_t, o) =>
        new Promise((_res, rej) => {
          o.signal?.addEventListener("abort", () => rej(new EngineError("aborted", "aborted")));
        }),
    );
    const c = make({ engine });
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].send(run);
    await until(() => c.activeRunId === 7);
    master.conns[0].send({ ...run, runId: 8 });
    await until(() => master.conns[0].received.some((m) => m.type === "failure" && m.runId === 8));
    expect(master.conns[0].received.find((m) => m.type === "failure" && m.runId === 8)).toMatchObject({ kind: "busy" });
    master.conns[0].send({ type: "abort", runId: 99 });
    await new Promise((r) => setTimeout(r, 50));
    expect(c.activeRunId).toBe(7);
    master.conns[0].send({ type: "abort", runId: 7 });
    await until(() => master.conns[0].received.some((m) => m.type === "failure" && m.runId === 7));
    expect(master.conns[0].received.find((m) => m.type === "failure" && m.runId === 7)).toMatchObject({ kind: "aborted" });
  });

  it("aborts a running test when the connection drops, then reconnects", async () => {
    let aborted = false;
    const engine = fakeEngine(
      (_t, o) =>
        new Promise((_res, rej) => {
          o.signal?.addEventListener("abort", () => {
            aborted = true;
            rej(new EngineError("aborted", "aborted"));
          });
        }),
    );
    const c = make({ engine });
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].send(run);
    await until(() => c.activeRunId === 7);
    master.conns[0].ws.terminate();
    await until(() => aborted);
    await until(() => master.conns.length === 2 && c.state === "ready");
    expect(c.activeRunId).toBeNull();
  });
});

describe("liveness and requests", () => {
  it("answers ping with pong", async () => {
    const c = make();
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].send({ type: "ping", t: 42 });
    await until(() => master.conns[0].received.some((m) => m.type === "pong"));
    expect(master.conns[0].received.find((m) => m.type === "pong")).toEqual({ type: "pong", t: 42 });
  });

  it("answers request_interfaces and request_status", async () => {
    const c = make();
    c.start();
    await until(() => c.state === "ready");
    await until(() => types(master.conns[0]).includes("interfaces"));
    const before = types(master.conns[0]).filter((t) => t === "interfaces").length;
    master.conns[0].send({ type: "request_interfaces" });
    master.conns[0].send({ type: "request_status" });
    await until(
      () => types(master.conns[0]).filter((t) => t === "interfaces").length > before && types(master.conns[0]).includes("status"),
    );
  });

  it("reconnects when the master goes silent", async () => {
    const c = make({ idleTimeoutMs: 150 });
    c.start();
    await until(() => c.state === "ready");
    await until(() => master.conns.length >= 2, 4000);
  });

  it("reconnects after the master closes the socket", async () => {
    const c = make();
    c.start();
    await until(() => c.state === "ready");
    master.conns[0].ws.close();
    await until(() => master.conns.length === 2 && c.state === "ready");
  });

  it("stop() closes the connection and does not reconnect", async () => {
    const c = make();
    c.start();
    await until(() => c.state === "ready");
    await c.stop();
    expect(c.state).toBe("stopped");
    await new Promise((r) => setTimeout(r, 150));
    expect(master.conns).toHaveLength(1);
  });
});

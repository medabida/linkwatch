import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Repos } from "@linkwatch/db";
import {
  CLOSE_DISABLED,
  CLOSE_PONG_TIMEOUT,
  CLOSE_REJECTED,
  CLOSE_REPLACED,
  encode,
  generateNonce,
  generateSecret,
  HANDSHAKE_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  type MasterMessage,
  masterProof,
  OFFLINE_GRACE_MS,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  PROTOCOL_VERSION,
  parseWorkerMessage,
  proofsMatch,
  type RejectReason,
  type TestFailureKind,
  WATCHDOG_MARGIN_MS,
  type WorkerInfo,
  type WorkerMessage,
  WS_PATH,
  workerProof,
} from "@linkwatch/protocol";
import type { EnginePhase, RunMetrics, WorkerStatus } from "@linkwatch/shared";
import { WebSocket, WebSocketServer } from "ws";

export type TestOutcome =
  | { ok: true; metrics: RunMetrics; raw: unknown; engine: { name: string; version: string | null } }
  | { ok: false; kind: TestFailureKind; message: string; exitCode?: number | null; stderr?: string; stdout?: string };

export interface RunTestRequest {
  workerId: string;
  runId: number;
  target: { bindType: "interface" | "ip"; bindValue: string };
  timeoutMs: number;
  onProgress?: (p: { phase: EnginePhase; progress?: number; value?: number }) => void;
  signal?: AbortSignal;
}

export interface HubOptions {
  repos: Repos;
  log?: (msg: string) => void;
  now?: () => number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  offlineGraceMs?: number;
  watchdogMarginMs?: number;
  /** failed handshakes allowed per IP within `throttleWindowMs` */
  maxFailures?: number;
  throttleWindowMs?: number;
}

interface Conn {
  id: string;
  ws: WebSocket;
  connectedAt: number;
  rttMs: number | null;
  lastPong: number;
  pingTimer: NodeJS.Timeout;
  pending: Map<number, Pending>;
  version: number;
}

interface Pending {
  req: RunTestRequest;
  resolve: (o: TestOutcome) => void;
  watchdog: NodeJS.Timeout;
  onAbort?: () => void;
}

const FAIL_TEXT: Record<TestFailureKind, string> = {
  timeout: "Speed test timed out",
  failed: "Speed test failed",
  unavailable: "Speed test engine unavailable on the worker",
  aborted: "Speed test aborted",
  busy: "Worker is busy with another test",
  offline: "Worker offline",
  lost: "Worker connection lost during the test",
  unresponsive: "Worker unresponsive: no answer after the test timeout",
  disabled: "Worker is disabled",
};
export const failureText = (kind: TestFailureKind) => FAIL_TEXT[kind];

export function createWorkerHub(opts: HubOptions) {
  const {
    repos,
    log = () => {},
    now = Date.now,
    pingIntervalMs = PING_INTERVAL_MS,
    pongTimeoutMs = PONG_TIMEOUT_MS,
    handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
    offlineGraceMs = OFFLINE_GRACE_MS,
    watchdogMarginMs = WATCHDOG_MARGIN_MS,
    maxFailures = 10,
    throttleWindowMs = 60_000,
  } = opts;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const conns = new Map<string, Conn>();
  const disconnectedAt = new Map<string, number>();
  const incompatible = new Map<string, string>();
  const failures = new Map<string, { count: number; resetAt: number }>();
  const connectedListeners = new Set<(workerId: string) => void>();
  const changeListeners = new Set<(workerId: string) => void>();
  const dummySecret = generateSecret();

  const sendTo = (ws: WebSocket, msg: MasterMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
  };
  const changed = (id: string) => {
    for (const l of changeListeners) l(id);
  };

  function throttled(ip: string): boolean {
    const f = failures.get(ip);
    if (!f) return false;
    if (now() > f.resetAt) {
      failures.delete(ip);
      return false;
    }
    return f.count >= maxFailures;
  }
  function recordFailure(ip: string) {
    const f = failures.get(ip);
    if (!f || now() > f.resetAt) failures.set(ip, { count: 1, resetAt: now() + throttleWindowMs });
    else f.count++;
  }

  function resolvePending(conn: Conn, runId: number, outcome: TestOutcome) {
    const p = conn.pending.get(runId);
    if (!p) return;
    conn.pending.delete(runId);
    clearTimeout(p.watchdog);
    p.onAbort?.();
    p.resolve(outcome);
  }

  function onClosed(conn: Conn) {
    clearInterval(conn.pingTimer);
    for (const runId of [...conn.pending.keys()]) resolvePending(conn, runId, { ok: false, kind: "lost", message: FAIL_TEXT.lost });
    if (conns.get(conn.id) === conn) {
      conns.delete(conn.id);
      disconnectedAt.set(conn.id, now());
      repos.workers.touch(conn.id);
      log(`worker ${conn.id} disconnected`);
      changed(conn.id);
    }
  }

  function establish(ws: WebSocket, id: string, info: WorkerInfo, version: number) {
    const existing = conns.get(id);
    if (existing) {
      conns.delete(id);
      existing.ws.close(CLOSE_REPLACED, "replaced by a newer connection");
      onClosed(existing);
    }
    const conn: Conn = {
      id,
      ws,
      connectedAt: now(),
      rttMs: null,
      lastPong: now(),
      pending: new Map(),
      version,
      pingTimer: setInterval(() => {
        if (now() - conn.lastPong > pongTimeoutMs) {
          log(`worker ${id}: no pong, closing`);
          ws.close(CLOSE_PONG_TIMEOUT, "pong timeout");
          setTimeout(() => ws.terminate(), 1000).unref();
          clearInterval(conn.pingTimer);
          return;
        }
        sendTo(ws, { type: "ping", t: now() });
      }, pingIntervalMs),
    };
    conns.set(id, conn);
    disconnectedAt.delete(id);
    incompatible.delete(id);
    repos.workers.markConnected(id, info);
    log(`worker ${id} connected`);
    return conn;
  }

  function handleConnection(ws: WebSocket, req: IncomingMessage) {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (throttled(ip)) {
      sendTo(ws, { type: "reject", reason: "throttled", message: "too many failed attempts" });
      ws.close(CLOSE_REJECTED, "throttled");
      return;
    }
    const nonceM = generateNonce();
    let stage: "hello" | "auth" | "ready" = "hello";
    let workerId = "";
    let nonceW = "";
    let protocol = 0;
    let conn: Conn | null = null;
    const reject = (reason: RejectReason, message: string, countFailure = false) => {
      if (countFailure) recordFailure(ip);
      sendTo(ws, { type: "reject", reason, message });
      ws.close(CLOSE_REJECTED, reason);
    };
    const hsTimer = setTimeout(() => ws.terminate(), handshakeTimeoutMs);

    ws.on("message", (data) => {
      const parsed = parseWorkerMessage(data as Buffer);
      if (!parsed.ok) {
        if (stage !== "ready") recordFailure(ip);
        ws.close(1008, "invalid message");
        return;
      }
      const msg: WorkerMessage = parsed.msg;
      if (stage === "hello") {
        if (msg.type !== "hello") return ws.close(1008, "expected hello");
        workerId = msg.workerId;
        nonceW = msg.nonce;
        protocol = msg.protocol;
        const worker = repos.workers.get(workerId);
        sendTo(ws, { type: "challenge", nonce: nonceM, proof: masterProof(worker?.secret ?? dummySecret, nonceW, nonceM) });
        stage = "auth";
        return;
      }
      if (stage === "auth") {
        if (msg.type !== "auth") return ws.close(1008, "expected auth");
        const worker = repos.workers.get(workerId);
        const valid = proofsMatch(workerProof(worker?.secret ?? dummySecret, nonceW, nonceM), msg.proof);
        if (!worker || !valid) return reject("bad_credentials", "authentication failed", true);
        if (protocol !== PROTOCOL_VERSION) {
          incompatible.set(workerId, `worker speaks protocol ${protocol}, master expects ${PROTOCOL_VERSION}`);
          repos.workers.markConnected(workerId, msg.info);
          changed(workerId);
          return reject("incompatible", `protocol ${protocol} is not supported (master uses ${PROTOCOL_VERSION}); update the worker`);
        }
        if (!worker.enabled) return reject("disabled", "this worker is disabled");
        clearTimeout(hsTimer);
        conn = establish(ws, workerId, msg.info, protocol);
        stage = "ready";
        sendTo(ws, { type: "ready", workerId, name: worker.name });
        for (const l of connectedListeners) l(workerId);
        changed(workerId);
        return;
      }
      if (!conn || conns.get(conn.id) !== conn) return;
      switch (msg.type) {
        case "pong":
          conn.lastPong = now();
          conn.rttMs = Math.max(0, now() - msg.t);
          break;
        case "interfaces":
          repos.workers.saveInterfaces(conn.id, msg.interfaces);
          changed(conn.id);
          break;
        case "status":
          repos.workers.saveInfo(conn.id, msg.info);
          changed(conn.id);
          break;
        case "progress":
          conn.pending.get(msg.runId)?.req.onProgress?.({ phase: msg.phase, progress: msg.progress, value: msg.value });
          break;
        case "result":
          resolvePending(conn, msg.runId, { ok: true, metrics: msg.metrics, raw: msg.raw, engine: msg.engine });
          break;
        case "failure":
          resolvePending(conn, msg.runId, {
            ok: false,
            kind: msg.kind,
            message: msg.message,
            exitCode: msg.exitCode,
            stderr: msg.stderr,
            stdout: msg.stdout,
          });
          break;
        default:
          break;
      }
    });
    ws.on("close", () => {
      clearTimeout(hsTimer);
      if (conn) onClosed(conn);
    });
    ws.on("error", () => ws.terminate());
  }

  wss.on("connection", handleConnection);

  return {
    /** Handles upgrade requests for the worker endpoint on an existing HTTP server. */
    attach(server: Server) {
      server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const path = (req.url ?? "").split("?")[0];
        if (path !== WS_PATH) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      });
    },
    /** Test seam: hand a raw WebSocket to the hub. */
    handleConnection,
    isConnected: (id: string) => conns.has(id),
    connectedIds: () => [...conns.keys()],
    connection(id: string) {
      const c = conns.get(id);
      return c ? { connectedSince: c.connectedAt, rttMs: c.rttMs, protocol: c.version } : null;
    },
    statusOf(id: string): { status: WorkerStatus; detail: string | null } {
      const w = repos.workers.get(id);
      if (!w) return { status: "offline", detail: null };
      if (!w.enabled) return { status: "disabled", detail: null };
      if (conns.has(id)) return { status: "online", detail: null };
      const inc = incompatible.get(id);
      if (inc) return { status: "incompatible", detail: inc };
      if (w.lastConnectedAt === null) return { status: "waiting", detail: "never connected yet" };
      const since = disconnectedAt.get(id);
      if (since !== undefined && now() - since <= offlineGraceMs) return { status: "reconnecting", detail: null };
      return { status: "offline", detail: null };
    },
    onConnected(fn: (workerId: string) => void) {
      connectedListeners.add(fn);
      return () => connectedListeners.delete(fn);
    },
    onChange(fn: (workerId: string) => void) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    runTest(req: RunTestRequest): Promise<TestOutcome> {
      const conn = conns.get(req.workerId);
      if (!conn) return Promise.resolve({ ok: false, kind: "offline", message: FAIL_TEXT.offline });
      return new Promise<TestOutcome>((resolve) => {
        const pending: Pending = {
          req,
          resolve,
          watchdog: setTimeout(() => {
            sendTo(conn.ws, { type: "abort", runId: req.runId });
            resolvePending(conn, req.runId, { ok: false, kind: "unresponsive", message: FAIL_TEXT.unresponsive });
          }, req.timeoutMs + watchdogMarginMs),
        };
        if (req.signal) {
          const onAbort = () => sendTo(conn.ws, { type: "abort", runId: req.runId });
          if (req.signal.aborted) onAbort();
          else {
            req.signal.addEventListener("abort", onAbort, { once: true });
            pending.onAbort = () => req.signal?.removeEventListener("abort", onAbort);
          }
        }
        conn.pending.set(req.runId, pending);
        sendTo(conn.ws, { type: "run_test", runId: req.runId, target: req.target, timeoutMs: req.timeoutMs });
      });
    },
    requestInterfaces(id: string): boolean {
      const c = conns.get(id);
      if (c) sendTo(c.ws, { type: "request_interfaces" });
      return !!c;
    },
    requestStatus(id: string): boolean {
      const c = conns.get(id);
      if (c) sendTo(c.ws, { type: "request_status" });
      return !!c;
    },
    /** Closes a worker's connection (rotate / disable / remove). */
    disconnect(id: string, code = CLOSE_DISABLED, reason = "disconnected by master") {
      const c = conns.get(id);
      if (!c) return;
      c.ws.close(code, reason);
      onClosed(c);
    },
    async close() {
      for (const c of [...conns.values()]) {
        c.ws.close(1001, "master shutting down");
        onClosed(c);
      }
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}

export type WorkerHub = ReturnType<typeof createWorkerHub>;

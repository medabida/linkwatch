import {
  encode,
  generateNonce,
  MAX_MESSAGE_BYTES,
  type MasterMessage,
  masterProof,
  PONG_TIMEOUT_MS,
  PROTOCOL_VERSION,
  parseMasterMessage,
  proofsMatch,
  type RejectReason,
  type TestFailureKind,
  type WorkerMessage,
  workerProof,
} from "@linkwatch/protocol";
import type { EngineStatus, NetworkInterfaceDto } from "@linkwatch/shared";
import WebSocket from "ws";
import { EngineError, type SpeedTestEngine } from "../engine/types.js";
import { backoffDelay } from "./backoff.js";
import { buildInfo } from "./info.js";
import { startInterfaceWatcher } from "./interfaces.js";

export interface WorkerClientOptions {
  masterUrl: string;
  workerId: string;
  secret: string;
  engine: SpeedTestEngine;
  listInterfaces?: () => NetworkInterfaceDto[];
  log?: (msg: string) => void;
  /** called after every successful handshake */
  onPaired?: (info: { name: string }) => void;
  /** no message from the master for this long = dead link */
  idleTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  backoff?: { baseMs?: number; maxMs?: number; badCredentialsMaxMs?: number };
  interfacePollMs?: number;
  interfaceResyncMs?: number;
  progressThrottleMs?: number;
}

export type ClientState = "idle" | "connecting" | "handshaking" | "ready" | "stopped";

const MAX_OUTPUT = 50_000;

export function createWorkerClient(opts: WorkerClientOptions) {
  const {
    masterUrl,
    workerId,
    secret,
    engine,
    listInterfaces,
    log = () => {},
    idleTimeoutMs = PONG_TIMEOUT_MS + 5_000,
    handshakeTimeoutMs = 10_000,
    progressThrottleMs = 500,
  } = opts;

  let state: ClientState = "idle";
  let ws: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let handshakeTimer: NodeJS.Timeout | undefined;
  let watcher: ReturnType<typeof startInterfaceWatcher> | null = null;
  let rejected: RejectReason | null = null;
  let active: { runId: number; abort: AbortController } | null = null;
  let engineStatus: EngineStatus = { name: engine.name, available: false, version: null, hint: "not checked yet" };

  const send = (sock: WebSocket, msg: WorkerMessage) => {
    if (sock.readyState === WebSocket.OPEN) sock.send(encode(msg));
  };
  const sendReady = (msg: WorkerMessage) => {
    if (state === "ready" && ws) send(ws, msg);
  };

  const refreshEngine = async () => {
    engineStatus = await engine.isAvailable();
    return engineStatus;
  };

  function armIdle(sock: WebSocket) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      log("master went silent, reconnecting");
      sock.terminate();
    }, idleTimeoutMs);
  }

  function scheduleReconnect() {
    if (state === "stopped") return;
    const b = opts.backoff ?? {};
    const maxMs = rejected === "bad_credentials" ? (b.badCredentialsMaxMs ?? 60_000) : (b.maxMs ?? 30_000);
    const delay = backoffDelay(attempt, { baseMs: b.baseMs, maxMs });
    attempt++;
    state = "idle";
    log(`reconnecting in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(connect, delay);
  }

  function onClosed() {
    clearTimeout(idleTimer);
    clearTimeout(handshakeTimer);
    watcher?.stop();
    watcher = null;
    if (active) {
      log(`connection lost, aborting run ${active.runId}`);
      active.abort.abort();
    }
    ws = null;
    scheduleReconnect();
  }

  async function sendStatus(sock: WebSocket) {
    await refreshEngine();
    send(sock, { type: "status", info: buildInfo(engineStatus) });
  }

  async function handleRunTest(sock: WebSocket, msg: Extract<MasterMessage, { type: "run_test" }>) {
    const fail = (kind: TestFailureKind, message: string, extra: { exitCode?: number | null; stderr?: string; stdout?: string } = {}) =>
      send(sock, { type: "failure", runId: msg.runId, kind, message, ...extra });
    if (active) return fail("busy", `already running test ${active.runId}`);
    const abort = new AbortController();
    active = { runId: msg.runId, abort };
    let lastPhase = "";
    let lastEmit = 0;
    try {
      const res = await engine.run(msg.target, {
        timeoutMs: msg.timeoutMs,
        signal: abort.signal,
        onProgress: (p) => {
          const t = Date.now();
          if (p.phase === lastPhase && t - lastEmit < progressThrottleMs) return;
          lastPhase = p.phase;
          lastEmit = t;
          send(sock, { type: "progress", runId: msg.runId, phase: p.phase, progress: p.progress, value: p.value });
        },
      });
      send(sock, {
        type: "result",
        runId: msg.runId,
        metrics: res.metrics,
        raw: res.raw,
        engine: { name: engine.name, version: res.engineVersion },
      });
    } catch (e) {
      const err = e instanceof EngineError ? e : new EngineError(e instanceof Error ? e.message : String(e), "failed");
      fail(err.kind, err.message, {
        exitCode: err.details.exitCode ?? null,
        stderr: err.details.stderr?.slice(-MAX_OUTPUT),
        stdout: err.details.stdout?.slice(-MAX_OUTPUT),
      });
    } finally {
      active = null;
    }
  }

  function connect() {
    if (state === "stopped") return;
    state = "connecting";
    rejected = null;
    const sock = new WebSocket(masterUrl, { maxPayload: MAX_MESSAGE_BYTES, handshakeTimeout: handshakeTimeoutMs });
    ws = sock;
    const nonceW = generateNonce();
    let nonceM = "";
    let closed = false;
    const closeOnce = () => {
      if (closed) return;
      closed = true;
      onClosed();
    };

    sock.on("open", () => {
      state = "handshaking";
      send(sock, { type: "hello", protocol: PROTOCOL_VERSION, workerId, nonce: nonceW });
      handshakeTimer = setTimeout(() => {
        log("handshake timed out");
        sock.terminate();
      }, handshakeTimeoutMs);
      armIdle(sock);
    });

    sock.on("message", (data) => {
      armIdle(sock);
      const parsed = parseMasterMessage(data as Buffer);
      if (!parsed.ok) {
        log(`invalid message from master: ${parsed.error}`);
        sock.close(1008, "invalid message");
        return;
      }
      const msg = parsed.msg;
      if (state === "handshaking") {
        if (msg.type === "challenge") {
          if (!proofsMatch(masterProof(secret, nonceW, msg.nonce), msg.proof)) {
            log("master failed to prove it knows the token; refusing (wrong master or token?)");
            rejected = "bad_credentials";
            sock.close(1008, "master proof invalid");
            return;
          }
          nonceM = msg.nonce;
          void refreshEngine().then(() =>
            send(sock, { type: "auth", proof: workerProof(secret, nonceW, nonceM), info: buildInfo(engineStatus) }),
          );
        } else if (msg.type === "ready") {
          clearTimeout(handshakeTimer);
          state = "ready";
          attempt = 0;
          log(`connected to master as "${msg.name}"`);
          opts.onPaired?.({ name: msg.name });
          watcher = startInterfaceWatcher({
            list: listInterfaces,
            onReport: (interfaces) => sendReady({ type: "interfaces", interfaces }),
            pollMs: opts.interfacePollMs,
            resyncMs: opts.interfaceResyncMs,
          });
        } else if (msg.type === "reject") {
          rejected = msg.reason;
          log(
            msg.reason === "bad_credentials"
              ? "pairing invalid, re-pair this worker (copy a fresh command from the Workers page)"
              : `master rejected the connection: ${msg.reason} (${msg.message})`,
          );
          sock.close();
        } else {
          sock.close(1008, "unexpected message");
        }
        return;
      }
      if (state !== "ready") return;
      switch (msg.type) {
        case "ping":
          send(sock, { type: "pong", t: msg.t });
          break;
        case "request_interfaces":
          watcher?.report();
          break;
        case "request_status":
          void sendStatus(sock);
          break;
        case "run_test":
          void handleRunTest(sock, msg);
          break;
        case "abort":
          if (active?.runId === msg.runId) active.abort.abort();
          break;
        default:
          break;
      }
    });

    sock.on("close", closeOnce);
    sock.on("error", (e) => {
      log(`connection error: ${e.message}`);
      closeOnce();
    });
  }

  return {
    start() {
      if (state === "stopped") state = "idle";
      attempt = 0;
      connect();
    },
    async stop() {
      state = "stopped";
      clearTimeout(reconnectTimer);
      clearTimeout(idleTimer);
      clearTimeout(handshakeTimer);
      watcher?.stop();
      active?.abort.abort();
      const sock = ws;
      if (sock && sock.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve) => {
          sock.once("close", () => resolve());
          sock.close(1000, "worker stopping");
          setTimeout(() => {
            sock.terminate();
            resolve();
          }, 1000).unref();
        });
      }
    },
    get state() {
      return state;
    },
    get activeRunId() {
      return active?.runId ?? null;
    },
  };
}

export type WorkerClient = ReturnType<typeof createWorkerClient>;

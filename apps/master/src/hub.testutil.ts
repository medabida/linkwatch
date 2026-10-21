import type { AddressInfo } from "node:net";
import {
  encode,
  generateNonce,
  type MasterMessage,
  masterProof,
  PROTOCOL_VERSION,
  parseMasterMessage,
  proofsMatch,
  type WorkerInfo,
  type WorkerMessage,
  workerProof,
} from "@linkwatch/protocol";
import WebSocket from "ws";

export const info: WorkerInfo = {
  hostname: "pi",
  platform: "linux",
  arch: "arm64",
  osRelease: "6.1",
  nodeVersion: "v24.0.0",
  workerVersion: "0.2.0",
  engine: { name: "ookla", available: true, version: "1.2.0", hint: null },
};

export const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

export interface TestWorkerOptions {
  url: string;
  workerId: string;
  secret: string;
  protocol?: number;
  autoPong?: boolean;
  /** stop after sending hello (never answers the challenge) */
  stallAfterHello?: boolean;
}

/** A hand-rolled worker speaking the protocol, so the hub is tested against the wire format. */
export function testWorker(o: TestWorkerOptions) {
  const ws = new WebSocket(o.url);
  const received: MasterMessage[] = [];
  const closed: { code?: number } = {};
  let masterProofOk: boolean | null = null;
  const nonceW = generateNonce();
  const send = (m: WorkerMessage) => ws.send(encode(m));
  ws.on("open", () => send({ type: "hello", protocol: o.protocol ?? PROTOCOL_VERSION, workerId: o.workerId, nonce: nonceW }));
  ws.on("message", (d) => {
    const p = parseMasterMessage(d as Buffer);
    if (!p.ok) return;
    received.push(p.msg);
    const m = p.msg;
    if (m.type === "challenge" && !o.stallAfterHello) {
      masterProofOk = proofsMatch(masterProof(o.secret, nonceW, m.nonce), m.proof);
      send({ type: "auth", proof: workerProof(o.secret, nonceW, m.nonce), info });
    } else if (m.type === "ping" && o.autoPong !== false) {
      send({ type: "pong", t: m.t });
    }
  });
  ws.on("close", (code) => {
    closed.code = code;
  });
  ws.on("error", () => {});
  return {
    ws,
    received,
    send,
    closed,
    get masterProofOk() {
      return masterProofOk;
    },
    types: () => received.map((m) => m.type),
    last: <T extends MasterMessage["type"]>(t: T) =>
      [...received].reverse().find((m) => m.type === t) as Extract<MasterMessage, { type: T }> | undefined,
    isClosed: () => ws.readyState === WebSocket.CLOSED,
    ready: () => until(() => received.some((m) => m.type === "ready" || m.type === "reject")),
    close: () => ws.close(),
  };
}

export type TestWorker = ReturnType<typeof testWorker>;

export const portOf = (server: import("node:http").Server) => (server.address() as AddressInfo).port;

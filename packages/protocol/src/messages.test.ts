import { emptyMetrics } from "@linkwatch/shared";
import { describe, expect, it } from "vitest";
import { encode, parseMasterMessage, parseWorkerMessage } from "./messages.js";

const info = {
  hostname: "h",
  platform: "linux",
  arch: "arm64",
  osRelease: "6.1",
  nodeVersion: "v24.0.0",
  workerVersion: "0.2.0",
  engine: { name: "ookla", available: true, version: "1.2.0", hint: null },
};
const hex = "a".repeat(64);
const nonce = "n".repeat(32);

describe("worker -> master messages", () => {
  const valid = [
    { type: "hello", protocol: 1, workerId: "w1", nonce },
    { type: "auth", proof: hex, info },
    { type: "interfaces", interfaces: [{ name: "eth0", addresses: [{ address: "10.0.0.2", family: "IPv4", internal: false }] }] },
    { type: "status", info },
    { type: "progress", runId: 3, phase: "download", progress: 0.5, value: 1e8 },
    { type: "result", runId: 3, metrics: emptyMetrics(), raw: { a: 1 }, engine: { name: "ookla", version: "1.2.0" } },
    { type: "failure", runId: 3, kind: "timeout", message: "slow", exitCode: null, stderr: "x" },
    { type: "pong", t: 123 },
  ];
  it.each(valid)("accepts %j", (m) => {
    expect(parseWorkerMessage(JSON.stringify(m))).toEqual({ ok: true, msg: m });
  });

  it("rejects unknown types, bad JSON and bad fields", () => {
    expect(parseWorkerMessage("{nope").ok).toBe(false);
    expect(parseWorkerMessage({ type: "evil" }).ok).toBe(false);
    expect(parseWorkerMessage({ type: "progress", runId: -1, phase: "download" }).ok).toBe(false);
    expect(parseWorkerMessage({ type: "progress", runId: 1, phase: "bogus" }).ok).toBe(false);
    expect(parseWorkerMessage({ type: "auth", proof: "short", info }).ok).toBe(false);
    expect(parseWorkerMessage({ type: "failure", runId: 1, kind: "nuked", message: "x" }).ok).toBe(false);
  });

  it("rejects incomplete metrics", () => {
    const { downloadBps: _omit, ...partial } = emptyMetrics();
    expect(parseWorkerMessage({ type: "result", runId: 1, metrics: partial, raw: null, engine: { name: "o", version: null } }).ok).toBe(
      false,
    );
  });

  it("accepts Buffers (as delivered by ws)", () => {
    expect(parseWorkerMessage(Buffer.from(JSON.stringify({ type: "pong", t: 1 }))).ok).toBe(true);
  });

  it("reports which field is wrong", () => {
    const r = parseWorkerMessage({ type: "hello", protocol: "one", workerId: "w", nonce });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("protocol");
  });
});

describe("master -> worker messages", () => {
  const valid = [
    { type: "challenge", nonce, proof: hex },
    { type: "ready", workerId: "w1", name: "Pi" },
    { type: "reject", reason: "bad_credentials", message: "nope" },
    { type: "run_test", runId: 9, target: { bindType: "interface", bindValue: "eth0" }, timeoutMs: 120000 },
    { type: "abort", runId: 9 },
    { type: "ping", t: 5 },
    { type: "request_interfaces" },
    { type: "request_status" },
  ];
  it.each(valid)("accepts %j", (m) => {
    expect(parseMasterMessage(encode(m as never))).toEqual({ ok: true, msg: m });
  });

  it("rejects bad run_test requests", () => {
    expect(parseMasterMessage({ type: "run_test", runId: 1, target: { bindType: "mac", bindValue: "x" }, timeoutMs: 1 }).ok).toBe(false);
    expect(parseMasterMessage({ type: "run_test", runId: 1, target: { bindType: "ip", bindValue: "" }, timeoutMs: 1 }).ok).toBe(false);
    expect(parseMasterMessage({ type: "run_test", runId: 1, target: { bindType: "ip", bindValue: "1.1.1.1" }, timeoutMs: 0 }).ok).toBe(
      false,
    );
    expect(parseMasterMessage({ type: "reject", reason: "because", message: "" }).ok).toBe(false);
  });

  it("does not accept worker-only messages", () => {
    expect(parseMasterMessage({ type: "pong", t: 1 }).ok).toBe(false);
    expect(parseWorkerMessage({ type: "ping", t: 1 }).ok).toBe(false);
  });
});

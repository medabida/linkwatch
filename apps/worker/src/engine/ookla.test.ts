import { describe, expect, it, vi } from "vitest";
import { OOKLA_RESULT } from "./fixtures.js";
import { OoklaEngine, parseOoklaProgress, parseOoklaResult } from "./ookla.js";
import type { ProcessResult, ProcessRunner } from "./process.js";
import { EngineError } from "./types.js";

const ok = (over: Partial<ProcessResult> = {}): ProcessResult => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, ...over });

function fakeRunner(lines: unknown[], over: Partial<ProcessResult> = {}): ProcessRunner & ReturnType<typeof vi.fn> {
  return vi.fn(async (_c: string, _a: string[], opts) => {
    const out = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l)));
    for (const l of out) opts.onStdoutLine?.(l);
    return ok({ stdout: out.join("\n"), ...over });
  }) as never;
}

const target = { bindType: "interface" as const, bindValue: "eth0" };

describe("parseOoklaResult", () => {
  it("maps every field and converts bytes/s to bits/s", () => {
    const m = parseOoklaResult(OOKLA_RESULT);
    expect(m.downloadBps).toBe(95_000_000);
    expect(m.uploadBps).toBe(20_000_000);
    expect(m).toMatchObject({
      pingMs: 12.4,
      pingJitterMs: 0.8,
      pingLowMs: 11.1,
      pingHighMs: 15.2,
      packetLoss: 0.5,
      downloadBytes: 140_000_000,
      downloadElapsedMs: 14_000,
      downloadLatencyIqmMs: 30.1,
      downloadLatencyJitterMs: 5.5,
      uploadLatencyHighMs: 90.1,
      serverId: "1234",
      serverName: "Example",
      serverLocation: "Berlin",
      serverCountry: "Germany",
      serverHost: "speed.example.com",
      serverIp: "198.51.100.1",
      externalIp: "203.0.113.7",
      internalIp: "192.168.1.10",
      interfaceName: "eth0",
      interfaceMac: "AA:BB:CC:DD:EE:FF",
      isVpn: false,
      isp: "Example ISP",
      resultId: "abc-123",
    });
  });

  it("tolerates missing sections", () => {
    const m = parseOoklaResult({ type: "result", ping: { latency: 5 } });
    expect(m.pingMs).toBe(5);
    expect(m.downloadBps).toBeNull();
    expect(m.serverName).toBeNull();
    expect(m.isVpn).toBeNull();
  });
});

describe("parseOoklaProgress", () => {
  it("maps phases", () => {
    expect(parseOoklaProgress({ type: "testStart" })).toEqual({ phase: "connecting" });
    expect(parseOoklaProgress({ type: "ping", ping: { progress: 0.5, latency: 9 } })).toEqual({ phase: "ping", progress: 0.5, value: 9 });
    expect(parseOoklaProgress({ type: "download", download: { progress: 0.2, bandwidth: 1000 } })).toEqual({
      phase: "download",
      progress: 0.2,
      value: 8000,
    });
    expect(parseOoklaProgress({ type: "result" })).toBeNull();
  });
});

describe("OoklaEngine.isAvailable", () => {
  it("detects the CLI and its version", async () => {
    const exec = vi.fn(async () => ok({ stdout: "Speedtest by Ookla 1.2.0.84 (c5e66f1) Linux" }));
    const s = await new OoklaEngine(exec).isAvailable();
    expect(s).toMatchObject({ available: true, version: "1.2.0.84", hint: null });
  });

  it("reports a hint when the binary is missing", async () => {
    const exec = vi.fn(async () => ok({ exitCode: null, spawnError: "ENOENT" }));
    const s = await new OoklaEngine(exec).isAvailable();
    expect(s.available).toBe(false);
    expect(s.hint).toContain("speedtest.net/apps/cli");
  });

  it("rejects the unrelated python speedtest-cli", async () => {
    const exec = vi.fn(async () => ok({ stdout: "speedtest-cli 2.1.3\nPython 3.11" }));
    const s = await new OoklaEngine(exec).isAvailable();
    expect(s.available).toBe(false);
    expect(s.hint).toContain("not the Ookla CLI");
  });
});

describe("OoklaEngine.run", () => {
  it("binds by interface and returns parsed metrics plus raw", async () => {
    const exec = fakeRunner([{ type: "testStart" }, { type: "download", download: { progress: 0.5, bandwidth: 100 } }, OOKLA_RESULT]);
    const onProgress = vi.fn();
    const res = await new OoklaEngine(exec).run(target, { timeoutMs: 1000, onProgress });
    expect(exec.mock.calls[0]?.[1]).toContain("--interface=eth0");
    expect(exec.mock.calls[0]?.[1]).toContain("--accept-license");
    expect(res.metrics.downloadBps).toBe(95_000_000);
    expect(res.raw).toEqual(OOKLA_RESULT);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("binds by source ip", async () => {
    const exec = fakeRunner([OOKLA_RESULT]);
    await new OoklaEngine(exec).run({ bindType: "ip", bindValue: "10.0.0.2" }, { timeoutMs: 1000 });
    expect(exec.mock.calls[0]?.[1]).toContain("--ip=10.0.0.2");
  });

  it("throws unavailable when the binary is missing", async () => {
    const exec = vi.fn(async () => ok({ exitCode: null, spawnError: "ENOENT" }));
    await expect(new OoklaEngine(exec).run(target, { timeoutMs: 1000 })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("throws aborted when the worker shuts down mid-test", async () => {
    const exec = fakeRunner([], { exitCode: null, aborted: true });
    await expect(new OoklaEngine(exec).run(target, { timeoutMs: 5000 })).rejects.toMatchObject({ kind: "aborted" });
  });

  it("passes the abort signal to the process", async () => {
    const exec = fakeRunner([OOKLA_RESULT]);
    const ac = new AbortController();
    await new OoklaEngine(exec).run(target, { timeoutMs: 1000, signal: ac.signal });
    expect(exec.mock.calls[0]?.[2].signal).toBe(ac.signal);
  });

  it("throws timeout", async () => {
    const exec = fakeRunner([], { exitCode: null, timedOut: true });
    await expect(new OoklaEngine(exec).run(target, { timeoutMs: 5000 })).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringContaining("5s"),
    });
  });

  it("surfaces the logged error message on non-zero exit", async () => {
    const exec = fakeRunner([{ type: "log", level: "error", message: "Configuration - Couldn't resolve host name" }], { exitCode: 1 });
    const err = await new OoklaEngine(exec).run(target, { timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ kind: "failed", message: "Configuration - Couldn't resolve host name", details: { exitCode: 1 } });
  });

  it("falls back to stderr, then to the exit code", async () => {
    let e = await new OoklaEngine(fakeRunner([], { exitCode: 2, stderr: "bad thing\n" })).run(target, { timeoutMs: 1 }).catch((x) => x);
    expect(e.message).toBe("bad thing");
    e = await new OoklaEngine(fakeRunner([], { exitCode: 2 })).run(target, { timeoutMs: 1 }).catch((x) => x);
    expect(e.message).toContain("code 2");
  });

  it("fails when exit is 0 but no result line was produced", async () => {
    const e = await new OoklaEngine(fakeRunner(["not json"])).run(target, { timeoutMs: 1 }).catch((x) => x);
    expect(e).toMatchObject({ kind: "failed", message: "Speedtest produced no result" });
  });
});

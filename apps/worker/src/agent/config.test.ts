import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatToken, generateSecret, generateWorkerId } from "@linkwatch/protocol";
import { describe, expect, it } from "vitest";
import { normalizeMasterUrl, readSavedConfig, resolveConfig, saveConfig } from "./config.js";

const tok = (id = generateWorkerId()) => formatToken(id, generateSecret());

describe("normalizeMasterUrl", () => {
  it.each([
    ["ws://10.0.0.5:3000", "ws://10.0.0.5:3000/ws/worker"],
    ["10.0.0.5:3000", "ws://10.0.0.5:3000/ws/worker"],
    ["http://m:3000/", "ws://m:3000/ws/worker"],
    ["https://m.example.com", "wss://m.example.com/ws/worker"],
    ["wss://m/custom?x=1", "wss://m/custom"],
  ])("%s -> %s", (a, b) => {
    expect(normalizeMasterUrl(a)).toBe(b);
  });
  it("rejects other protocols", () => {
    expect(() => normalizeMasterUrl("ftp://x")).toThrow();
  });
});

describe("resolveConfig precedence", () => {
  const flags = tok();
  const env = tok();
  const file = tok();
  const saved = { master: "ws://file:3000", token: file };

  it("flags beat env beat file", () => {
    const r = resolveConfig({
      argv: ["--master", "ws://flag:1", "--token", flags],
      env: { MASTER_URL: "ws://env:2", WORKER_TOKEN: env },
      saved,
    });
    expect(r).toMatchObject({ masterUrl: "ws://flag:1/ws/worker", secret: flags.split(".")[1], source: "flags" });
    const e = resolveConfig({ argv: [], env: { MASTER_URL: "ws://env:2", WORKER_TOKEN: env }, saved });
    expect(e).toMatchObject({ masterUrl: "ws://env:2/ws/worker", workerId: env.split(".")[0], source: "env" });
    const f = resolveConfig({ argv: [], env: {}, saved });
    expect(f).toMatchObject({ masterUrl: "ws://file:3000/ws/worker", workerId: file.split(".")[0], source: "file" });
  });

  it("resolves master and token independently", () => {
    const r = resolveConfig({ argv: ["--token", flags], env: {}, saved });
    expect(r.masterUrl).toBe("ws://file:3000/ws/worker");
    expect(r.workerId).toBe(flags.split(".")[0]);
  });

  it("explains what is missing and rejects bad tokens or flags", () => {
    expect(() => resolveConfig({ argv: [], env: {}, saved: null })).toThrow(/--master/);
    expect(() => resolveConfig({ argv: ["--master", "m:1", "--token", "garbage"], env: {}, saved: null })).toThrow(/token/i);
    expect(() => resolveConfig({ argv: ["--nope"], env: {}, saved: null })).toThrow();
  });
});

describe("saved config file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkwatch-cfg-"));
  it("round-trips with owner-only permissions", () => {
    const file = path.join(dir, "nested", "worker.json");
    saveConfig({ master: "ws://m:1/ws/worker", token: "t" }, file);
    expect(readSavedConfig(file)).toEqual({ master: "ws://m:1/ws/worker", token: "t" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });
  it("returns null for missing or malformed files", () => {
    expect(readSavedConfig(path.join(dir, "none.json"))).toBeNull();
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{nope");
    expect(readSavedConfig(bad)).toBeNull();
    fs.writeFileSync(bad, '{"master":1}');
    expect(readSavedConfig(bad)).toBeNull();
  });
});

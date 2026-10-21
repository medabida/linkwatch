import os from "node:os";
import { describe, expect, it } from "vitest";
import { WORKER_VERSION } from "../version.js";
import { buildInfo } from "./info.js";

describe("buildInfo", () => {
  it("describes this machine and carries the engine status", () => {
    const engine = { name: "ookla", available: false, version: null, hint: "install it" };
    expect(buildInfo(engine)).toEqual({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      nodeVersion: process.version,
      workerVersion: WORKER_VERSION,
      engine,
    });
  });
});

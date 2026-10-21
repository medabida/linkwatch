import os from "node:os";
import type { WorkerInfo } from "@linkwatch/protocol";
import type { EngineStatus } from "@linkwatch/shared";
import { WORKER_VERSION } from "../version.js";

export const buildInfo = (engine: EngineStatus): WorkerInfo => ({
  hostname: os.hostname(),
  platform: os.platform(),
  arch: os.arch(),
  osRelease: os.release(),
  nodeVersion: process.version,
  workerVersion: WORKER_VERSION,
  engine,
});

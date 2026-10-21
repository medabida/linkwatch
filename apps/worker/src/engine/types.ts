import type { BindType, EnginePhase, EngineStatus, RunMetrics } from "@linkwatch/shared";

export interface EngineTarget {
  bindType: BindType;
  bindValue: string;
}

export interface EngineProgress {
  phase: EnginePhase;
  /** 0..1 within the phase, when known */
  progress?: number;
  /** current speed (bits/s) or latency (ms), when known */
  value?: number;
}

export interface EngineRunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (p: EngineProgress) => void;
}

export interface EngineResult {
  metrics: RunMetrics;
  engineVersion: string | null;
  /** Full engine output, stored as raw JSON */
  raw: unknown;
}

export type EngineErrorKind = "timeout" | "failed" | "unavailable" | "aborted";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: EngineErrorKind,
    readonly details: { exitCode?: number | null; stderr?: string; stdout?: string } = {},
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface SpeedTestEngine {
  readonly name: string;
  isAvailable(): Promise<EngineStatus>;
  run(target: EngineTarget, opts: EngineRunOptions): Promise<EngineResult>;
}

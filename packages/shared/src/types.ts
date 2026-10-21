import type { BIND_TYPES, RUN_STATUSES, RUN_TRIGGERS, WORKER_KINDS } from "./constants.js";

export type BindType = (typeof BIND_TYPES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export type WorkerKind = (typeof WORKER_KINDS)[number];

export interface TargetDto {
  id: number;
  workerId: string;
  label: string;
  bindType: BindType;
  bindValue: string;
  intervalMinutes: number;
  timeoutSeconds: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Every value an engine can report. Speeds are bits per second, times are milliseconds. */
export interface RunMetrics {
  downloadBps: number | null;
  uploadBps: number | null;
  pingMs: number | null;
  pingJitterMs: number | null;
  pingLowMs: number | null;
  pingHighMs: number | null;
  packetLoss: number | null;
  downloadBytes: number | null;
  downloadElapsedMs: number | null;
  downloadLatencyIqmMs: number | null;
  downloadLatencyLowMs: number | null;
  downloadLatencyHighMs: number | null;
  downloadLatencyJitterMs: number | null;
  uploadBytes: number | null;
  uploadElapsedMs: number | null;
  uploadLatencyIqmMs: number | null;
  uploadLatencyLowMs: number | null;
  uploadLatencyHighMs: number | null;
  uploadLatencyJitterMs: number | null;
  serverId: string | null;
  serverName: string | null;
  serverLocation: string | null;
  serverCountry: string | null;
  serverHost: string | null;
  serverIp: string | null;
  externalIp: string | null;
  internalIp: string | null;
  interfaceName: string | null;
  interfaceMac: string | null;
  isVpn: boolean | null;
  isp: string | null;
  resultId: string | null;
  resultUrl: string | null;
}

export interface RunDto extends RunMetrics {
  id: number;
  workerId: string | null;
  workerName: string;
  site: string;
  targetId: number | null;
  targetLabel: string;
  bindType: BindType;
  bindValue: string;
  attemptGroupId: string;
  attemptNumber: number;
  trigger: RunTrigger;
  status: RunStatus;
  engine: string;
  engineVersion: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  exitCode: number | null;
  stderr: string | null;
}

export interface RunDetailDto extends RunDto {
  /** Parsed JSON as stored, or null. */
  raw: unknown;
}

export interface RunsPage {
  rows: RunDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type EnginePhase = "connecting" | "ping" | "download" | "upload";

export type RunEventType = "run_queued" | "run_started" | "run_progress" | "run_finished" | "worker_changed";

export interface RunEventDto {
  id: number;
  type: RunEventType;
  runId: number | null;
  targetId: number | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface EngineStatus {
  name: string;
  available: boolean;
  version: string | null;
  hint: string | null;
}

export type WorkerStatus = "online" | "reconnecting" | "offline" | "waiting" | "disabled" | "incompatible";

export interface WorkerMachineInfo {
  hostname: string;
  platform: string;
  arch: string;
  osRelease: string;
  nodeVersion: string;
  workerVersion: string;
}

export interface WorkerActivity {
  runId: number;
  targetId: number | null;
  targetLabel: string;
  attempt: number;
  phase?: string;
  progress?: number;
  value?: number;
}

export interface WorkerDto {
  id: string;
  name: string;
  site: string;
  kind: WorkerKind;
  enabled: boolean;
  status: WorkerStatus;
  /** why the worker is in its current state, e.g. the last rejection reason */
  statusDetail: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  lastConnectedAt: number | null;
  connectedSince: number | null;
  rttMs: number | null;
  machine: WorkerMachineInfo | null;
  engine: EngineStatus | null;
  interfaces: NetworkInterfaceDto[] | null;
  interfacesUpdatedAt: number | null;
  activity: WorkerActivity | null;
  targetCount: number;
}

/** Returned once when a worker is created or its token rotated. */
export interface WorkerTokenDto {
  worker: WorkerDto;
  token: string;
}

export interface HealthDto {
  engine: EngineStatus | null;
  worker: { alive: boolean; lastSeenAt: number | null; version: string | null };
}

export interface NetworkInterfaceDto {
  name: string;
  addresses: { address: string; family: string; internal: boolean }[];
}

export function emptyMetrics(): RunMetrics {
  return {
    downloadBps: null,
    uploadBps: null,
    pingMs: null,
    pingJitterMs: null,
    pingLowMs: null,
    pingHighMs: null,
    packetLoss: null,
    downloadBytes: null,
    downloadElapsedMs: null,
    downloadLatencyIqmMs: null,
    downloadLatencyLowMs: null,
    downloadLatencyHighMs: null,
    downloadLatencyJitterMs: null,
    uploadBytes: null,
    uploadElapsedMs: null,
    uploadLatencyIqmMs: null,
    uploadLatencyLowMs: null,
    uploadLatencyHighMs: null,
    uploadLatencyJitterMs: null,
    serverId: null,
    serverName: null,
    serverLocation: null,
    serverCountry: null,
    serverHost: null,
    serverIp: null,
    externalIp: null,
    internalIp: null,
    interfaceName: null,
    interfaceMac: null,
    isVpn: null,
    isp: null,
    resultId: null,
    resultUrl: null,
  };
}

import type { BIND_TYPES, DASHBOARD_METRICS, RUN_STATUSES, RUN_TRIGGERS, WORKER_KINDS } from "./constants.js";

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

export type DashboardMetric = (typeof DASHBOARD_METRICS)[number];

export interface StatBlock {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

export interface DashboardTarget {
  /** Stable series key: the target id, or `x:<worker>:<label>` for runs whose target was deleted. */
  key: string;
  targetId: number | null;
  label: string;
  workerName: string;
  site: string;
  bindValue: string;
  enabled: boolean | null;
  intervalMinutes: number | null;
}

export interface SeriesPoint {
  key: string;
  /** Bucket start (epoch ms). */
  t: number;
  /** Finished tests in the bucket (final attempt of each test only). */
  n: number;
  ok: number;
  failed: number;
  metrics: Partial<Record<DashboardMetric, StatBlock>>;
}

export interface DashboardSummary {
  tests: number;
  ok: number;
  failed: number;
  /** 0..100, null without tests. */
  successRate: number | null;
  downloadBps: StatBlock | null;
  uploadBps: StatBlock | null;
  pingMs: StatBlock | null;
  pingJitterMs: StatBlock | null;
  packetLoss: StatBlock | null;
  downloadBytes: number;
  uploadBytes: number;
}

export interface TargetComparison {
  key: string;
  tests: number;
  ok: number;
  failed: number;
  downloadBps: StatBlock | null;
  uploadBps: StatBlock | null;
  pingMs: StatBlock | null;
  downloadBytes: number;
  uploadBytes: number;
}

export interface UsagePoint {
  /** Day start in the client's timezone (epoch ms). */
  t: number;
  downloadBytes: number;
  uploadBytes: number;
}

export interface HeatmapCell {
  key: string;
  /** Hour of day, 0..23, in the client's timezone. */
  hour: number;
  n: number;
  downloadBps: number;
}

export interface BaselineEntry {
  key: string;
  latestBps: number | null;
  latestAt: number | null;
  /** Median successful download over the 7 days before `to`. */
  medianBps: number | null;
  /** (latest - median) / median * 100. */
  deviationPct: number | null;
}

export interface HealthEntry {
  key: string;
  lastRunAt: number | null;
  lastStatus: RunStatus | null;
  lastOkAt: number | null;
  lastError: string | null;
  /** True when the target is enabled but has not produced a successful test for 3 intervals. */
  stale: boolean;
}

export interface ServerStat {
  name: string;
  location: string | null;
  host: string | null;
  tests: number;
  downloadBps: number | null;
  uploadBps: number | null;
  pingMs: number | null;
}

export interface IdentityChange {
  key: string;
  at: number;
  externalIp: string | null;
  isp: string | null;
  isVpn: boolean | null;
  /** Null for the first value seen in the range. */
  previousExternalIp: string | null;
  previousIsp: string | null;
}

export interface DashboardDto {
  from: number;
  to: number;
  bucketMs: number;
  targets: DashboardTarget[];
  series: SeriesPoint[];
  summary: DashboardSummary;
  comparison: TargetComparison[];
  usage: UsagePoint[];
  heatmap: HeatmapCell[];
  baseline: BaselineEntry[];
  health: HealthEntry[];
  servers: ServerStat[];
  identity: IdentityChange[];
}

/** Scheduling switches, editable on the Settings page. */
export interface SettingsDto {
  /** Different sites may test at the same time. When off, only one site is active at a time. */
  parallelSites: boolean;
  /** Interfaces of different workers in the same site may test at the same time. A worker still runs one test at a time. */
  parallelInterfaces: boolean;
}

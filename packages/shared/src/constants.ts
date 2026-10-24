export const MIN_INTERVAL_MINUTES = 5;
export const DEFAULT_TIMEOUT_SECONDS = 120;
export const MIN_TIMEOUT_SECONDS = 10;
export const MAX_TIMEOUT_SECONDS = 900;
export const MAX_ATTEMPTS = 3;
export const DEFAULT_API_PORT = 3000;

export const DEFAULT_SITE = "default";
export const WORKER_KINDS = ["local", "remote"] as const;
export const BIND_TYPES = ["interface", "ip"] as const;
export const RUN_STATUSES = ["running", "ok", "failed", "timeout"] as const;
export const RUN_TRIGGERS = ["startup", "schedule", "manual"] as const;
export const SORTABLE_RUN_COLUMNS = [
  "startedAt",
  "status",
  "targetLabel",
  "workerName",
  "site",
  "downloadBps",
  "uploadBps",
  "pingMs",
  "pingJitterMs",
  "packetLoss",
  "durationMs",
  "serverName",
  "isp",
] as const;

/** Metrics the dashboard aggregates per time bucket. */
export const DASHBOARD_METRICS = [
  "downloadBps",
  "uploadBps",
  "pingMs",
  "pingJitterMs",
  "pingLowMs",
  "pingHighMs",
  "packetLoss",
  "downloadLatencyIqmMs",
  "uploadLatencyIqmMs",
] as const;

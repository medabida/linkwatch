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

/** First-start values: the behaviour before the settings existed (one test at a time per site, sites in parallel). */
export const DEFAULT_SETTINGS = { parallelSites: true, parallelInterfaces: false } as const;

export const ALERT_TYPES = ["test_failed", "stale", "worker_offline", "speed", "latency", "packet_loss", "ip_change"] as const;
export const ALERT_SEVERITIES = ["warning", "critical"] as const;
export const SPEED_METRICS = ["downloadBps", "uploadBps"] as const;
export const LATENCY_METRICS = ["pingMs", "pingJitterMs", "downloadLatencyIqmMs", "uploadLatencyIqmMs"] as const;
export const CHANNEL_TYPES = ["telegram"] as const;
/** Minimum number of past results needed before a baseline-relative speed rule evaluates. */
export const MIN_BASELINE_SAMPLES = 3;

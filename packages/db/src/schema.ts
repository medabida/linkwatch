import type { EngineStatus, NetworkInterfaceDto, WorkerMachineInfo } from "@linkwatch/shared";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workers = sqliteTable("workers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  site: text("site").notNull().default("default"),
  kind: text("kind", { enum: ["local", "remote"] }).notNull(),
  secret: text("secret").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
  lastConnectedAt: integer("last_connected_at"),
  info: text("info", { mode: "json" }).$type<WorkerInfo>(),
  interfaces: text("interfaces", { mode: "json" }).$type<NetworkInterfaceDto[]>(),
  interfacesUpdatedAt: integer("interfaces_updated_at"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull().$type<unknown>(),
});

export type WorkerInfo = WorkerMachineInfo & { engine: EngineStatus };

export const targets = sqliteTable("targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workerId: text("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  bindType: text("bind_type", { enum: ["interface", "ip"] }).notNull(),
  bindValue: text("bind_value").notNull(),
  intervalMinutes: integer("interval_minutes").notNull(),
  timeoutSeconds: integer("timeout_seconds").notNull().default(120),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const runs = sqliteTable(
  "runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workerId: text("worker_id").references(() => workers.id, { onDelete: "set null" }),
    workerName: text("worker_name").notNull(),
    site: text("site").notNull(),
    targetId: integer("target_id").references(() => targets.id, { onDelete: "set null" }),
    targetLabel: text("target_label").notNull(),
    bindType: text("bind_type", { enum: ["interface", "ip"] }).notNull(),
    bindValue: text("bind_value").notNull(),
    attemptGroupId: text("attempt_group_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    trigger: text("trigger", { enum: ["startup", "schedule", "manual"] }).notNull(),
    status: text("status", { enum: ["running", "ok", "failed", "timeout"] }).notNull(),
    engine: text("engine").notNull(),
    engineVersion: text("engine_version"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    durationMs: integer("duration_ms"),

    downloadBps: real("download_bps"),
    uploadBps: real("upload_bps"),
    pingMs: real("ping_ms"),
    pingJitterMs: real("ping_jitter_ms"),
    pingLowMs: real("ping_low_ms"),
    pingHighMs: real("ping_high_ms"),
    packetLoss: real("packet_loss"),
    downloadBytes: real("download_bytes"),
    downloadElapsedMs: real("download_elapsed_ms"),
    downloadLatencyIqmMs: real("download_latency_iqm_ms"),
    downloadLatencyLowMs: real("download_latency_low_ms"),
    downloadLatencyHighMs: real("download_latency_high_ms"),
    downloadLatencyJitterMs: real("download_latency_jitter_ms"),
    uploadBytes: real("upload_bytes"),
    uploadElapsedMs: real("upload_elapsed_ms"),
    uploadLatencyIqmMs: real("upload_latency_iqm_ms"),
    uploadLatencyLowMs: real("upload_latency_low_ms"),
    uploadLatencyHighMs: real("upload_latency_high_ms"),
    uploadLatencyJitterMs: real("upload_latency_jitter_ms"),

    serverId: text("server_id"),
    serverName: text("server_name"),
    serverLocation: text("server_location"),
    serverCountry: text("server_country"),
    serverHost: text("server_host"),
    serverIp: text("server_ip"),
    externalIp: text("external_ip"),
    internalIp: text("internal_ip"),
    interfaceName: text("interface_name"),
    interfaceMac: text("interface_mac"),
    isVpn: integer("is_vpn", { mode: "boolean" }),
    isp: text("isp"),
    resultId: text("result_id"),
    resultUrl: text("result_url"),

    errorMessage: text("error_message"),
    exitCode: integer("exit_code"),
    stderr: text("stderr"),
    rawJson: text("raw_json"),
  },
  (t) => [
    index("runs_started_at_idx").on(t.startedAt),
    index("runs_target_started_idx").on(t.targetId, t.startedAt),
    index("runs_status_idx").on(t.status),
  ],
);

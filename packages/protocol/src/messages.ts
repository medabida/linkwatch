import type { EngineStatus, NetworkInterfaceDto, RunMetrics } from "@linkwatch/shared";
import { z } from "zod";

const num = z.number().nullable();
const str = z.string().nullable();

export const runMetricsSchema = z.object({
  downloadBps: num,
  uploadBps: num,
  pingMs: num,
  pingJitterMs: num,
  pingLowMs: num,
  pingHighMs: num,
  packetLoss: num,
  downloadBytes: num,
  downloadElapsedMs: num,
  downloadLatencyIqmMs: num,
  downloadLatencyLowMs: num,
  downloadLatencyHighMs: num,
  downloadLatencyJitterMs: num,
  uploadBytes: num,
  uploadElapsedMs: num,
  uploadLatencyIqmMs: num,
  uploadLatencyLowMs: num,
  uploadLatencyHighMs: num,
  uploadLatencyJitterMs: num,
  serverId: str,
  serverName: str,
  serverLocation: str,
  serverCountry: str,
  serverHost: str,
  serverIp: str,
  externalIp: str,
  internalIp: str,
  interfaceName: str,
  interfaceMac: str,
  isVpn: z.boolean().nullable(),
  isp: str,
  resultId: str,
  resultUrl: str,
}) satisfies z.ZodType<RunMetrics>;

export const engineStatusSchema = z.object({
  name: z.string(),
  available: z.boolean(),
  version: z.string().nullable(),
  hint: z.string().nullable(),
}) satisfies z.ZodType<EngineStatus>;

export const interfaceListSchema = z
  .array(
    z.object({
      name: z.string().max(64),
      addresses: z.array(z.object({ address: z.string().max(64), family: z.string().max(16), internal: z.boolean() })).max(64),
    }),
  )
  .max(256) satisfies z.ZodType<NetworkInterfaceDto[]>;

export const workerInfoSchema = z.object({
  hostname: z.string().max(255),
  platform: z.string().max(32),
  arch: z.string().max(32),
  osRelease: z.string().max(128),
  nodeVersion: z.string().max(32),
  workerVersion: z.string().max(32),
  engine: engineStatusSchema,
});
export type WorkerInfo = z.infer<typeof workerInfoSchema>;

export const TEST_FAILURE_KINDS = [
  "timeout",
  "failed",
  "unavailable",
  "aborted",
  "busy",
  "offline",
  "lost",
  "unresponsive",
  "disabled",
] as const;
export type TestFailureKind = (typeof TEST_FAILURE_KINDS)[number];

export const REJECT_REASONS = ["bad_credentials", "incompatible", "disabled", "throttled"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

const nonce = z.string().min(16).max(128);
const proof = z.string().regex(/^[0-9a-f]{64}$/);
const runId = z.number().int().positive();
const bindTarget = z.object({ bindType: z.enum(["interface", "ip"]), bindValue: z.string().min(1).max(64) });

// ---- worker -> master -------------------------------------------------------
export const helloSchema = z.object({ type: z.literal("hello"), protocol: z.number().int(), workerId: z.string().min(1).max(64), nonce });
export const authSchema = z.object({ type: z.literal("auth"), proof, info: workerInfoSchema });
export const interfacesSchema = z.object({ type: z.literal("interfaces"), interfaces: interfaceListSchema });
export const statusSchema = z.object({ type: z.literal("status"), info: workerInfoSchema });
export const progressSchema = z.object({
  type: z.literal("progress"),
  runId,
  phase: z.enum(["connecting", "ping", "download", "upload"]),
  progress: z.number().optional(),
  value: z.number().optional(),
});
export const resultSchema = z.object({
  type: z.literal("result"),
  runId,
  metrics: runMetricsSchema,
  raw: z.unknown(),
  engine: z.object({ name: z.string(), version: z.string().nullable() }),
});
export const failureSchema = z.object({
  type: z.literal("failure"),
  runId,
  kind: z.enum(TEST_FAILURE_KINDS),
  message: z.string().max(4000),
  exitCode: z.number().int().nullable().optional(),
  stderr: z.string().max(100_000).optional(),
  stdout: z.string().max(100_000).optional(),
});
export const pongSchema = z.object({ type: z.literal("pong"), t: z.number() });

export const workerMessageSchema = z.discriminatedUnion("type", [
  helloSchema,
  authSchema,
  interfacesSchema,
  statusSchema,
  progressSchema,
  resultSchema,
  failureSchema,
  pongSchema,
]);
export type WorkerMessage = z.infer<typeof workerMessageSchema>;

// ---- master -> worker -------------------------------------------------------
export const challengeSchema = z.object({ type: z.literal("challenge"), nonce, proof });
export const readySchema = z.object({ type: z.literal("ready"), workerId: z.string(), name: z.string() });
export const rejectSchema = z.object({ type: z.literal("reject"), reason: z.enum(REJECT_REASONS), message: z.string().max(500) });
export const runTestSchema = z.object({ type: z.literal("run_test"), runId, target: bindTarget, timeoutMs: z.number().int().positive() });
export const abortSchema = z.object({ type: z.literal("abort"), runId });
export const pingSchema = z.object({ type: z.literal("ping"), t: z.number() });
export const requestInterfacesSchema = z.object({ type: z.literal("request_interfaces") });
export const requestStatusSchema = z.object({ type: z.literal("request_status") });

export const masterMessageSchema = z.discriminatedUnion("type", [
  challengeSchema,
  readySchema,
  rejectSchema,
  runTestSchema,
  abortSchema,
  pingSchema,
  requestInterfacesSchema,
  requestStatusSchema,
]);
export type MasterMessage = z.infer<typeof masterMessageSchema>;

export type ParseResult<T> = { ok: true; msg: T } | { ok: false; error: string };

function parse<T>(schema: z.ZodType<T>, raw: unknown): ParseResult<T> {
  let value: unknown = raw;
  if (typeof raw === "string" || Buffer.isBuffer(raw)) {
    try {
      value = JSON.parse(raw.toString());
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
  }
  const r = schema.safeParse(value);
  return r.success
    ? { ok: true, msg: r.data }
    : { ok: false, error: r.error.issues[0] ? `${r.error.issues[0].path.join(".")}: ${r.error.issues[0].message}` : "invalid message" };
}

export const parseWorkerMessage = (raw: unknown) => parse<WorkerMessage>(workerMessageSchema, raw);
export const parseMasterMessage = (raw: unknown) => parse<MasterMessage>(masterMessageSchema, raw);
export const encode = (msg: WorkerMessage | MasterMessage): string => JSON.stringify(msg);

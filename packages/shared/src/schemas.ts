import { z } from "zod";
import {
  ALERT_SEVERITIES,
  BIND_TYPES,
  CHANNEL_TYPES,
  DEFAULT_SITE,
  DEFAULT_TIMEOUT_SECONDS,
  LATENCY_METRICS,
  MAX_TIMEOUT_SECONDS,
  MIN_INTERVAL_MINUTES,
  MIN_TIMEOUT_SECONDS,
  RUN_STATUSES,
  SORTABLE_RUN_COLUMNS,
  SPEED_METRICS,
} from "./constants.js";

const INTERFACE_NAME = /^[A-Za-z0-9_.:@-]{1,32}$/;
const isIp = (v: string) => z.ipv4().safeParse(v).success || z.ipv6().safeParse(v).success;

const targetFieldsSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(64),
  bindType: z.enum(BIND_TYPES),
  bindValue: z.string().trim().min(1, "Value is required").max(64),
  intervalMinutes: z.coerce
    .number()
    .int("Must be a whole number")
    .min(MIN_INTERVAL_MINUTES, `Minimum interval is ${MIN_INTERVAL_MINUTES} minutes`),
  timeoutSeconds: z.coerce
    .number()
    .int("Must be a whole number")
    .min(MIN_TIMEOUT_SECONDS, `Minimum timeout is ${MIN_TIMEOUT_SECONDS}s`)
    .max(MAX_TIMEOUT_SECONDS, `Maximum timeout is ${MAX_TIMEOUT_SECONDS}s`)
    .default(DEFAULT_TIMEOUT_SECONDS),
  enabled: z.boolean().default(true),
});

type BindFields = { bindType: "interface" | "ip"; bindValue: string };
const checkBinding = (v: BindFields, ctx: z.RefinementCtx) => {
  if (v.bindType === "ip" && !isIp(v.bindValue)) {
    ctx.addIssue({ code: "custom", path: ["bindValue"], message: "Not a valid IP address" });
  }
  if (v.bindType === "interface" && !INTERFACE_NAME.test(v.bindValue)) {
    ctx.addIssue({ code: "custom", path: ["bindValue"], message: "Not a valid interface name" });
  }
};

/** Target fields without the owning worker (form state). */
export const targetInputSchema = targetFieldsSchema.superRefine(checkBinding);
/** Full target payload as sent to the API. */
export const targetCreateSchema = targetFieldsSchema
  .extend({ workerId: z.string().trim().min(1, "Worker is required") })
  .superRefine(checkBinding);

export const workerCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64),
  site: z.string().trim().min(1).max(64).default(DEFAULT_SITE),
});
export const workerUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(64).optional(),
  site: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
});
export type WorkerCreateInput = z.infer<typeof workerCreateSchema>;
export type WorkerUpdateInput = z.infer<typeof workerUpdateSchema>;

export type TargetInput = z.infer<typeof targetInputSchema>;
export type TargetCreateInput = z.infer<typeof targetCreateSchema>;

export const runNowSchema = z.object({
  targetId: z.coerce.number().int().positive().optional(),
  workerId: z.string().min(1).optional(),
});

export const runsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.enum(SORTABLE_RUN_COLUMNS).default("startedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  targetId: z.coerce.number().int().positive().optional(),
  workerId: z.string().min(1).optional(),
  site: z.string().min(1).optional(),
  status: z.enum(RUN_STATUSES).optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});

export type RunsQuery = z.infer<typeof runsQuerySchema>;

export const dashboardQuerySchema = z
  .object({
    from: z.coerce.number().int(),
    to: z.coerce.number().int(),
    workerId: z.string().min(1).optional(),
    site: z.string().min(1).optional(),
    targetIds: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(",").map(Number) : undefined))
      .pipe(z.array(z.number().int().positive()).max(200).optional()),
    /** Client timezone offset in minutes east of UTC (e.g. +120 for CEST), used for day and hour buckets. */
    tzOffsetMin: z.coerce.number().int().min(-840).max(840).default(0),
  })
  .refine((q) => q.to > q.from, { message: "to must be after from", path: ["to"] })
  .refine((q) => q.to - q.from <= 366 * 86_400_000, { message: "range too large", path: ["to"] });

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const settingsUpdateSchema = z
  .object({ parallelSites: z.boolean().optional(), parallelInterfaces: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

const consecutive = z.coerce.number().int("Must be a whole number").min(1, "At least 1").max(20, "At most 20");

export const alertScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("site"), site: z.string().trim().min(1, "Pick a site") }),
  z.object({ kind: z.literal("worker"), workerId: z.string().trim().min(1, "Pick a worker") }),
  z.object({ kind: z.literal("targets"), targetIds: z.array(z.number().int().positive()).min(1, "Pick at least one interface").max(200) }),
]);
export type AlertScope = z.infer<typeof alertScopeSchema>;

export const alertConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("test_failed"), consecutive }),
  z.object({ type: z.literal("stale"), intervals: z.coerce.number().int().min(1).max(50) }),
  z.object({ type: z.literal("worker_offline"), minutes: z.coerce.number().int().min(1).max(10_080) }),
  z.object({
    type: z.literal("speed"),
    metric: z.enum(SPEED_METRICS),
    /** absolute: threshold in Mbps. baseline: threshold is a percentage of the 7-day average. */
    mode: z.enum(["absolute", "baseline"]),
    threshold: z.coerce.number().positive("Must be greater than 0").max(100_000),
    consecutive,
  }),
  z.object({
    type: z.literal("latency"),
    metric: z.enum(LATENCY_METRICS),
    thresholdMs: z.coerce.number().positive("Must be greater than 0").max(100_000),
    consecutive,
  }),
  z.object({ type: z.literal("packet_loss"), thresholdPct: z.coerce.number().min(0).max(100), consecutive }),
  z.object({ type: z.literal("ip_change") }),
]);
export type AlertCondition = z.infer<typeof alertConditionSchema>;

export const alertRuleInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    enabled: z.boolean().default(true),
    severity: z.enum(ALERT_SEVERITIES).default("warning"),
    scope: alertScopeSchema,
    condition: alertConditionSchema,
    channelIds: z.array(z.number().int().positive()).max(50).default([]),
    /** Minimum gap before the same alert notifies again after it resolved and re-fired. */
    cooldownMinutes: z.coerce.number().int().min(0).max(10_080).default(360),
    /** Reminder interval while an alert stays open and unacknowledged. 0 = no reminders. */
    renotifyMinutes: z.coerce.number().int().min(0).max(10_080).default(0),
    notifyRecovery: z.boolean().default(true),
  })
  .strict();
export type AlertRuleInput = z.infer<typeof alertRuleInputSchema>;

const TELEGRAM_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const telegramToken = z.string().trim().regex(TELEGRAM_TOKEN, "Not a valid bot token (looks like 123456:ABC-DEF...)");
const telegramChat = z
  .string()
  .trim()
  .regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/, "Chat ID is a number (or @channelname)");

export const channelCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(64),
    type: z.enum(CHANNEL_TYPES).default("telegram"),
    botToken: telegramToken,
    chatId: telegramChat,
    enabled: z.boolean().default(true),
  })
  .strict();
export type ChannelCreateInput = z.infer<typeof channelCreateSchema>;

/** Updates keep the stored bot token unless a new one is sent. */
export const channelUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(64).optional(),
    botToken: telegramToken.optional(),
    chatId: telegramChat.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type ChannelUpdateInput = z.infer<typeof channelUpdateSchema>;

export const alertEventsQuerySchema = z.object({
  state: z.enum(["active", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

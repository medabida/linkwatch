import { z } from "zod";
import {
  BIND_TYPES,
  DEFAULT_SITE,
  DEFAULT_TIMEOUT_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MIN_INTERVAL_MINUTES,
  MIN_TIMEOUT_SECONDS,
  RUN_STATUSES,
  SORTABLE_RUN_COLUMNS,
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

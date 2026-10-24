import {
  type AlertEventDto,
  type AlertRuleDto,
  type AlertRuleInput,
  type AlertSeverity,
  type ChannelCreateInput,
  type ChannelDto,
  type ChannelUpdateInput,
  DEFAULT_SETTINGS,
  DEFAULT_SITE,
  MAX_ATTEMPTS,
  type NetworkInterfaceDto,
  type RunDto,
  type RunMetrics,
  type RunsQuery,
  type SettingsDto,
  type SettingsUpdate,
  type TargetCreateInput,
  type TargetDto,
  type TargetInput,
  type WorkerKind,
} from "@linkwatch/shared";
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { DASHBOARD_ROW_FIELDS, type DashboardRow } from "./dashboard.js";
import { alertEvents, alertRules, notificationChannels, runs, settings, targets, type WorkerInfo, workers } from "./schema.js";

type Clock = () => number;

const { rawJson: _omitRaw, ...runListColumns } = getTableColumns(runs);

export interface NewRun {
  workerId: string | null;
  workerName: string;
  site: string;
  targetId: number | null;
  targetLabel: string;
  bindType: "interface" | "ip";
  bindValue: string;
  attemptGroupId: string;
  attemptNumber: number;
  trigger: "startup" | "schedule" | "manual";
  engine: string;
}

export interface RunFinish {
  status: "ok" | "failed" | "timeout";
  metrics?: Partial<RunMetrics>;
  engineVersion?: string | null;
  errorMessage?: string | null;
  exitCode?: number | null;
  stderr?: string | null;
  rawJson?: string | null;
}

export interface NewAlertEvent {
  ruleId: number;
  ruleName: string;
  severity: AlertSeverity;
  subjectKind: "target" | "worker";
  subjectId: string;
  subjectLabel: string;
  message: string;
  value: number | null;
}

export function createRepos(db: Db, now: Clock = Date.now) {
  const targetsRepo = {
    list(): TargetDto[] {
      return db.select().from(targets).orderBy(asc(targets.id)).all();
    },
    get(id: number): TargetDto | undefined {
      return db.select().from(targets).where(eq(targets.id, id)).get();
    },
    listByWorker(workerId: string): TargetDto[] {
      return db.select().from(targets).where(eq(targets.workerId, workerId)).orderBy(asc(targets.id)).all();
    },
    create(input: TargetCreateInput): TargetDto {
      const t = now();
      return db
        .insert(targets)
        .values({ ...input, createdAt: t, updatedAt: t })
        .returning()
        .get();
    },
    update(id: number, input: TargetInput & { workerId?: string }): TargetDto | undefined {
      return db
        .update(targets)
        .set({ ...input, updatedAt: now() })
        .where(eq(targets.id, id))
        .returning()
        .get();
    },
    remove(id: number): boolean {
      return db.delete(targets).where(eq(targets.id, id)).returning({ id: targets.id }).all().length > 0;
    },
  };

  type WorkerRow = typeof workers.$inferSelect;
  const workersRepo = {
    list(): WorkerRow[] {
      return db.select().from(workers).orderBy(asc(workers.createdAt), asc(workers.id)).all();
    },
    get(id: string): WorkerRow | undefined {
      return db.select().from(workers).where(eq(workers.id, id)).get();
    },
    getLocal(): WorkerRow | undefined {
      return db.select().from(workers).where(eq(workers.kind, "local")).get();
    },
    create(input: { id: string; secret: string; name: string; site?: string; kind?: WorkerKind }): WorkerRow {
      return db
        .insert(workers)
        .values({
          id: input.id,
          secret: input.secret,
          name: input.name,
          site: input.site ?? DEFAULT_SITE,
          kind: input.kind ?? "remote",
          createdAt: now(),
        })
        .returning()
        .get();
    },
    /** Returns the existing local worker, or creates it with the given credentials. */
    ensureLocal(input: { id: string; secret: string; name: string }): WorkerRow {
      return workersRepo.getLocal() ?? workersRepo.create({ ...input, kind: "local" });
    },
    update(id: string, patch: { name?: string; site?: string; enabled?: boolean }): WorkerRow | undefined {
      if (Object.keys(patch).length === 0) return workersRepo.get(id);
      return db.update(workers).set(patch).where(eq(workers.id, id)).returning().get();
    },
    setSecret(id: string, secret: string): boolean {
      return db.update(workers).set({ secret }).where(eq(workers.id, id)).returning({ id: workers.id }).all().length > 0;
    },
    remove(id: string): boolean {
      return db.delete(workers).where(eq(workers.id, id)).returning({ id: workers.id }).all().length > 0;
    },
    markConnected(id: string, info: WorkerInfo): void {
      const t = now();
      db.update(workers).set({ info, lastConnectedAt: t, lastSeenAt: t }).where(eq(workers.id, id)).run();
    },
    touch(id: string): void {
      db.update(workers).set({ lastSeenAt: now() }).where(eq(workers.id, id)).run();
    },
    saveInfo(id: string, info: WorkerInfo): void {
      db.update(workers).set({ info }).where(eq(workers.id, id)).run();
    },
    saveInterfaces(id: string, interfaces: NetworkInterfaceDto[]): void {
      db.update(workers).set({ interfaces, interfacesUpdatedAt: now() }).where(eq(workers.id, id)).run();
    },
  };

  const runsRepo = {
    start(input: NewRun): number {
      return db
        .insert(runs)
        .values({ ...input, status: "running", startedAt: now() })
        .returning({ id: runs.id })
        .get().id;
    },
    finish(id: number, f: RunFinish): void {
      const finishedAt = now();
      const row = db.select({ startedAt: runs.startedAt }).from(runs).where(eq(runs.id, id)).get();
      db.update(runs)
        .set({
          ...f.metrics,
          status: f.status,
          engineVersion: f.engineVersion ?? null,
          errorMessage: f.errorMessage ?? null,
          exitCode: f.exitCode ?? null,
          stderr: f.stderr ?? null,
          rawJson: f.rawJson ?? null,
          finishedAt,
          durationMs: row ? finishedAt - row.startedAt : null,
        })
        .where(eq(runs.id, id))
        .run();
    },
    /** Marks runs left in "running" by a crashed master as failed. */
    failInterrupted(): number {
      const t = now();
      return db
        .update(runs)
        .set({ status: "failed", errorMessage: "Interrupted (master stopped during test)", finishedAt: t })
        .where(eq(runs.status, "running"))
        .returning({ id: runs.id })
        .all().length;
    },
    list(q: RunsQuery): { rows: RunDto[]; total: number } {
      const conds = [
        q.targetId !== undefined ? eq(runs.targetId, q.targetId) : undefined,
        q.workerId ? eq(runs.workerId, q.workerId) : undefined,
        q.site ? eq(runs.site, q.site) : undefined,
        q.status ? eq(runs.status, q.status) : undefined,
        q.from !== undefined ? gte(runs.startedAt, q.from) : undefined,
        q.to !== undefined ? lte(runs.startedAt, q.to) : undefined,
      ].filter((c) => c !== undefined);
      const where = conds.length ? and(...conds) : undefined;
      const col = runs[q.sortBy];
      const dir = q.sortDir === "asc" ? asc : desc;
      const rows = db
        .select(runListColumns)
        .from(runs)
        .where(where)
        .orderBy(dir(col), desc(runs.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize)
        .all();
      const total = db.select({ n: sql<number>`count(*)` }).from(runs).where(where).get()?.n ?? 0;
      return { rows, total };
    },
    /** Finished runs (narrow columns) in a time range, for dashboard aggregation. */
    forDashboard(f: { from: number; to: number; workerId?: string; site?: string; targetIds?: number[] }): DashboardRow[] {
      const cols = Object.fromEntries(DASHBOARD_ROW_FIELDS.map((k) => [k, runs[k]])) as {
        [K in (typeof DASHBOARD_ROW_FIELDS)[number]]: (typeof runs)[K];
      };
      const conds = [
        ne(runs.status, "running"),
        gte(runs.startedAt, f.from),
        lte(runs.startedAt, f.to),
        f.workerId ? eq(runs.workerId, f.workerId) : undefined,
        f.site ? eq(runs.site, f.site) : undefined,
        f.targetIds?.length ? inArray(runs.targetId, f.targetIds) : undefined,
      ].filter((c) => c !== undefined);
      return db
        .select(cols)
        .from(runs)
        .where(and(...conds))
        .orderBy(asc(runs.startedAt))
        .all() as DashboardRow[];
    },
    get(id: number): (RunDto & { rawJson: string | null }) | undefined {
      return db.select().from(runs).where(eq(runs.id, id)).get();
    },
    /** The last `limit` finished tests of a target, newest first, counting only the final attempt of each test. */
    lastFinal(targetId: number, limit: number): RunDto[] {
      const rows = db
        .select(runListColumns)
        .from(runs)
        .where(and(eq(runs.targetId, targetId), ne(runs.status, "running")))
        .orderBy(desc(runs.startedAt), desc(runs.id))
        .limit(limit * MAX_ATTEMPTS + MAX_ATTEMPTS)
        .all();
      const best = new Map<string, RunDto>();
      for (const r of rows) {
        const cur = best.get(r.attemptGroupId);
        if (!cur || r.attemptNumber > cur.attemptNumber) best.set(r.attemptGroupId, r);
      }
      return [...best.values()].sort((a, b) => b.startedAt - a.startedAt || b.id - a.id).slice(0, limit);
    },
    /** Average of a metric over successful runs of a target in [from, to), with the sample count. */
    avgMetric(targetId: number, metric: "downloadBps" | "uploadBps", from: number, to: number): { avg: number | null; n: number } {
      const col = runs[metric];
      const row = db
        .select({ avg: sql<number | null>`avg(${col})`, n: sql<number>`count(${col})` })
        .from(runs)
        .where(and(eq(runs.targetId, targetId), eq(runs.status, "ok"), isNotNull(col), gte(runs.startedAt, from), lt(runs.startedAt, to)))
        .get();
      return { avg: row?.avg ?? null, n: row?.n ?? 0 };
    },
    lastOkAt(targetId: number): number | null {
      const row = db
        .select({ t: runs.startedAt })
        .from(runs)
        .where(and(eq(runs.targetId, targetId), eq(runs.status, "ok")))
        .orderBy(desc(runs.startedAt))
        .limit(1)
        .get();
      return row?.t ?? null;
    },
  };

  const settingsRepo = {
    /** Stored values over the defaults; anything missing or of the wrong type falls back to its default. */
    get(): SettingsDto {
      const out: SettingsDto = { ...DEFAULT_SETTINGS };
      for (const row of db.select().from(settings).all()) {
        if ((row.key === "parallelSites" || row.key === "parallelInterfaces") && typeof row.value === "boolean") out[row.key] = row.value;
      }
      return out;
    },
    update(patch: SettingsUpdate): SettingsDto {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
      }
      return settingsRepo.get();
    },
  };

  const maskToken = (t: string) => `${t.slice(0, t.indexOf(":") + 1)}••••${t.slice(-4)}`;
  type ChannelRow = typeof notificationChannels.$inferSelect;
  const channelDto = (c: ChannelRow): ChannelDto => ({
    id: c.id,
    name: c.name,
    type: c.type,
    enabled: c.enabled,
    chatId: c.config.chatId,
    tokenPreview: maskToken(c.config.botToken),
    createdAt: c.createdAt,
    lastSentAt: c.lastSentAt,
    lastError: c.lastError,
  });

  const channelsRepo = {
    list(): ChannelDto[] {
      return db.select().from(notificationChannels).orderBy(asc(notificationChannels.id)).all().map(channelDto);
    },
    /** Includes the secret bot token: only for the notifier, never for the API. */
    getRaw(id: number): ChannelRow | undefined {
      return db.select().from(notificationChannels).where(eq(notificationChannels.id, id)).get();
    },
    get(id: number): ChannelDto | undefined {
      const c = channelsRepo.getRaw(id);
      return c && channelDto(c);
    },
    create(input: ChannelCreateInput): ChannelDto {
      const row = db
        .insert(notificationChannels)
        .values({
          name: input.name,
          type: input.type,
          config: { botToken: input.botToken, chatId: input.chatId },
          enabled: input.enabled,
          createdAt: now(),
        })
        .returning()
        .get();
      return channelDto(row);
    },
    update(id: number, patch: ChannelUpdateInput): ChannelDto | undefined {
      const cur = channelsRepo.getRaw(id);
      if (!cur) return undefined;
      const row = db
        .update(notificationChannels)
        .set({
          name: patch.name ?? cur.name,
          enabled: patch.enabled ?? cur.enabled,
          config: { botToken: patch.botToken ?? cur.config.botToken, chatId: patch.chatId ?? cur.config.chatId },
        })
        .where(eq(notificationChannels.id, id))
        .returning()
        .get();
      return row && channelDto(row);
    },
    remove(id: number): boolean {
      return (
        db.delete(notificationChannels).where(eq(notificationChannels.id, id)).returning({ id: notificationChannels.id }).all().length > 0
      );
    },
    recordResult(id: number, error: string | null): void {
      db.update(notificationChannels)
        .set(error === null ? { lastSentAt: now(), lastError: null } : { lastError: error.slice(0, 300) })
        .where(eq(notificationChannels.id, id))
        .run();
    },
  };

  const rulesRepo = {
    list(): AlertRuleDto[] {
      return db.select().from(alertRules).orderBy(asc(alertRules.id)).all();
    },
    get(id: number): AlertRuleDto | undefined {
      return db.select().from(alertRules).where(eq(alertRules.id, id)).get();
    },
    create(input: AlertRuleInput): AlertRuleDto {
      const t = now();
      return db
        .insert(alertRules)
        .values({ ...input, createdAt: t, updatedAt: t })
        .returning()
        .get();
    },
    update(id: number, input: AlertRuleInput): AlertRuleDto | undefined {
      return db
        .update(alertRules)
        .set({ ...input, updatedAt: now() })
        .where(eq(alertRules.id, id))
        .returning()
        .get();
    },
    remove(id: number): boolean {
      return db.delete(alertRules).where(eq(alertRules.id, id)).returning({ id: alertRules.id }).all().length > 0;
    },
  };

  const eventsRepo = {
    open(input: NewAlertEvent): AlertEventDto {
      return db
        .insert(alertEvents)
        .values({ ...input, state: "firing", firedAt: now() })
        .returning()
        .get();
    },
    get(id: number): AlertEventDto | undefined {
      return db.select().from(alertEvents).where(eq(alertEvents.id, id)).get();
    },
    findActive(ruleId: number, subjectId: string): AlertEventDto | undefined {
      return db
        .select()
        .from(alertEvents)
        .where(and(eq(alertEvents.ruleId, ruleId), eq(alertEvents.subjectId, subjectId), eq(alertEvents.state, "firing")))
        .get();
    },
    /** The most recent event of a rule for a subject (any state), to apply the cooldown. */
    lastFor(ruleId: number, subjectId: string, exceptId?: number): AlertEventDto | undefined {
      return db
        .select()
        .from(alertEvents)
        .where(
          and(
            eq(alertEvents.ruleId, ruleId),
            eq(alertEvents.subjectId, subjectId),
            isNotNull(alertEvents.notifiedAt),
            exceptId ? ne(alertEvents.id, exceptId) : undefined,
          ),
        )
        .orderBy(desc(alertEvents.notifiedAt))
        .limit(1)
        .get();
    },
    activeList(): AlertEventDto[] {
      return db.select().from(alertEvents).where(eq(alertEvents.state, "firing")).orderBy(desc(alertEvents.firedAt)).all();
    },
    list(q: { state: "active" | "all"; limit: number }): AlertEventDto[] {
      return db
        .select()
        .from(alertEvents)
        .where(q.state === "active" ? eq(alertEvents.state, "firing") : undefined)
        .orderBy(desc(alertEvents.firedAt), desc(alertEvents.id))
        .limit(q.limit)
        .all();
    },
    update(id: number, patch: { message?: string; value?: number | null }): void {
      db.update(alertEvents).set(patch).where(eq(alertEvents.id, id)).run();
    },
    resolve(id: number): AlertEventDto | undefined {
      return db
        .update(alertEvents)
        .set({ state: "resolved", resolvedAt: now() })
        .where(and(eq(alertEvents.id, id), eq(alertEvents.state, "firing")))
        .returning()
        .get();
    },
    acknowledge(id: number): AlertEventDto | undefined {
      return db
        .update(alertEvents)
        .set({ acknowledgedAt: now() })
        .where(and(eq(alertEvents.id, id), eq(alertEvents.state, "firing"), isNull(alertEvents.acknowledgedAt)))
        .returning()
        .get();
    },
    markNotified(id: number): void {
      db.update(alertEvents).set({ notifiedAt: now() }).where(eq(alertEvents.id, id)).run();
    },
  };

  return {
    alerts: { rules: rulesRepo, events: eventsRepo, channels: channelsRepo },
    workers: workersRepo,
    targets: targetsRepo,
    runs: runsRepo,
    settings: settingsRepo,
  };
}

export type Repos = ReturnType<typeof createRepos>;

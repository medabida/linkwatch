import {
  DEFAULT_SITE,
  type NetworkInterfaceDto,
  type RunDto,
  type RunMetrics,
  type RunsQuery,
  type TargetCreateInput,
  type TargetDto,
  type TargetInput,
  type WorkerKind,
} from "@linkwatch/shared";
import { and, asc, desc, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { runs, targets, type WorkerInfo, workers } from "./schema.js";

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
    get(id: number): (RunDto & { rawJson: string | null }) | undefined {
      return db.select().from(runs).where(eq(runs.id, id)).get();
    },
  };

  return {
    workers: workersRepo,
    targets: targetsRepo,
    runs: runsRepo,
  };
}

export type Repos = ReturnType<typeof createRepos>;

import fs from "node:fs";
import path from "node:path";
import { BASELINE_MS, buildDashboard, REPO_ROOT, type Repos } from "@linkwatch/db";
import { CLOSE_DISABLED, CLOSE_REMOVED, CLOSE_TOKEN_ROTATED, formatToken, generateSecret, generateWorkerId } from "@linkwatch/protocol";
import {
  type DashboardDto,
  dashboardQuerySchema,
  type HealthDto,
  type RunDetailDto,
  type RunsPage,
  runNowSchema,
  runsQuerySchema,
  targetInputSchema,
  type WorkerDto,
  type WorkerTokenDto,
  workerCreateSchema,
  workerUpdateSchema,
} from "@linkwatch/shared";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";
import type { Dispatcher } from "./dispatcher.js";
import type { EventBus } from "./events.js";
import type { WorkerHub } from "./hub.js";
import { toWorkerDto } from "./workers.js";

export interface AppDeps {
  repos: Repos;
  hub: WorkerHub;
  dispatcher: Dispatcher;
  bus: EventBus;
  webDist?: string;
}

/** Creates the built-in local worker on first start (it can be disabled but never deleted). */
export function ensureLocalWorker(repos: Repos) {
  return repos.workers.ensureLocal({ id: generateWorkerId(), secret: generateSecret(), name: "Local" });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const parseId = (v: string | undefined): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "Invalid id");
  return n;
};

export function createApp({ repos, hub, dispatcher, bus, webDist = path.join(REPO_ROOT, "apps", "web", "dist") }: AppDeps): Express {
  ensureLocalWorker(repos);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    const local = ensureLocalWorker(repos);
    const body: HealthDto = {
      engine: local.info?.engine ?? null,
      worker: { alive: hub.isConnected(local.id), lastSeenAt: local.lastSeenAt, version: local.info?.workerVersion ?? null },
    };
    res.json(body);
  });

  app.get("/api/interfaces", (_req, res) => {
    res.json(ensureLocalWorker(repos).interfaces ?? []);
  });

  const workerDto = (id: string): WorkerDto => {
    const w = repos.workers.get(id);
    if (!w) throw new HttpError(404, "Worker not found");
    return toWorkerDto(repos, hub, dispatcher, w);
  };
  const requireWorker = (id: string) => {
    const w = repos.workers.get(id);
    if (!w) throw new HttpError(404, "Worker not found");
    return w;
  };
  const assertNameFree = (name: string, exceptId?: string) => {
    if (repos.workers.list().some((w) => w.name === name && w.id !== exceptId))
      throw new HttpError(409, `A worker named "${name}" already exists`);
  };
  const tokenOf = (w: { id: string; secret: string }) => formatToken(w.id, w.secret);

  app.get("/api/workers", (_req, res) => {
    res.json(repos.workers.list().map((w) => toWorkerDto(repos, hub, dispatcher, w)));
  });

  app.post("/api/workers", (req, res) => {
    const input = workerCreateSchema.parse(req.body);
    assertNameFree(input.name);
    const w = repos.workers.create({ id: generateWorkerId(), secret: generateSecret(), name: input.name, site: input.site });
    const body: WorkerTokenDto = { worker: workerDto(w.id), token: tokenOf(w) };
    res.status(201).json(body);
  });

  app.patch("/api/workers/:id", (req, res) => {
    const w = requireWorker(req.params.id);
    const patch = workerUpdateSchema.parse(req.body);
    if (patch.name !== undefined) assertNameFree(patch.name, w.id);
    repos.workers.update(w.id, patch);
    if (patch.enabled === false) hub.disconnect(w.id, CLOSE_DISABLED, "worker disabled");
    dispatcher.reload();
    res.json(workerDto(w.id));
  });

  app.post("/api/workers/:id/rotate-token", (req, res) => {
    const w = requireWorker(req.params.id);
    if (w.kind === "local") throw new HttpError(400, "The local worker's token is managed automatically");
    const secret = generateSecret();
    repos.workers.setSecret(w.id, secret);
    hub.disconnect(w.id, CLOSE_TOKEN_ROTATED, "token rotated");
    const body: WorkerTokenDto = { worker: workerDto(w.id), token: tokenOf({ id: w.id, secret }) };
    res.json(body);
  });

  app.post("/api/workers/:id/refresh", (req, res) => {
    const w = requireWorker(req.params.id);
    const requested = hub.requestInterfaces(w.id) && hub.requestStatus(w.id);
    res.status(202).json({ requested });
  });

  app.delete("/api/workers/:id", (req, res) => {
    const w = requireWorker(req.params.id);
    if (w.kind === "local") throw new HttpError(400, "The local worker cannot be removed (disable it instead)");
    hub.disconnect(w.id, CLOSE_REMOVED, "worker removed");
    repos.workers.remove(w.id);
    dispatcher.reload();
    res.status(204).end();
  });

  const targetWorkerId = (body: unknown): string | undefined => {
    const id = (body as { workerId?: unknown } | null)?.workerId;
    return typeof id === "string" && id ? id : undefined;
  };

  app.get("/api/targets", (req, res) => {
    const workerId = typeof req.query.workerId === "string" ? req.query.workerId : undefined;
    res.json(workerId ? repos.targets.listByWorker(workerId) : repos.targets.list());
  });

  const assertNotDuplicate = (workerId: string, input: { bindType: string; bindValue: string }, exceptId?: number) => {
    const dup = repos.targets
      .listByWorker(workerId)
      .some((t) => t.id !== exceptId && t.bindType === input.bindType && t.bindValue === input.bindValue);
    if (dup) throw new HttpError(409, `This worker already monitors ${input.bindType} "${input.bindValue}"`);
  };

  /** The owning worker defaults to the local worker when omitted. */
  app.post("/api/targets", (req, res) => {
    const workerId = targetWorkerId(req.body) ?? ensureLocalWorker(repos).id;
    if (!repos.workers.get(workerId)) throw new HttpError(400, "Unknown worker");
    const input = targetInputSchema.parse(req.body);
    assertNotDuplicate(workerId, input);
    const target = repos.targets.create({ ...input, workerId });
    dispatcher.reload();
    res.status(201).json(target);
  });

  app.put("/api/targets/:id", (req, res) => {
    const workerId = targetWorkerId(req.body);
    if (workerId && !repos.workers.get(workerId)) throw new HttpError(400, "Unknown worker");
    const id = parseId(req.params.id);
    const input = targetInputSchema.parse(req.body);
    const owner = workerId ?? repos.targets.get(id)?.workerId;
    if (owner) assertNotDuplicate(owner, input, id);
    const target = repos.targets.update(id, { ...input, workerId });
    if (!target) throw new HttpError(404, "Target not found");
    dispatcher.reload();
    res.json(target);
  });

  app.delete("/api/targets/:id", (req, res) => {
    if (!repos.targets.remove(parseId(req.params.id))) throw new HttpError(404, "Target not found");
    dispatcher.reload();
    res.status(204).end();
  });

  app.get("/api/runs", (req, res) => {
    const q = runsQuerySchema.parse(req.query);
    const { rows, total } = repos.runs.list(q);
    const body: RunsPage = { rows, total, page: q.page, pageSize: q.pageSize };
    res.json(body);
  });

  app.get("/api/dashboard", (req, res) => {
    const q = dashboardQuerySchema.parse(req.query);
    const fetched = repos.runs.forDashboard({ ...q, from: Math.min(q.from, q.to - BASELINE_MS), targetIds: q.targetIds });
    const body: DashboardDto = buildDashboard(
      {
        from: q.from,
        to: q.to,
        tzOffsetMin: q.tzOffsetMin,
        targets: repos.targets.list(),
        workers: repos.workers.list().map((w) => ({ id: w.id, name: w.name, site: w.site })),
        filter: { workerId: q.workerId, site: q.site, targetIds: q.targetIds },
      },
      fetched,
    );
    res.json(body);
  });

  app.get("/api/runs/:id", (req, res) => {
    const row = repos.runs.get(parseId(req.params.id));
    if (!row) throw new HttpError(404, "Run not found");
    const { rawJson, ...rest } = row;
    let raw: unknown = null;
    if (rawJson) {
      try {
        raw = JSON.parse(rawJson);
      } catch {
        raw = rawJson;
      }
    }
    const body: RunDetailDto = { ...rest, raw };
    res.json(body);
  });

  app.post("/api/runs/run-now", (req, res) => {
    const { targetId, workerId } = runNowSchema.parse(req.body ?? {});
    if (targetId !== undefined && !repos.targets.get(targetId)) throw new HttpError(404, "Target not found");
    if (workerId !== undefined && !repos.workers.get(workerId)) throw new HttpError(404, "Worker not found");
    const queued = dispatcher.runNow({ targetId, workerId });
    res.status(202).json({ queued });
  });

  app.get("/api/events", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(": connected\n\n");
    const off = bus.subscribe((e) => res.write(`id: ${e.id}\nevent: run\ndata: ${JSON.stringify(e)}\n\n`));
    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      off();
      clearInterval(keepAlive);
    });
  });

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  const indexHtml = path.join(webDist, "index.html");
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(indexHtml);
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Validation failed", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    } else if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON" });
    } else {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
  app.use(onError);

  return app;
}

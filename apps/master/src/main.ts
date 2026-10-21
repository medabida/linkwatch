import path from "node:path";
import { createDb, createRepos, REPO_ROOT } from "@linkwatch/db";
import { formatToken } from "@linkwatch/protocol";
import { DEFAULT_API_PORT } from "@linkwatch/shared";
import { createApp, ensureLocalWorker } from "./app.js";
import { createDispatcher } from "./dispatcher.js";
import { createEventBus, relayWorkerChanges } from "./events.js";
import { createWorkerHub } from "./hub.js";
import { createSupervisor } from "./supervisor.js";

const port = Number(process.env.API_PORT) || DEFAULT_API_PORT;
const log = (m: string) => console.log(`${new Date().toISOString()} [master] ${m}`);

const db = createDb();
const repos = createRepos(db);
const interrupted = repos.runs.failInterrupted();
if (interrupted) log(`marked ${interrupted} interrupted run(s) as failed`);

const bus = createEventBus();
const hub = createWorkerHub({ repos, log });
relayWorkerChanges(hub, bus);
const dispatcher = createDispatcher({ repos, hub, bus, log });
const app = createApp({ repos, hub, dispatcher, bus });

const server = app.listen(port, "0.0.0.0", () => {
  log(`listening on 0.0.0.0:${port}`);
});
hub.attach(server);
dispatcher.reload();

const local = ensureLocalWorker(repos);
const supervisor = createSupervisor({
  command: process.execPath,
  args: [path.join(REPO_ROOT, "apps", "worker", "dist", "main.js")],
  env: { MASTER_URL: `ws://127.0.0.1:${port}`, WORKER_TOKEN: formatToken(local.id, local.secret), WORKER_NO_SAVE: "1" },
  log,
});
supervisor.start();
log(`${repos.targets.list().length} target(s), ${repos.workers.list().length} worker(s)`);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, stopping...`);
  await Promise.race([dispatcher.stop(), new Promise((r) => setTimeout(r, 5000))]);
  await supervisor.stop();
  await hub.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

import { OoklaEngine } from "../engine/ookla.js";
import { createWorkerClient } from "./client.js";
import { readSavedConfig, resolveConfig, saveConfig } from "./config.js";

const log = (m: string) => console.log(`${new Date().toISOString()} [worker] ${m}`);

export async function runWorker(argv = process.argv.slice(2), env = process.env) {
  const saved = readSavedConfig();
  const cfg = resolveConfig({ argv, env, saved });
  const engine = new OoklaEngine();
  const status = await engine.isAvailable();
  log(status.available ? `ookla CLI ${status.version}` : `WARNING: ${status.hint}`);

  let persisted = false;
  const client = createWorkerClient({
    masterUrl: cfg.masterUrl,
    workerId: cfg.workerId,
    secret: cfg.secret,
    engine,
    log,
    onPaired: () => {
      if (persisted || env.WORKER_NO_SAVE === "1" || cfg.source === "file") return;
      persisted = true;
      const token = `${cfg.workerId}.${cfg.secret}`;
      saveConfig({ master: cfg.masterUrl, token });
      log("pairing saved to data/worker.json; next time just run `pnpm worker`");
    },
  });
  log(`connecting to ${cfg.masterUrl} (config from ${cfg.source})`);
  client.start();

  const shutdown = async (signal: string) => {
    log(`${signal} received, stopping...`);
    await client.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

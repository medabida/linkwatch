import { runWorker } from "./agent/entry.js";

runWorker().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

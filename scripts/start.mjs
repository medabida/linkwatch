// `npm start`: build, then run the master (API + UI + scheduler + local worker) in the foreground.
// Ctrl+C stops everything (workers abort any running speed test and exit).
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  console.log("[start] building...");
  const build = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
  if (build.error?.code === "ENOENT") {
    console.error("[start] pnpm not found. Run `corepack enable` (or install pnpm) first.");
    process.exit(1);
  }
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const services = [{ name: "master", entry: "apps/master/dist/main.js" }];

const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function shutdown(signal) {
  if (shuttingDown) {
    console.log("\n[start] forcing exit");
    for (const c of children.values()) c.kill("SIGKILL");
    return;
  }
  shuttingDown = true;
  console.log(`\n[start] ${signal}: stopping...`);
  for (const c of children.values()) c.kill("SIGTERM");
}

for (const s of services) {
  const child = spawn(process.execPath, [path.join(root, s.entry)], { cwd: root, stdio: "inherit" });
  children.set(s.name, child);
  child.on("exit", (code, signal) => {
    children.delete(s.name);
    if (!shuttingDown) {
      console.error(`[start] ${s.name} exited unexpectedly (${signal ?? code}); stopping the rest`);
      exitCode = 1;
      shutdown("child exit");
    }
    if (children.size === 0) process.exit(exitCode);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

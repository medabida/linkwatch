// `pnpm worker [--master ws://host:3000 --token <token>]`: build the worker, then run it in the foreground.
// Arguments are forwarded to the worker; Ctrl+C stops it (aborting any running speed test).
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => a !== "--no-build");
const skipBuild = process.argv.includes("--no-build");

if (!skipBuild) {
  console.log("[worker] building...");
  const build = spawnSync("pnpm", ["--filter", "@linkwatch/worker...", "build"], { cwd: root, stdio: "inherit" });
  if (build.error?.code === "ENOENT") {
    console.error("[worker] pnpm not found. Run `corepack enable` (or install pnpm) first.");
    process.exit(1);
  }
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const child = spawn(process.execPath, [path.join(root, "apps/worker/dist/main.js"), ...args], { cwd: root, stdio: "inherit" });
const forward = (signal) => () => child.kill(signal);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

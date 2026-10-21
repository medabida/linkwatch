import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseToken, WS_PATH } from "@linkwatch/protocol";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const WORKER_CONFIG_PATH = path.join(REPO_ROOT, "data", "worker.json");

export interface WorkerConfig {
  masterUrl: string;
  workerId: string;
  secret: string;
  /** where the effective values came from */
  source: "flags" | "env" | "file";
}

export interface SavedConfig {
  master: string;
  token: string;
}

/** Accepts ws://, wss://, http(s):// or a bare host:port; adds the worker endpoint path. */
export function normalizeMasterUrl(input: string): string {
  let raw = input.trim();
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `ws://${raw}`;
  const u = new URL(raw);
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  if (u.protocol !== "ws:" && u.protocol !== "wss:") throw new Error(`Unsupported master URL protocol: ${u.protocol}`);
  if (u.pathname === "/" || u.pathname === "") u.pathname = WS_PATH;
  u.search = "";
  u.hash = "";
  return u.toString();
}

export function readSavedConfig(file = WORKER_CONFIG_PATH): SavedConfig | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SavedConfig>;
    return typeof j.master === "string" && typeof j.token === "string" ? { master: j.master, token: j.token } : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: SavedConfig, file = WORKER_CONFIG_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export interface ResolveInput {
  argv: string[];
  env: Record<string, string | undefined>;
  saved: SavedConfig | null;
}

/** Precedence: flags > env (MASTER_URL, WORKER_TOKEN) > saved file. Master and token resolve independently. */
export function resolveConfig({ argv, env, saved }: ResolveInput): WorkerConfig {
  const { values } = parseArgs({ args: argv, options: { master: { type: "string" }, token: { type: "string" } }, strict: true });
  const pick = (flag?: string, envVal?: string, file?: string): [string, WorkerConfig["source"]] | null =>
    flag ? [flag, "flags"] : envVal ? [envVal, "env"] : file ? [file, "file"] : null;
  const master = pick(values.master, env.MASTER_URL, saved?.master);
  const token = pick(values.token, env.WORKER_TOKEN, saved?.token);
  if (!master || !token) {
    throw new Error(
      "Missing master address or token. Run: pnpm worker --master ws://<master>:3000 --token <token> (copy it from the Workers page)",
    );
  }
  const parsed = parseToken(token[0]);
  if (!parsed) throw new Error("Invalid token format (expected <workerId>.<secret>)");
  const sources = [master[1], token[1]];
  const source = sources.includes("flags") ? "flags" : sources.includes("env") ? "env" : "file";
  return { masterUrl: normalizeMasterUrl(master[0]), workerId: parsed.workerId, secret: parsed.secret, source };
}

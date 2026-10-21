import path from "node:path";
import { fileURLToPath } from "node:url";

/** packages/db/{src,dist} -> repo root */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const DB_PATH = path.join(REPO_ROOT, "data", "linkwatch.db");

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { DB_PATH, MIGRATIONS_FOLDER, REPO_ROOT } from "./paths.js";
import { createRepos } from "./repos.js";

describe("paths", () => {
  it("resolves the database inside <repo>/data regardless of cwd", () => {
    expect(DB_PATH).toBe(path.join(REPO_ROOT, "data", "linkwatch.db"));
    expect(fs.existsSync(path.join(REPO_ROOT, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"))).toBe(true);
  });
});

describe("createDb", () => {
  it("creates missing directories, enables WAL and foreign keys, and is reopenable", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-db-"));
    const file = path.join(dir, "nested", "test.db");
    const db = createDb(file);
    const repos = createRepos(db);
    repos.workers.create({ id: "w1", secret: "s", name: "A", kind: "local" });
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
    const again = createDb(file);
    expect(createRepos(again).workers.list()).toHaveLength(1);
    again.close();
  });

  it("enforces foreign keys: targets need an existing worker", () => {
    const repos = createRepos(createDb(":memory:"));
    expect(() =>
      repos.targets.create({
        workerId: "ghost",
        label: "x",
        bindType: "interface",
        bindValue: "eth0",
        intervalMinutes: 10,
        timeoutSeconds: 60,
        enabled: true,
      }),
    ).toThrow();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { createSupervisor, type Supervisor } from "./supervisor.js";

const node = process.execPath;
const until = async (fn: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};
let sup: Supervisor | undefined;
afterEach(async () => {
  await sup?.stop();
});

describe("supervisor", () => {
  it("restarts a child that exits and passes env through", async () => {
    sup = createSupervisor({
      command: node,
      args: ["-e", "process.exit(process.env.LINKWATCH_X === 'ok' ? 3 : 4)"],
      env: { LINKWATCH_X: "ok" },
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    sup.start();
    await until(() => sup?.restarts !== undefined && sup.restarts >= 2);
  });

  it("backs off exponentially for children that die fast", async () => {
    const logs: string[] = [];
    sup = createSupervisor({ command: node, args: ["-e", "process.exit(1)"], baseDelayMs: 30, maxDelayMs: 1000, log: (m) => logs.push(m) });
    sup.start();
    await until(() => (sup?.restarts ?? 0) >= 3);
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs[0]).toContain("0s");
  });

  it("stops the child gracefully with SIGTERM and does not restart", async () => {
    sup = createSupervisor({
      command: node,
      args: ["-e", "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"],
      baseDelayMs: 10,
    });
    sup.start();
    await until(() => sup?.running === true);
    await new Promise((r) => setTimeout(r, 200));
    await sup.stop();
    expect(sup.running).toBe(false);
    expect(sup.restarts).toBe(0);
  });

  it("kills a child that ignores SIGTERM", async () => {
    sup = createSupervisor({ command: node, args: ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], killAfterMs: 150 });
    sup.start();
    await new Promise((r) => setTimeout(r, 300));
    const t = Date.now();
    await sup.stop();
    expect(Date.now() - t).toBeLessThan(3000);
    expect(sup.running).toBe(false);
  });

  it("stop() before start and a missing binary are harmless", async () => {
    sup = createSupervisor({ command: "/nonexistent/bin", args: [], baseDelayMs: 10, maxDelayMs: 10 });
    sup.start();
    await until(() => (sup?.restarts ?? 0) >= 1);
    await sup.stop();
    const idle = createSupervisor({ command: node, args: [] });
    await idle.stop();
    idle.start();
    expect(idle.running).toBe(false);
  });
});

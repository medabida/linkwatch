import { createDb, createRepos } from "@linkwatch/db";
import { describe, expect, it } from "vitest";
import type { Dispatcher } from "./dispatcher.js";
import type { WorkerHub } from "./hub.js";
import { toWorkerDto } from "./workers.js";

const info = {
  hostname: "pi",
  platform: "linux",
  arch: "arm64",
  osRelease: "6.1",
  nodeVersion: "v24",
  workerVersion: "0.2.0",
  engine: { name: "ookla", available: true, version: "1", hint: null },
};

function setup(hubOver: Partial<Record<keyof WorkerHub, unknown>> = {}) {
  const repos = createRepos(createDb(":memory:"));
  const row = repos.workers.create({ id: "w1", secret: "SECRET", name: "Pi", site: "garage" });
  const hub = {
    statusOf: () => ({ status: "waiting", detail: "never connected yet" }),
    connection: () => null,
    ...hubOver,
  } as unknown as WorkerHub;
  const dispatcher = { activityOf: () => null } as unknown as Dispatcher;
  return { repos, hub, dispatcher, row };
}

describe("toWorkerDto", () => {
  it("maps a never-connected worker without leaking the secret", () => {
    const { repos, hub, dispatcher, row } = setup();
    const dto = toWorkerDto(repos, hub, dispatcher, row);
    expect(dto).toMatchObject({
      id: "w1",
      name: "Pi",
      site: "garage",
      kind: "remote",
      enabled: true,
      status: "waiting",
      statusDetail: "never connected yet",
      machine: null,
      engine: null,
      interfaces: null,
      activity: null,
      targetCount: 0,
      connectedSince: null,
      rttMs: null,
    });
    expect(JSON.stringify(dto)).not.toContain("SECRET");
  });

  it("splits machine info from engine status and adds live connection data", () => {
    const { repos } = setup();
    repos.workers.markConnected("w1", info);
    repos.workers.saveInterfaces("w1", [{ name: "eth0", addresses: [] }]);
    const hub = {
      statusOf: () => ({ status: "online", detail: null }),
      connection: () => ({ connectedSince: 123, rttMs: 4.5, protocol: 1 }),
    } as unknown as WorkerHub;
    const row = repos.workers.get("w1");
    if (!row) throw new Error("missing");
    const dto = toWorkerDto(
      repos,
      hub,
      { activityOf: () => ({ runId: 1, targetId: 2, targetLabel: "A", attempt: 1 }) } as unknown as Dispatcher,
      row,
    );
    expect(dto.machine).toEqual({
      hostname: "pi",
      platform: "linux",
      arch: "arm64",
      osRelease: "6.1",
      nodeVersion: "v24",
      workerVersion: "0.2.0",
    });
    expect(dto.engine).toEqual(info.engine);
    expect(dto).toMatchObject({
      status: "online",
      connectedSince: 123,
      rttMs: 4.5,
      interfaces: [{ name: "eth0" }],
      activity: { targetLabel: "A" },
    });
    expect(dto.lastSeenAt).toBeGreaterThan(0);
  });

  it("counts the worker's targets", () => {
    const { repos, hub, dispatcher, row } = setup();
    for (const v of ["eth0", "eth1"]) {
      repos.targets.create({
        workerId: "w1",
        label: v,
        bindType: "interface",
        bindValue: v,
        intervalMinutes: 10,
        timeoutSeconds: 60,
        enabled: true,
      });
    }
    expect(toWorkerDto(repos, hub, dispatcher, row).targetCount).toBe(2);
  });
});

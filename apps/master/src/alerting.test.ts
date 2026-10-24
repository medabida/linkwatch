import { createDb, createRepos, type Repos } from "@linkwatch/db";
import type { AlertRuleInput } from "@linkwatch/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAlerting, duration, inScope } from "./alerting.js";
import { createEventBus } from "./events.js";

const MIN = 60_000;
const BASE = 1_700_000_000_000;

let clock = BASE;
let repos: Repos;
let connected: Set<string>;
let notify: ReturnType<typeof vi.fn>;
let alerting: ReturnType<typeof createAlerting>;
let bus: ReturnType<typeof createEventBus>;
let channelId = 0;
let seq = 0;

beforeEach(() => {
  clock = BASE;
  seq = 0;
  repos = createRepos(createDb(":memory:"), () => clock);
  connected = new Set(["w1"]);
  notify = vi.fn(async () => ({ ok: true as const }));
  bus = createEventBus(() => clock);
  alerting = createAlerting({
    repos,
    hub: { isConnected: (id: string) => connected.has(id) } as never,
    bus,
    notify,
    now: () => clock,
  });
  repos.workers.create({ id: "w1", secret: "s", name: "Local", site: "home", kind: "local" });
  repos.workers.create({ id: "w2", secret: "s", name: "Pi", site: "office" });
  channelId = repos.alerts.channels.create({
    name: "tg",
    type: "telegram",
    botToken: "123456:ABCDEFGHIJKLMNOPQRSTUV",
    chatId: "42",
    enabled: true,
  }).id;
});

const addTarget = (workerId = "w1", label = "A", over = {}) =>
  repos.targets.create({
    workerId,
    label,
    bindType: "interface",
    bindValue: "eth0",
    intervalMinutes: 60,
    timeoutSeconds: 120,
    enabled: true,
    ...over,
  });

const addRule = (condition: AlertRuleInput["condition"], over: Partial<AlertRuleInput> = {}) =>
  repos.alerts.rules.create({
    name: "Rule",
    enabled: true,
    severity: "critical",
    scope: { kind: "all" },
    condition,
    channelIds: [channelId],
    cooldownMinutes: 0,
    renotifyMinutes: 0,
    notifyRecovery: true,
    ...over,
  });

/** One finished test (final attempt) of a target; `onRunFinished` is what the dispatcher event triggers. */
const result = async (
  targetId: number,
  status: "ok" | "failed" | "timeout",
  metrics: Record<string, unknown> = {},
  errorMessage?: string,
) => {
  clock += 10 * MIN;
  const id = repos.runs.start({
    workerId: "w1",
    workerName: "Local",
    site: "home",
    targetId,
    targetLabel: "A",
    bindType: "interface",
    bindValue: "eth0",
    attemptGroupId: `g${++seq}`,
    attemptNumber: 1,
    trigger: "schedule",
    engine: "ookla",
  });
  repos.runs.finish(id, { status, metrics, errorMessage });
  alerting.onRunFinished(targetId);
  await alerting.whenIdle();
};
const texts = () => notify.mock.calls.map((c) => c[1] as string);
const events = () => repos.alerts.events.list({ state: "all", limit: 50 });

describe("test failed", () => {
  it("fires after N failures in a row, notifies once, and announces recovery", async () => {
    const t = addTarget();
    addRule({ type: "test_failed", consecutive: 2 });
    await result(t.id, "failed", {}, "no route");
    expect(events()).toHaveLength(0);
    await result(t.id, "timeout", {}, "timed out");
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain("🔴 [critical] Rule");
    expect(texts()[0]).toContain("A @Local: 2 failed tests in a row (last: timed out)");
    await result(t.id, "failed");
    expect(texts()).toHaveLength(1);
    expect(repos.alerts.events.activeList()).toHaveLength(1);
    await result(t.id, "ok");
    expect(repos.alerts.events.activeList()).toHaveLength(0);
    expect(texts()[1]).toMatch(/^✅ Resolved: Rule\nA @Local \(after \d+ min\)$/);
    expect(events()[0]).toMatchObject({ state: "resolved", resolvedAt: clock });
  });

  it("ignores finished runs that will be retried and runs of disabled workers", async () => {
    const t = addTarget();
    addRule({ type: "test_failed", consecutive: 1 });
    clock += MIN;
    const id = repos.runs.start({
      workerId: "w1",
      workerName: "Local",
      site: "home",
      targetId: t.id,
      targetLabel: "A",
      bindType: "interface",
      bindValue: "eth0",
      attemptGroupId: "g",
      attemptNumber: 1,
      trigger: "schedule",
      engine: "ookla",
    });
    repos.runs.finish(id, { status: "failed" });
    alerting.start();
    bus.emit({ type: "run_finished", runId: id, targetId: t.id, payload: { willRetry: true } });
    expect(events()).toHaveLength(0);
    bus.emit({ type: "run_finished", runId: id, targetId: t.id, payload: { willRetry: false } });
    expect(events()).toHaveLength(1);
    alerting.stop();
  });

  it("respects scope", async () => {
    const a = addTarget("w1", "A");
    const b = addTarget("w2", "B");
    addRule({ type: "test_failed", consecutive: 1 }, { scope: { kind: "site", site: "office" } });
    await result(a.id, "failed");
    expect(events()).toHaveLength(0);
    await result(b.id, "failed");
    expect(events()).toHaveLength(1);
    expect(inScope({ kind: "targets", targetIds: [b.id] }, b, "office")).toBe(true);
    expect(inScope({ kind: "worker", workerId: "w1" }, b, "office")).toBe(false);
  });
});

describe("cooldown, reminders and acknowledgement", () => {
  it("records a re-fire but does not notify again within the cooldown", async () => {
    const t = addTarget();
    addRule({ type: "test_failed", consecutive: 1 }, { cooldownMinutes: 120, notifyRecovery: false });
    await result(t.id, "failed");
    await result(t.id, "ok");
    await result(t.id, "failed");
    expect(events()).toHaveLength(2);
    expect(texts()).toHaveLength(1);
    expect(events()[0]?.notifiedAt).toBeNull();
    clock += 3 * 60 * MIN;
    await result(t.id, "ok");
    await result(t.id, "failed");
    expect(texts()).toHaveLength(2);
  });

  it("reminds while open, until acknowledged", async () => {
    const t = addTarget();
    addRule({ type: "test_failed", consecutive: 1 }, { renotifyMinutes: 30 });
    await result(t.id, "failed");
    await result(t.id, "failed");
    expect(texts()).toHaveLength(1);
    clock += 30 * MIN;
    await result(t.id, "failed");
    expect(texts()).toHaveLength(2);
    expect(texts()[1]).toContain("(still firing)");
    const e = repos.alerts.events.activeList()[0];
    expect(alerting.acknowledge(e?.id ?? 0)?.acknowledgedAt).toBe(clock);
    clock += 60 * MIN;
    await result(t.id, "failed");
    expect(texts()).toHaveLength(2);
  });
});

describe("metric rules", () => {
  it("speed below an absolute threshold needs N slow tests in a row", async () => {
    const t = addTarget();
    addRule({ type: "speed", metric: "downloadBps", mode: "absolute", threshold: 100, consecutive: 2 });
    await result(t.id, "ok", { downloadBps: 50e6 });
    expect(events()).toHaveLength(0);
    await result(t.id, "ok", { downloadBps: 60e6 });
    expect(texts()[0]).toContain("download 60.00 Mbps is below 100.00 Mbps");
    await result(t.id, "ok", { downloadBps: 300e6 });
    expect(repos.alerts.events.activeList()).toHaveLength(0);
  });

  it("failed tests neither fire nor resolve a speed alert", async () => {
    const t = addTarget();
    addRule({ type: "speed", metric: "downloadBps", mode: "absolute", threshold: 100, consecutive: 1 });
    await result(t.id, "ok", { downloadBps: 10e6 });
    await result(t.id, "failed");
    expect(repos.alerts.events.activeList()).toHaveLength(1);
  });

  it("compares with the 7-day baseline and waits for enough history", async () => {
    const t = addTarget();
    addRule({ type: "speed", metric: "downloadBps", mode: "baseline", threshold: 50, consecutive: 1 });
    await result(t.id, "ok", { downloadBps: 10e6 });
    expect(events()).toHaveLength(0);
    for (let i = 0; i < 3; i++) await result(t.id, "ok", { downloadBps: 400e6 });
    await result(t.id, "ok", { downloadBps: 100e6 });
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain("under 50% of the 7-day average");
  });

  it("latency and packet loss thresholds", async () => {
    const t = addTarget();
    addRule({ type: "latency", metric: "pingMs", thresholdMs: 50, consecutive: 1 }, { name: "Ping" });
    addRule({ type: "packet_loss", thresholdPct: 1, consecutive: 1 }, { name: "Loss" });
    await result(t.id, "ok", { pingMs: 20, packetLoss: 0 });
    expect(events()).toHaveLength(0);
    await result(t.id, "ok", { pingMs: 80.55, packetLoss: 2.5 });
    expect(texts().join("|")).toContain("ping 80.5 ms is above 50 ms");
    expect(texts().join("|")).toContain("packet loss 2.50% is above 1%");
    await result(t.id, "ok", { pingMs: null, packetLoss: null });
    expect(repos.alerts.events.activeList()).toHaveLength(2);
  });
});

describe("external IP change", () => {
  it("records a one-shot event when the IP differs from the previous successful test", async () => {
    const t = addTarget();
    addRule({ type: "ip_change" });
    await result(t.id, "ok", { externalIp: "1.1.1.1" });
    await result(t.id, "ok", { externalIp: "1.1.1.1" });
    expect(events()).toHaveLength(0);
    await result(t.id, "ok", { externalIp: "2.2.2.2" });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ state: "resolved", message: "external IP changed from 1.1.1.1 to 2.2.2.2" });
    expect(texts()).toHaveLength(1);
    await result(t.id, "ok", { externalIp: "2.2.2.2" });
    expect(events()).toHaveLength(1);
  });
});

describe("sweep", () => {
  it("flags interfaces without a recent successful test and clears them", async () => {
    const t = addTarget("w1", "A", { intervalMinutes: 60 });
    addRule({ type: "stale", intervals: 2 });
    alerting.sweep();
    expect(events()).toHaveLength(0);
    clock += 3 * 60 * MIN;
    alerting.sweep();
    await alerting.whenIdle();
    expect(texts()[0]).toContain("no successful test for 3 h (expected every 60 min)");
    clock += MIN;
    alerting.sweep();
    expect(texts()).toHaveLength(1);
    await result(t.id, "ok");
    alerting.sweep();
    await alerting.whenIdle();
    expect(repos.alerts.events.activeList()).toHaveLength(0);
  });

  it("flags workers offline longer than the limit", async () => {
    addRule({ type: "worker_offline", minutes: 10 }, { scope: { kind: "worker", workerId: "w2" } });
    repos.workers.touch("w2");
    clock += 5 * MIN;
    alerting.sweep();
    expect(events()).toHaveLength(0);
    clock += 6 * MIN;
    alerting.sweep();
    await alerting.whenIdle();
    expect(texts()[0]).toContain("Pi: offline for 11 min");
    connected.add("w2");
    alerting.sweep();
    await alerting.whenIdle();
    expect(texts()[1]).toContain("✅ Resolved");
    expect(repos.alerts.events.activeList()).toHaveLength(0);
  });

  it("closes alerts silently when the rule is disabled or deleted, or the target is disabled", async () => {
    const a = addTarget("w1", "A");
    const b = addTarget("w1", "B");
    const rule = addRule({ type: "test_failed", consecutive: 1 });
    await result(a.id, "failed");
    await result(b.id, "failed");
    expect(repos.alerts.events.activeList()).toHaveLength(2);
    repos.targets.update(b.id, { ...b, enabled: false });
    alerting.sweep();
    expect(repos.alerts.events.activeList()).toHaveLength(1);
    repos.alerts.rules.update(rule.id, { ...rule, enabled: false });
    alerting.sweep();
    expect(repos.alerts.events.activeList()).toHaveLength(0);
    await alerting.whenIdle();
    expect(texts()).toHaveLength(2);
  });

  it("does not alert for disabled workers", async () => {
    addTarget("w2", "B");
    addRule({ type: "stale", intervals: 1 });
    repos.workers.update("w2", { enabled: false });
    clock += 5 * 60 * MIN;
    alerting.sweep();
    expect(events()).toHaveLength(0);
  });
});

describe("notifications", () => {
  it("skips disabled channels and records failed sends on the channel", async () => {
    const t = addTarget();
    const off = repos.alerts.channels.create({
      name: "off",
      type: "telegram",
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUV",
      chatId: "7",
      enabled: false,
    });
    addRule({ type: "test_failed", consecutive: 1 }, { channelIds: [channelId, off.id, 999] });
    notify.mockResolvedValueOnce({ ok: false, error: "Telegram 401: Unauthorized" });
    await result(t.id, "failed");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(repos.alerts.channels.get(channelId)?.lastError).toBe("Telegram 401: Unauthorized");
    expect(repos.alerts.events.activeList()).toHaveLength(1);
  });

  it("emits alert_changed events on the bus", async () => {
    const t = addTarget();
    addRule({ type: "test_failed", consecutive: 1 });
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type));
    await result(t.id, "failed");
    expect(seen).toEqual(["alert_changed"]);
  });

  it("sends test messages to a channel", async () => {
    expect(await alerting.sendTest(channelId, "hi")).toEqual({ ok: true });
    expect(notify).toHaveBeenCalledWith({ botToken: "123456:ABCDEFGHIJKLMNOPQRSTUV", chatId: "42" }, "hi");
    expect(alerting.sendTest(999, "hi")).toBeUndefined();
  });
});

describe("duration", () => {
  it("formats minutes, hours and days", () => {
    expect([duration(30_000), duration(5 * MIN), duration(90 * MIN), duration(120 * MIN), duration(72 * 60 * MIN)]).toEqual([
      "1 min",
      "5 min",
      "1 h 30 min",
      "2 h",
      "3 days",
    ]);
  });
});

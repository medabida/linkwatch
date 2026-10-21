import type { RunEventDto } from "@linkwatch/shared";
import { describe, expect, it } from "vitest";
import { applyEvent } from "./live.js";

let n = 0;
const ev = (type: RunEventDto["type"], targetId: number | null, payload: Record<string, unknown> = {}): RunEventDto => ({
  id: ++n,
  type,
  runId: 1,
  targetId,
  payload,
  createdAt: 0,
});

describe("applyEvent", () => {
  it("tracks queued -> running -> progress -> finished", () => {
    let s = applyEvent({}, ev("run_queued", 1, { label: "A" }));
    expect(s[1]).toMatchObject({ state: "queued", label: "A" });
    s = applyEvent(s, ev("run_started", 1, { label: "A", attempt: 1, maxAttempts: 3 }));
    expect(s[1]).toMatchObject({ state: "running", attempt: 1 });
    s = applyEvent(s, ev("run_progress", 1, { phase: "download", progress: 0.4, value: 5e7 }));
    expect(s[1]).toMatchObject({ phase: "download", progress: 0.4 });
    s = applyEvent(s, ev("run_finished", 1, { status: "ok", willRetry: false }));
    expect(s).toEqual({});
  });

  it("remembers which worker a run is on, including across retries", () => {
    let s = applyEvent({}, ev("run_started", 1, { label: "A", workerId: "w1", attempt: 1, maxAttempts: 3 }));
    expect(s[1]?.workerId).toBe("w1");
    s = applyEvent(s, ev("run_finished", 1, { status: "failed", willRetry: true, attempt: 1 }));
    expect(s[1]?.workerId).toBe("w1");
  });

  it("ignores worker_changed events", () => {
    expect(applyEvent({}, ev("worker_changed", null, { workerId: "w1" }))).toEqual({});
  });

  it("keeps the target visible when a retry follows", () => {
    let s = applyEvent({}, ev("run_started", 1, { label: "A", attempt: 1, maxAttempts: 3 }));
    s = applyEvent(s, ev("run_finished", 1, { status: "failed", willRetry: true, attempt: 1 }));
    expect(s[1]).toMatchObject({ state: "queued", attempt: 1, maxAttempts: 3 });
  });

  it("does not downgrade a running target to queued", () => {
    let s = applyEvent({}, ev("run_started", 1, { label: "A" }));
    s = applyEvent(s, ev("run_queued", 1));
    expect(s[1]?.state).toBe("running");
  });

  it("ignores events without a target and progress for unknown targets", () => {
    expect(applyEvent({}, ev("run_started", null))).toEqual({});
    expect(applyEvent({}, ev("run_progress", 7, { phase: "ping" }))).toEqual({});
  });
});

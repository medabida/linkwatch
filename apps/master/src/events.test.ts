import { describe, expect, it, vi } from "vitest";
import { createEventBus, relayWorkerChanges } from "./events.js";
import type { WorkerHub } from "./hub.js";

const ev = { type: "run_queued" as const, runId: null, targetId: 1, payload: {} };

describe("event bus", () => {
  it("assigns increasing ids and timestamps and notifies subscribers", () => {
    const bus = createEventBus(() => 5);
    const fn = vi.fn();
    bus.subscribe(fn);
    bus.emit(ev);
    bus.emit(ev);
    expect(fn.mock.calls.map(([e]) => [e.id, e.createdAt])).toEqual([
      [1, 5],
      [2, 5],
    ]);
  });
  it("unsubscribes and isolates failing subscribers", () => {
    const bus = createEventBus();
    const bad = vi.fn(() => {
      throw new Error("x");
    });
    const good = vi.fn();
    bus.subscribe(bad);
    const off = bus.subscribe(good);
    bus.emit(ev);
    expect(good).toHaveBeenCalledTimes(1);
    off();
    bus.emit(ev);
    expect(good).toHaveBeenCalledTimes(1);
    expect(bus.size).toBe(1);
  });
});

describe("relayWorkerChanges", () => {
  it("emits worker_changed events for hub changes until unsubscribed", () => {
    let listener: (id: string) => void = () => {};
    const off = vi.fn();
    const hub = {
      onChange: (fn: (id: string) => void) => {
        listener = fn;
        return off;
      },
    } as unknown as WorkerHub;
    const bus = createEventBus();
    const fn = vi.fn();
    bus.subscribe(fn);
    const stop = relayWorkerChanges(hub, bus);
    listener("w1");
    expect(fn.mock.calls[0]?.[0]).toMatchObject({ type: "worker_changed", payload: { workerId: "w1" }, runId: null, targetId: null });
    stop();
    expect(off).toHaveBeenCalled();
  });
});

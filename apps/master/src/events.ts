import type { RunEventDto } from "@linkwatch/shared";
import type { WorkerHub } from "./hub.js";

export type NewEvent = Omit<RunEventDto, "id" | "createdAt">;

/** In-process pub/sub feeding the SSE stream. Events are not persisted. */
export function createEventBus(now: () => number = Date.now) {
  const listeners = new Set<(e: RunEventDto) => void>();
  let nextId = 1;
  return {
    emit(e: NewEvent): RunEventDto {
      const event: RunEventDto = { ...e, id: nextId++, createdAt: now() };
      for (const l of [...listeners]) {
        try {
          l(event);
        } catch {
          // a broken subscriber must not affect others or the emitter
        }
      }
      return event;
    },
    subscribe(fn: (e: RunEventDto) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get size() {
      return listeners.size;
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;

/** Publishes `worker_changed` whenever the hub reports a worker connection/info/interfaces change. */
export function relayWorkerChanges(hub: WorkerHub, bus: EventBus): () => void {
  return hub.onChange((workerId) => {
    bus.emit({ type: "worker_changed", runId: null, targetId: null, payload: { workerId } });
  });
}

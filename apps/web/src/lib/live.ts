import type { RunEventDto } from "@linkwatch/shared";

export interface ActiveRun {
  targetId: number;
  workerId?: string;
  label: string;
  state: "queued" | "running";
  attempt?: number;
  maxAttempts?: number;
  phase?: string;
  progress?: number;
  value?: number;
}

export type ActiveRuns = Record<number, ActiveRun>;

/** Folds the SSE event stream into "what is happening right now" per target. */
export function applyEvent(state: ActiveRuns, e: RunEventDto): ActiveRuns {
  if (e.targetId === null) return state;
  const id = e.targetId;
  const p = e.payload as Record<string, any>;
  const prev = state[id];
  const label = (p.label as string | undefined) ?? prev?.label ?? `#${id}`;
  switch (e.type) {
    case "run_queued":
      return prev?.state === "running" ? state : { ...state, [id]: { targetId: id, workerId: p.workerId, label, state: "queued" } };
    case "run_started":
      return {
        ...state,
        [id]: { targetId: id, workerId: p.workerId, label, state: "running", attempt: p.attempt, maxAttempts: p.maxAttempts },
      };
    case "run_progress":
      return prev ? { ...state, [id]: { ...prev, phase: p.phase, progress: p.progress, value: p.value } } : state;
    case "run_finished": {
      if (p.willRetry)
        return {
          ...state,
          [id]: {
            targetId: id,
            workerId: p.workerId ?? prev?.workerId,
            label,
            state: "queued",
            attempt: p.attempt,
            maxAttempts: prev?.maxAttempts,
          },
        };
      const { [id]: _done, ...rest } = state;
      return rest;
    }
    default:
      return state;
  }
}

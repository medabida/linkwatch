export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

/** Exponential backoff with jitter (50-100% of the nominal delay). `attempt` starts at 0. */
export function backoffDelay(attempt: number, { baseMs = 1000, maxMs = 30_000, random = Math.random }: BackoffOptions = {}): number {
  const nominal = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
  return Math.round(nominal * (0.5 + random() * 0.5));
}

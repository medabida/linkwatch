import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";

export interface SupervisorOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  log?: (msg: string) => void;
  /** restart delay grows from baseDelayMs to maxDelayMs while the child keeps dying quickly */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** a child that lived this long resets the backoff */
  stableMs?: number;
  /** SIGKILL a child that ignores SIGTERM for this long */
  killAfterMs?: number;
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
}

/** Keeps a child process alive: restarts it with backoff when it dies, stops it gracefully on shutdown. */
export function createSupervisor(opts: SupervisorOptions) {
  const { log = () => {}, baseDelayMs = 1000, maxDelayMs = 30_000, stableMs = 30_000, killAfterMs = 10_000, spawnFn = spawn } = opts;
  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;
  let failures = 0;
  let restarts = 0;

  function start() {
    if (stopping) return;
    const startedAt = Date.now();
    const c = spawnFn(opts.command, opts.args, { env: { ...process.env, ...opts.env }, cwd: opts.cwd, stdio: "inherit" });
    child = c;
    let dead = false;
    const onDead = (what: string) => {
      if (dead) return;
      dead = true;
      if (child === c) child = null;
      if (stopping) return;
      failures = Date.now() - startedAt >= stableMs ? 0 : failures + 1;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(Math.max(failures - 1, 0), 20));
      restarts++;
      log(`local worker ${what}; restarting in ${Math.round(delay / 100) / 10}s`);
      timer = setTimeout(start, delay);
    };
    // a binary that cannot be spawned emits "error" and never "exit"
    c.on("error", (e) => onDead(`failed to start (${e.message})`));
    c.on("exit", (code, signal) => onDead(`exited (${signal ?? code})`));
  }

  return {
    start,
    async stop() {
      stopping = true;
      clearTimeout(timer);
      const c = child;
      if (!c || c.exitCode !== null || c.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const kill = setTimeout(() => c.kill("SIGKILL"), killAfterMs);
        c.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        c.kill("SIGTERM");
      });
    },
    get running() {
      return child !== null;
    },
    get restarts() {
      return restarts;
    },
  };
}

export type Supervisor = ReturnType<typeof createSupervisor>;

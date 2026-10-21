import { spawn } from "node:child_process";

export interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** true when the caller aborted via the signal */
  aborted?: boolean;
  /** e.g. ENOENT when the binary does not exist */
  spawnError?: string;
}

export interface ProcessOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

export type ProcessRunner = (cmd: string, args: string[], opts: ProcessOptions) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = (cmd, args, opts) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let buffer = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    // Own process group: a terminal Ctrl+C must not hit the child directly; we abort it ourselves.
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true });

    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    const finish = (r: Omit<ProcessResult, "stdout" | "stderr" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (buffer && opts.onStdoutLine) opts.onStdoutLine(buffer);
      resolve({ stdout, stderr, timedOut, aborted, ...r });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (!opts.onStdoutLine) return;
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) opts.onStdoutLine(l);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => finish({ exitCode: null, spawnError: (err as NodeJS.ErrnoException).code ?? err.message }));
    child.on("close", (code) => finish({ exitCode: code }));
  });

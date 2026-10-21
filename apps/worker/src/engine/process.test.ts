import { describe, expect, it } from "vitest";
import { runProcess } from "./process.js";

const node = (code: string) => [process.execPath, ["-e", code]] as const;

describe("runProcess (real child processes)", () => {
  it("captures stdout, stderr and exit code, streaming complete lines", async () => {
    const lines: string[] = [];
    const [cmd, args] = node('console.log("a"); console.log("b"); process.stderr.write("warn"); process.exit(3)');
    const r = await runProcess(cmd, [...args], { timeoutMs: 10_000, onStdoutLine: (l) => lines.push(l) });
    expect(r).toMatchObject({ exitCode: 3, stdout: "a\nb\n", stderr: "warn", timedOut: false, aborted: false });
    expect(lines).toEqual(["a", "b"]);
  });

  it("flushes a trailing line without newline", async () => {
    const lines: string[] = [];
    const [cmd, args] = node('process.stdout.write("tail")');
    await runProcess(cmd, [...args], { timeoutMs: 10_000, onStdoutLine: (l) => lines.push(l) });
    expect(lines).toEqual(["tail"]);
  });

  it("reports a missing binary as spawnError", async () => {
    const r = await runProcess("definitely-not-a-binary-xyz", [], { timeoutMs: 5000 });
    expect(r.spawnError).toBe("ENOENT");
  });

  it("kills the process on timeout", async () => {
    const [cmd, args] = node("setInterval(() => {}, 1000)");
    const r = await runProcess(cmd, [...args], { timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
  });

  it("kills the process when aborted", async () => {
    const ac = new AbortController();
    const [cmd, args] = node("setInterval(() => {}, 1000)");
    const p = runProcess(cmd, [...args], { timeoutMs: 30_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 150);
    expect(await p).toMatchObject({ aborted: true, timedOut: false });
  });

  it("kills grandchildren too, so a wrapper script cannot keep the run alive", async () => {
    const ac = new AbortController();
    const started = Date.now();
    const p = runProcess("/bin/sh", ["-c", "sleep 30; echo done"], { timeoutMs: 30_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 150);
    expect(await p).toMatchObject({ aborted: true });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("does not even start work when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const [cmd, args] = node("setInterval(() => {}, 1000)");
    expect((await runProcess(cmd, [...args], { timeoutMs: 30_000, signal: ac.signal })).aborted).toBe(true);
  });
});

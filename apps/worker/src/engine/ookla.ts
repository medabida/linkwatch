import { type EngineStatus, emptyMetrics, type RunMetrics } from "@linkwatch/shared";
import { type ProcessRunner, runProcess } from "./process.js";
import {
  EngineError,
  type EngineProgress,
  type EngineResult,
  type EngineRunOptions,
  type EngineTarget,
  type SpeedTestEngine,
} from "./types.js";

const INSTALL_HINT =
  "Ookla Speedtest CLI not found. Install it from https://www.speedtest.net/apps/cli and make sure `speedtest` is on the PATH of the worker process.";

type Json = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (v === undefined || v === null || v === "" ? null : String(v));
const bps = (bytesPerSecond: unknown): number | null => {
  const n = num(bytesPerSecond);
  return n === null ? null : n * 8;
};

export function parseOoklaResult(r: Json): RunMetrics {
  const m = emptyMetrics();
  m.pingMs = num(r.ping?.latency);
  m.pingJitterMs = num(r.ping?.jitter);
  m.pingLowMs = num(r.ping?.low);
  m.pingHighMs = num(r.ping?.high);
  m.packetLoss = num(r.packetLoss);
  for (const dir of ["download", "upload"] as const) {
    const d = r[dir] ?? {};
    const p = dir;
    m[`${p}Bps`] = bps(d.bandwidth);
    m[`${p}Bytes`] = num(d.bytes);
    m[`${p}ElapsedMs`] = num(d.elapsed);
    m[`${p}LatencyIqmMs`] = num(d.latency?.iqm);
    m[`${p}LatencyLowMs`] = num(d.latency?.low);
    m[`${p}LatencyHighMs`] = num(d.latency?.high);
    m[`${p}LatencyJitterMs`] = num(d.latency?.jitter);
  }
  m.serverId = str(r.server?.id);
  m.serverName = str(r.server?.name);
  m.serverLocation = str(r.server?.location);
  m.serverCountry = str(r.server?.country);
  m.serverHost = str(r.server?.host);
  m.serverIp = str(r.server?.ip);
  m.externalIp = str(r.interface?.externalIp);
  m.internalIp = str(r.interface?.internalIp);
  m.interfaceName = str(r.interface?.name);
  m.interfaceMac = str(r.interface?.macAddr);
  m.isVpn = typeof r.interface?.isVpn === "boolean" ? r.interface.isVpn : null;
  m.isp = str(r.isp);
  m.resultId = str(r.result?.id);
  m.resultUrl = str(r.result?.url);
  return m;
}

export function parseOoklaProgress(line: Json): EngineProgress | null {
  switch (line.type) {
    case "testStart":
      return { phase: "connecting" };
    case "ping":
      return { phase: "ping", progress: num(line.ping?.progress) ?? undefined, value: num(line.ping?.latency) ?? undefined };
    case "download":
    case "upload":
      return {
        phase: line.type,
        progress: num(line[line.type]?.progress) ?? undefined,
        value: bps(line[line.type]?.bandwidth) ?? undefined,
      };
    default:
      return null;
  }
}

function tryParse(line: string): Json | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" ? (v as Json) : null;
  } catch {
    return null;
  }
}

/** Last error message the CLI logged (jsonl log lines or plain stderr). */
function extractError(stdout: string, stderr: string): string | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const j = tryParse(lines[i]?.trim() ?? "");
    if (j?.type === "log" && j.level === "error" && j.message) return String(j.message);
  }
  const s = stderr.trim();
  return s ? (s.split("\n").pop() ?? s) : null;
}

export class OoklaEngine implements SpeedTestEngine {
  readonly name = "ookla";
  private version: string | null = null;

  constructor(
    private readonly exec: ProcessRunner = runProcess,
    private readonly binary = "speedtest",
  ) {}

  async isAvailable(): Promise<EngineStatus> {
    const r = await this.exec(this.binary, ["--version"], { timeoutMs: 10_000 });
    const match = /(\d+\.\d+\.\d+(?:\.\d+)?)/.exec(r.stdout);
    const isOokla = /ookla/i.test(r.stdout);
    if (r.spawnError || r.exitCode !== 0 || !isOokla) {
      this.version = null;
      return {
        name: this.name,
        available: false,
        version: null,
        hint:
          r.spawnError || r.exitCode !== 0
            ? INSTALL_HINT
            : `\`${this.binary}\` is not the Ookla CLI (a different speedtest tool was found). ${INSTALL_HINT}`,
      };
    }
    this.version = match?.[1] ?? null;
    return { name: this.name, available: true, version: this.version, hint: null };
  }

  async run(target: EngineTarget, opts: EngineRunOptions): Promise<EngineResult> {
    const args = [
      "--format=jsonl",
      "--accept-license",
      "--accept-gdpr",
      target.bindType === "ip" ? `--ip=${target.bindValue}` : `--interface=${target.bindValue}`,
    ];
    let result: Json | null = null;

    const r = await this.exec(this.binary, args, {
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      onStdoutLine: (line) => {
        const j = tryParse(line.trim());
        if (!j) return;
        if (j.type === "result") result = j;
        const p = parseOoklaProgress(j);
        if (p) opts.onProgress?.(p);
      },
    });

    if (r.aborted)
      throw new EngineError("Interrupted: worker shut down during the test", "aborted", { stdout: r.stdout, stderr: r.stderr });
    if (r.spawnError) throw new EngineError(INSTALL_HINT, "unavailable", { stderr: r.stderr });
    if (r.timedOut)
      throw new EngineError(`Speed test timed out after ${Math.round(opts.timeoutMs / 1000)}s`, "timeout", {
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
      });
    if (r.exitCode !== 0 || !result) {
      const msg =
        extractError(r.stdout, r.stderr) ??
        (r.exitCode === 0 ? "Speedtest produced no result" : `Speedtest exited with code ${r.exitCode}`);
      throw new EngineError(msg, "failed", { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode });
    }
    return { metrics: parseOoklaResult(result), engineVersion: this.version, raw: result };
  }
}

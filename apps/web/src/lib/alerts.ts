import {
  type AlertCondition,
  type AlertRuleDto,
  type AlertRuleInput,
  type AlertScope,
  alertRuleInputSchema,
  type ChannelDto,
  type TargetDto,
  type WorkerDto,
} from "@linkwatch/shared";

export const TYPE_LABEL = {
  test_failed: "Test failed",
  stale: "Interface stale",
  worker_offline: "Worker offline",
  speed: "Speed",
  latency: "Latency / jitter",
  packet_loss: "Packet loss",
  ip_change: "External IP change",
} as const;

export const SPEED_LABEL = { downloadBps: "Download", uploadBps: "Upload" } as const;
export const LATENCY_LABEL = {
  pingMs: "Ping",
  pingJitterMs: "Jitter",
  downloadLatencyIqmMs: "Latency under download load",
  uploadLatencyIqmMs: "Latency under upload load",
} as const;

export interface RuleForm {
  name: string;
  enabled: boolean;
  severity: "warning" | "critical";
  type: AlertCondition["type"];
  scopeKind: AlertScope["kind"];
  site: string;
  workerId: string;
  targetIds: number[];
  consecutive: string;
  intervals: string;
  minutes: string;
  speedMetric: keyof typeof SPEED_LABEL;
  speedMode: "absolute" | "baseline";
  speedThreshold: string;
  latencyMetric: keyof typeof LATENCY_LABEL;
  thresholdMs: string;
  thresholdPct: string;
  channelIds: number[];
  cooldownMinutes: string;
  renotifyMinutes: string;
  notifyRecovery: boolean;
}

export const EMPTY_RULE: RuleForm = {
  name: "",
  enabled: true,
  severity: "warning",
  type: "test_failed",
  scopeKind: "all",
  site: "",
  workerId: "",
  targetIds: [],
  consecutive: "2",
  intervals: "3",
  minutes: "10",
  speedMetric: "downloadBps",
  speedMode: "baseline",
  speedThreshold: "50",
  latencyMetric: "pingMs",
  thresholdMs: "100",
  thresholdPct: "2",
  channelIds: [],
  cooldownMinutes: "360",
  renotifyMinutes: "0",
  notifyRecovery: true,
};

export const TEMPLATES: { label: string; form: Partial<RuleForm> }[] = [
  {
    label: "Interface down (2 failed tests)",
    form: { name: "Interface down", severity: "critical", type: "test_failed", consecutive: "2" },
  },
  { label: "Interface stale (3 missed intervals)", form: { name: "Interface stale", severity: "warning", type: "stale", intervals: "3" } },
  { label: "Worker offline (10 min)", form: { name: "Worker offline", severity: "critical", type: "worker_offline", minutes: "10" } },
  {
    label: "Download under 50% of baseline",
    form: {
      name: "Slow download",
      type: "speed",
      speedMetric: "downloadBps",
      speedMode: "baseline",
      speedThreshold: "50",
      consecutive: "2",
    },
  },
  {
    label: "High ping (over 100 ms)",
    form: { name: "High ping", type: "latency", latencyMetric: "pingMs", thresholdMs: "100", consecutive: "2" },
  },
  { label: "Packet loss over 2%", form: { name: "Packet loss", type: "packet_loss", thresholdPct: "2", consecutive: "2" } },
  { label: "External IP changed", form: { name: "IP changed", type: "ip_change" } },
];

export function fromRule(r: AlertRuleDto): RuleForm {
  const f: RuleForm = {
    ...EMPTY_RULE,
    name: r.name,
    enabled: r.enabled,
    severity: r.severity,
    type: r.condition.type,
    channelIds: r.channelIds,
    cooldownMinutes: String(r.cooldownMinutes),
    renotifyMinutes: String(r.renotifyMinutes),
    notifyRecovery: r.notifyRecovery,
    scopeKind: r.scope.kind,
  };
  if (r.scope.kind === "site") f.site = r.scope.site;
  if (r.scope.kind === "worker") f.workerId = r.scope.workerId;
  if (r.scope.kind === "targets") f.targetIds = r.scope.targetIds;
  const c = r.condition;
  if (c.type === "test_failed") f.consecutive = String(c.consecutive);
  if (c.type === "stale") f.intervals = String(c.intervals);
  if (c.type === "worker_offline") f.minutes = String(c.minutes);
  if (c.type === "speed")
    Object.assign(f, { speedMetric: c.metric, speedMode: c.mode, speedThreshold: String(c.threshold), consecutive: String(c.consecutive) });
  if (c.type === "latency")
    Object.assign(f, { latencyMetric: c.metric, thresholdMs: String(c.thresholdMs), consecutive: String(c.consecutive) });
  if (c.type === "packet_loss") Object.assign(f, { thresholdPct: String(c.thresholdPct), consecutive: String(c.consecutive) });
  return f;
}

function conditionOf(f: RuleForm): unknown {
  switch (f.type) {
    case "test_failed":
      return { type: f.type, consecutive: f.consecutive };
    case "stale":
      return { type: f.type, intervals: f.intervals };
    case "worker_offline":
      return { type: f.type, minutes: f.minutes };
    case "speed":
      return { type: f.type, metric: f.speedMetric, mode: f.speedMode, threshold: f.speedThreshold, consecutive: f.consecutive };
    case "latency":
      return { type: f.type, metric: f.latencyMetric, thresholdMs: f.thresholdMs, consecutive: f.consecutive };
    case "packet_loss":
      return { type: f.type, thresholdPct: f.thresholdPct, consecutive: f.consecutive };
    case "ip_change":
      return { type: f.type };
  }
}

function scopeOf(f: RuleForm): unknown {
  switch (f.scopeKind) {
    case "all":
      return { kind: "all" };
    case "site":
      return { kind: "site", site: f.site };
    case "worker":
      return { kind: "worker", workerId: f.workerId };
    case "targets":
      return { kind: "targets", targetIds: f.targetIds };
  }
}

export function toInput(f: RuleForm) {
  return alertRuleInputSchema.safeParse({
    name: f.name,
    enabled: f.enabled,
    severity: f.severity,
    scope: scopeOf(f),
    condition: conditionOf(f),
    channelIds: f.channelIds,
    cooldownMinutes: f.cooldownMinutes,
    renotifyMinutes: f.renotifyMinutes,
    notifyRecovery: f.notifyRecovery,
  });
}

export const inputOf = (r: AlertRuleDto): AlertRuleInput => ({
  name: r.name,
  enabled: r.enabled,
  severity: r.severity,
  scope: r.scope,
  condition: r.condition,
  channelIds: r.channelIds,
  cooldownMinutes: r.cooldownMinutes,
  renotifyMinutes: r.renotifyMinutes,
  notifyRecovery: r.notifyRecovery,
});

export function describeCondition(c: AlertCondition): string {
  const times = (n: number) => (n > 1 ? ` ${n} times in a row` : "");
  switch (c.type) {
    case "test_failed":
      return `${c.consecutive} failed test${c.consecutive > 1 ? "s" : ""} in a row`;
    case "stale":
      return `no successful test for ${c.intervals} interval${c.intervals > 1 ? "s" : ""}`;
    case "worker_offline":
      return `offline for more than ${c.minutes} min`;
    case "speed":
      return c.mode === "baseline"
        ? `${SPEED_LABEL[c.metric].toLowerCase()} under ${c.threshold}% of the 7-day average${times(c.consecutive)}`
        : `${SPEED_LABEL[c.metric].toLowerCase()} under ${c.threshold} Mbps${times(c.consecutive)}`;
    case "latency":
      return `${LATENCY_LABEL[c.metric].toLowerCase()} above ${c.thresholdMs} ms${times(c.consecutive)}`;
    case "packet_loss":
      return `packet loss above ${c.thresholdPct}%${times(c.consecutive)}`;
    case "ip_change":
      return "external IP changed";
  }
}

export function describeScope(
  s: AlertScope,
  workers: Pick<WorkerDto, "id" | "name">[],
  targets: Pick<TargetDto, "id" | "label">[],
): string {
  switch (s.kind) {
    case "all":
      return "everything";
    case "site":
      return `site ${s.site}`;
    case "worker":
      return `worker ${workers.find((w) => w.id === s.workerId)?.name ?? s.workerId}`;
    case "targets":
      return s.targetIds.map((id) => targets.find((t) => t.id === id)?.label ?? `#${id}`).join(", ");
  }
}

export const channelNames = (ids: number[], channels: ChannelDto[]) =>
  ids
    .map((id) => channels.find((c) => c.id === id)?.name)
    .filter(Boolean)
    .join(", ") || "in-app only";

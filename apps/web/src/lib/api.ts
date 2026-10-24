import type {
  AlertEventDto,
  AlertRuleDto,
  AlertRuleInput,
  ChannelCreateInput,
  ChannelDto,
  ChannelUpdateInput,
  DashboardDto,
  HealthDto,
  QueueDto,
  RunDetailDto,
  RunsPage,
  SettingsDto,
  SettingsUpdate,
  TargetCreateInput,
  TargetDto,
  WorkerCreateInput,
  WorkerDto,
  WorkerTokenDto,
  WorkerUpdateInput,
} from "@linkwatch/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.issues);
  return data as T;
}

export interface RunsParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  targetId?: number;
  workerId?: string;
  site?: string;
  status?: string;
  from?: number;
  to?: number;
}

export interface DashboardRequest {
  from: number;
  to: number;
  workerId?: string;
  site?: string;
  targetIds?: number[];
  tzOffsetMin: number;
}

export const api = {
  health: () => request<HealthDto>("/api/health"),
  workers: () => request<WorkerDto[]>("/api/workers"),
  createWorker: (w: WorkerCreateInput) => request<WorkerTokenDto>("/api/workers", { method: "POST", body: JSON.stringify(w) }),
  updateWorker: (id: string, patch: WorkerUpdateInput) =>
    request<WorkerDto>(`/api/workers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  rotateWorkerToken: (id: string) => request<WorkerTokenDto>(`/api/workers/${id}/rotate-token`, { method: "POST" }),
  refreshWorker: (id: string) => request<{ requested: boolean }>(`/api/workers/${id}/refresh`, { method: "POST" }),
  deleteWorker: (id: string) => request<void>(`/api/workers/${id}`, { method: "DELETE" }),
  targets: (workerId?: string) => request<TargetDto[]>(workerId ? `/api/targets?workerId=${encodeURIComponent(workerId)}` : "/api/targets"),
  createTarget: (t: TargetCreateInput) => request<TargetDto>("/api/targets", { method: "POST", body: JSON.stringify(t) }),
  updateTarget: (id: number, t: TargetCreateInput) => request<TargetDto>(`/api/targets/${id}`, { method: "PUT", body: JSON.stringify(t) }),
  deleteTarget: (id: number) => request<void>(`/api/targets/${id}`, { method: "DELETE" }),
  runNow: (opts: { targetId?: number; workerId?: string } = {}) =>
    request<{ queued: number }>("/api/runs/run-now", { method: "POST", body: JSON.stringify(opts) }),
  runs: (p: RunsParams) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") q.set(k, String(v));
    return request<RunsPage>(`/api/runs?${q}`);
  },
  dashboard: (p: DashboardRequest) => {
    const q = new URLSearchParams({ from: String(p.from), to: String(p.to), tzOffsetMin: String(p.tzOffsetMin) });
    if (p.workerId) q.set("workerId", p.workerId);
    if (p.site) q.set("site", p.site);
    if (p.targetIds?.length) q.set("targetIds", p.targetIds.join(","));
    return request<DashboardDto>(`/api/dashboard?${q}`);
  },
  queue: () => request<QueueDto>("/api/queue"),
  settings: () => request<SettingsDto>("/api/settings"),
  updateSettings: (patch: SettingsUpdate) => request<SettingsDto>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),
  alertRules: () => request<AlertRuleDto[]>("/api/alerts/rules"),
  createAlertRule: (r: AlertRuleInput) => request<AlertRuleDto>("/api/alerts/rules", { method: "POST", body: JSON.stringify(r) }),
  updateAlertRule: (id: number, r: AlertRuleInput) =>
    request<AlertRuleDto>(`/api/alerts/rules/${id}`, { method: "PUT", body: JSON.stringify(r) }),
  deleteAlertRule: (id: number) => request<void>(`/api/alerts/rules/${id}`, { method: "DELETE" }),
  alertEvents: (state: "active" | "all" = "all", limit = 100) =>
    request<AlertEventDto[]>(`/api/alerts/events?state=${state}&limit=${limit}`),
  ackAlert: (id: number) => request<AlertEventDto>(`/api/alerts/events/${id}/ack`, { method: "POST" }),
  channels: () => request<ChannelDto[]>("/api/alerts/channels"),
  createChannel: (c: ChannelCreateInput) => request<ChannelDto>("/api/alerts/channels", { method: "POST", body: JSON.stringify(c) }),
  updateChannel: (id: number, c: ChannelUpdateInput) =>
    request<ChannelDto>(`/api/alerts/channels/${id}`, { method: "PATCH", body: JSON.stringify(c) }),
  deleteChannel: (id: number) => request<void>(`/api/alerts/channels/${id}`, { method: "DELETE" }),
  testChannel: (id: number) => request<{ ok: true }>(`/api/alerts/channels/${id}/test`, { method: "POST" }),
  run: (id: number) => request<RunDetailDto>(`/api/runs/${id}`),
};

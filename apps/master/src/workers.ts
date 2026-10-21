import type { Repos } from "@linkwatch/db";
import type { WorkerDto } from "@linkwatch/shared";
import type { Dispatcher } from "./dispatcher.js";
import type { WorkerHub } from "./hub.js";

type WorkerRow = NonNullable<ReturnType<Repos["workers"]["get"]>>;

export function toWorkerDto(repos: Repos, hub: WorkerHub, dispatcher: Dispatcher, w: WorkerRow): WorkerDto {
  const { status, detail } = hub.statusOf(w.id);
  const conn = hub.connection(w.id);
  const { engine, ...machine } = w.info ?? {};
  return {
    id: w.id,
    name: w.name,
    site: w.site,
    kind: w.kind,
    enabled: w.enabled,
    status,
    statusDetail: detail,
    createdAt: w.createdAt,
    lastSeenAt: conn ? Date.now() : w.lastSeenAt,
    lastConnectedAt: w.lastConnectedAt,
    connectedSince: conn?.connectedSince ?? null,
    rttMs: conn?.rttMs ?? null,
    machine: w.info ? (machine as WorkerDto["machine"]) : null,
    engine: engine ?? null,
    interfaces: w.interfaces,
    interfacesUpdatedAt: w.interfacesUpdatedAt,
    activity: dispatcher.activityOf(w.id),
    targetCount: repos.targets.listByWorker(w.id).length,
  };
}

import type { WorkerDto } from "@linkwatch/shared";

/** Master address as the browser sees it, in the form workers dial (ws:// or wss://). */
export function defaultMasterAddress(loc: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}`;
}

export const isLoopbackAddress = (addr: string): boolean =>
  /^(?:[a-z]+:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)(?::\d+)?(?:\/|$)/i.test(addr.trim());

export const pairingCommand = (master: string, token: string): string => `pnpm worker --master ${master.trim()} --token ${token}`;

export const STATUS_LABEL: Record<WorkerDto["status"], string> = {
  online: "online",
  reconnecting: "reconnecting",
  offline: "offline",
  waiting: "waiting for first connection",
  disabled: "disabled",
  incompatible: "update worker",
};

export function uptime(since: number | null, now = Date.now()): string {
  if (since === null) return "—";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

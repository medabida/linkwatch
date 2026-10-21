import os from "node:os";
import { INTERFACE_POLL_MS, INTERFACE_RESYNC_MS } from "@linkwatch/protocol";
import type { NetworkInterfaceDto } from "@linkwatch/shared";

export function systemInterfaces(): NetworkInterfaceDto[] {
  return Object.entries(os.networkInterfaces())
    .map(([name, addrs]) => ({
      name,
      addresses: (addrs ?? []).map((a) => ({ address: a.address, family: String(a.family), internal: a.internal })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface InterfaceWatcherOptions {
  list?: () => NetworkInterfaceDto[];
  onReport: (list: NetworkInterfaceDto[]) => void;
  pollMs?: number;
  resyncMs?: number;
}

/** Reports the interface list immediately, whenever it changes (polled), and on a periodic full resync. */
export function startInterfaceWatcher({
  list = systemInterfaces,
  onReport,
  pollMs = INTERFACE_POLL_MS,
  resyncMs = INTERFACE_RESYNC_MS,
}: InterfaceWatcherOptions) {
  let last = JSON.stringify(list());
  onReport(JSON.parse(last));
  const poll = setInterval(() => {
    const cur = list();
    const json = JSON.stringify(cur);
    if (json !== last) {
      last = json;
      onReport(cur);
    }
  }, pollMs);
  const resync = setInterval(() => {
    const cur = list();
    last = JSON.stringify(cur);
    onReport(cur);
  }, resyncMs);
  return {
    /** Forces a report now (e.g. the master asked for it). */
    report() {
      const cur = list();
      last = JSON.stringify(cur);
      onReport(cur);
    },
    stop() {
      clearInterval(poll);
      clearInterval(resync);
    },
  };
}

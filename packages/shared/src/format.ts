export function formatBps(bps: number | null | undefined): string {
  if (bps == null) return "—";
  const mbps = bps / 1_000_000;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

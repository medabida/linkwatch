export const ms = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)} ms`);
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)}%`);
export const duration = (v: number | null | undefined) => (v == null ? "—" : `${(v / 1000).toFixed(1)}s`);
export const bytes = (v: number | null | undefined) => {
  if (v == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = v;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
};
export const dateTime = (v: number | null | undefined) => (v == null ? "—" : new Date(v).toLocaleString());
export const toInputDateTime = (v?: number) => {
  if (v === undefined) return "";
  const d = new Date(v);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Plain-language summary of what the scheduling switches allow. */
export function describeScheduling(s: { parallelSites: boolean; parallelInterfaces: boolean }): string {
  const within = s.parallelInterfaces
    ? "inside a site, interfaces of different workers test at the same time"
    : "inside a site, tests run one at a time";
  const across = s.parallelSites ? "different sites run in parallel" : "only one site is active at a time";
  return `${within[0]?.toUpperCase()}${within.slice(1)}; ${across}. A worker never runs two tests at once.`;
}

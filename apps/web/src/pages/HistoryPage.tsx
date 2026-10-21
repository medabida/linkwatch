import { formatBps, RUN_STATUSES, type RunDto, SORTABLE_RUN_COLUMNS } from "@linkwatch/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, type SortingState, useReactTable, type VisibilityState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { JsonModal } from "../components/JsonModal.js";
import { api, type RunsParams } from "../lib/api.js";
import { bytes, dateTime, duration, ms, pct, toInputDateTime } from "../lib/format.js";

const SORTABLE = new Set<string>(SORTABLE_RUN_COLUMNS);
const PAGE_SIZES = [10, 25, 50, 100];

const columns: ColumnDef<RunDto>[] = [
  { id: "startedAt", header: "Date", accessorFn: (r) => r.startedAt, cell: (c) => dateTime(c.getValue<number>()) },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: (c) => <span className={`badge badge-${c.getValue<string>()}`}>{c.getValue<string>()}</span>,
  },
  { id: "workerName", header: "Worker", accessorKey: "workerName" },
  { id: "site", header: "Site", accessorKey: "site" },
  {
    id: "targetLabel",
    header: "Interface",
    accessorKey: "targetLabel",
    cell: (c) => (
      <>
        {c.row.original.targetLabel} <small className="muted">{c.row.original.bindValue}</small>
      </>
    ),
  },
  { id: "downloadBps", header: "Download", accessorKey: "downloadBps", cell: (c) => formatBps(c.getValue<number | null>()) },
  { id: "uploadBps", header: "Upload", accessorKey: "uploadBps", cell: (c) => formatBps(c.getValue<number | null>()) },
  { id: "pingMs", header: "Ping", accessorKey: "pingMs", cell: (c) => ms(c.getValue<number | null>()) },
  { id: "pingJitterMs", header: "Jitter", accessorKey: "pingJitterMs", cell: (c) => ms(c.getValue<number | null>()) },
  { id: "packetLoss", header: "Loss", accessorKey: "packetLoss", cell: (c) => pct(c.getValue<number | null>()) },
  {
    id: "error",
    header: "Error",
    accessorKey: "errorMessage",
    enableSorting: false,
    cell: (c) => {
      const v = c.getValue<string | null>();
      return v ? (
        <span className="error-text" title={v}>
          {v}
        </span>
      ) : (
        "—"
      );
    },
  },
  {
    id: "serverName",
    header: "Server",
    accessorFn: (r) => [r.serverName, r.serverLocation].filter(Boolean).join(", ") || null,
    cell: (c) => c.getValue<string | null>() ?? "—",
  },
  { id: "isp", header: "ISP", accessorKey: "isp", cell: (c) => c.getValue<string | null>() ?? "—" },
  {
    id: "externalIp",
    header: "External IP",
    accessorKey: "externalIp",
    enableSorting: false,
    cell: (c) => c.getValue<string | null>() ?? "—",
  },
  {
    id: "internalIp",
    header: "Internal IP",
    accessorKey: "internalIp",
    enableSorting: false,
    cell: (c) => c.getValue<string | null>() ?? "—",
  },
  { id: "durationMs", header: "Duration", accessorKey: "durationMs", cell: (c) => duration(c.getValue<number | null>()) },
  { id: "attempt", header: "Attempt", accessorFn: (r) => r.attemptNumber, enableSorting: false },
  { id: "trigger", header: "Trigger", accessorKey: "trigger", enableSorting: false },
  {
    id: "dlLatency",
    header: "DL latency (IQM)",
    accessorKey: "downloadLatencyIqmMs",
    enableSorting: false,
    cell: (c) => ms(c.getValue<number | null>()),
  },
  {
    id: "ulLatency",
    header: "UL latency (IQM)",
    accessorKey: "uploadLatencyIqmMs",
    enableSorting: false,
    cell: (c) => ms(c.getValue<number | null>()),
  },
  { id: "dlBytes", header: "DL data", accessorKey: "downloadBytes", enableSorting: false, cell: (c) => bytes(c.getValue<number | null>()) },
  { id: "ulBytes", header: "UL data", accessorKey: "uploadBytes", enableSorting: false, cell: (c) => bytes(c.getValue<number | null>()) },
  {
    id: "engine",
    header: "Engine",
    accessorFn: (r) => (r.engineVersion ? `${r.engine} ${r.engineVersion}` : r.engine),
    enableSorting: false,
  },
  {
    id: "resultUrl",
    header: "Result",
    accessorKey: "resultUrl",
    enableSorting: false,
    cell: (c) => {
      const v = c.getValue<string | null>();
      return v ? (
        <a href={v} target="_blank" rel="noreferrer">
          open result
        </a>
      ) : (
        "—"
      );
    },
  },
];

const DEFAULT_HIDDEN: VisibilityState = {
  site: false,
  internalIp: false,
  trigger: false,
  dlLatency: false,
  ulLatency: false,
  dlBytes: false,
  ulBytes: false,
  engine: false,
  resultUrl: false,
};

function paramsFromUrl(sp: URLSearchParams): RunsParams {
  const int = (k: string) => {
    const n = Number(sp.get(k));
    return sp.get(k) && Number.isInteger(n) ? n : undefined;
  };
  const sortBy = sp.get("sortBy") ?? "startedAt";
  const status = sp.get("status") ?? undefined;
  return {
    page: Math.max(1, int("page") ?? 1),
    pageSize: PAGE_SIZES.includes(int("pageSize") ?? 0) ? (int("pageSize") as number) : 25,
    sortBy: SORTABLE.has(sortBy) ? sortBy : "startedAt",
    sortDir: sp.get("sortDir") === "asc" ? "asc" : "desc",
    targetId: int("targetId"),
    workerId: sp.get("workerId") || undefined,
    site: sp.get("site") || undefined,
    status: status && (RUN_STATUSES as readonly string[]).includes(status) ? status : undefined,
    from: int("from"),
    to: int("to"),
  };
}

export function HistoryPage() {
  const [sp, setSp] = useSearchParams();
  const params = useMemo(() => paramsFromUrl(sp), [sp]);
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULT_HIDDEN);
  const [detailId, setDetailId] = useState<number | null>(null);

  const targets = useQuery({ queryKey: ["targets"], queryFn: () => api.targets() });
  const workers = useQuery({ queryKey: ["workers"], queryFn: api.workers });
  const sites = [...new Set((workers.data ?? []).map((w) => w.site))].sort();
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["runs", params],
    queryFn: () => api.runs(params),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Record<string, string | number | undefined>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    if (resetPage) next.delete("page");
    setSp(next, { replace: true });
  };

  const sorting: SortingState = [{ id: params.sortBy, desc: params.sortDir === "desc" }];
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize));

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableSortingRemoval: false,
    state: { sorting, columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    onSortingChange: (updater) => {
      const next = (typeof updater === "function" ? updater(sorting) : updater)[0];
      if (next) update({ sortBy: next.id, sortDir: next.desc ? "desc" : "asc" });
    },
    getRowId: (r) => String(r.id),
  });

  return (
    <section>
      <h1>History</h1>

      <div className="filters">
        <label>
          Worker
          <select
            aria-label="Filter by worker"
            value={params.workerId ?? ""}
            onChange={(e) => update({ workerId: e.target.value || undefined })}
          >
            <option value="">All</option>
            {workers.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Site
          <select aria-label="Filter by site" value={params.site ?? ""} onChange={(e) => update({ site: e.target.value || undefined })}>
            <option value="">All</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Interface
          <select
            aria-label="Filter by interface"
            value={params.targetId ?? ""}
            onChange={(e) => update({ targetId: e.target.value || undefined })}
          >
            <option value="">All</option>
            {targets.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Filter by status"
            value={params.status ?? ""}
            onChange={(e) => update({ status: e.target.value || undefined })}
          >
            <option value="">All</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input
            type="datetime-local"
            aria-label="Filter from"
            value={toInputDateTime(params.from)}
            onChange={(e) => update({ from: e.target.value ? new Date(e.target.value).getTime() : undefined })}
          />
        </label>
        <label>
          To
          <input
            type="datetime-local"
            aria-label="Filter to"
            value={toInputDateTime(params.to)}
            onChange={(e) => update({ to: e.target.value ? new Date(e.target.value).getTime() : undefined })}
          />
        </label>
        <button type="button" onClick={() => setSp({}, { replace: true })}>
          Reset
        </button>
        <details className="colulinkwatch-menu">
          <summary>Columns</summary>
          <div>
            {table.getAllLeafColumns().map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={c.getIsVisible()} onChange={c.getToggleVisibilityHandler()} />
                {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
              </label>
            ))}
          </div>
        </details>
      </div>

      {error && <p className="error">{(error as Error).message}</p>}

      <div className={`table-wrap ${isFetching ? "fetching" : ""}`}>
        <table>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const canSort = h.column.getCanSort() && SORTABLE.has(h.column.id);
                  return (
                    <th key={h.id} aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}>
                      {canSort ? (
                        <button
                          type="button"
                          className="th-btn"
                          onClick={() => update({ sortBy: h.column.id, sortDir: sorted === "desc" ? "asc" : "desc" })}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          <span className="sort-ind">{sorted === "asc" ? " ▲" : sorted === "desc" ? " ▼" : ""}</span>
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
                <th>JSON</th>
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className={`row-${row.original.status}`}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
                <td>
                  <button type="button" onClick={() => setDetailId(row.original.id)} aria-label={`View JSON for run ${row.original.id}`}>
                    {"{ }"}
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length + 1} className="empty">
                  No runs found.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length + 1} className="empty">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span>
          {total} run{total === 1 ? "" : "s"}
        </span>
        <label>
          Rows
          <select aria-label="Rows per page" value={params.pageSize} onChange={(e) => update({ pageSize: e.target.value })}>
            {PAGE_SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={params.page <= 1} onClick={() => update({ page: params.page - 1 }, false)}>
          Previous
        </button>
        <span>
          Page {params.page} of {pageCount}
        </span>
        <button type="button" disabled={params.page >= pageCount} onClick={() => update({ page: params.page + 1 }, false)}>
          Next
        </button>
      </div>

      {detailId !== null && <JsonModal runId={detailId} onClose={() => setDetailId(null)} />}
    </section>
  );
}

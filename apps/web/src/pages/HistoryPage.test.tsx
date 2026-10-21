import { emptyMetrics, type RunDto } from "@linkwatch/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calls, mockApi, renderWithProviders } from "../test/utils.js";
import { HistoryPage } from "./HistoryPage.js";

const run = (over: Partial<RunDto>): RunDto => ({
  ...emptyMetrics(),
  id: 1,
  workerId: "w1",
  workerName: "Local",
  site: "default",
  targetId: 1,
  targetLabel: "ISP A",
  bindType: "interface",
  bindValue: "eth0",
  attemptGroupId: "g",
  attemptNumber: 1,
  trigger: "schedule",
  status: "ok",
  engine: "ookla",
  engineVersion: "1.2.0",
  startedAt: Date.UTC(2026, 9, 21, 10),
  finishedAt: Date.UTC(2026, 9, 21, 10, 1),
  durationMs: 14_200,
  errorMessage: null,
  exitCode: 0,
  stderr: null,
  downloadBps: 95_000_000,
  uploadBps: 20_000_000,
  pingMs: 12.4,
  pingJitterMs: 0.8,
  packetLoss: 0.5,
  serverName: "Example",
  serverLocation: "Berlin",
  isp: "Example ISP",
  ...over,
});

const rows = [
  run({
    id: 2,
    status: "failed",
    targetLabel: "ISP B",
    bindValue: "eth1",
    downloadBps: null,
    uploadBps: null,
    pingMs: null,
    pingJitterMs: null,
    packetLoss: null,
    errorMessage: "Couldn't resolve host",
    isp: null,
    serverName: null,
  }),
  run({ id: 1 }),
];

const lastParams = (fn: ReturnType<typeof vi.fn>) => new URL(String(calls(fn, "GET /api/runs").at(-1)?.[0]), "http://x").searchParams;

const setup = (route = "/history") => {
  const fn = mockApi({
    "GET /api/targets": () => [
      { id: 1, label: "ISP A" },
      { id: 2, label: "ISP B" },
    ],
    "GET /api/workers": () => [
      { id: "w1", name: "Local", site: "default" },
      { id: "w2", name: "Pi", site: "garage" },
    ],
    "GET /api/runs": () => ({ rows, total: 60, page: 1, pageSize: 25 }),
    "GET /api/runs/1": () => ({ ...run({ id: 1 }), raw: { type: "result", ping: { latency: 12.4 } } }),
  });
  renderWithProviders(<HistoryPage />, route);
  return fn;
};

afterEach(() => vi.unstubAllGlobals());

describe("HistoryPage", () => {
  it("shows successful and failed runs with values and error", async () => {
    setup();
    expect(await screen.findByText("Couldn't resolve host")).toBeInTheDocument();
    expect(screen.getByText("95.00 Mbps")).toBeInTheDocument();
    expect(screen.getByText("12.4 ms")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("failed")).toBeInTheDocument();
    expect(table.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("60 runs")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("requests the server with defaults, then re-sorts server-side on header click", async () => {
    const fn = setup();
    await screen.findByText("Couldn't resolve host");
    expect(Object.fromEntries(lastParams(fn))).toMatchObject({ page: "1", pageSize: "25", sortBy: "startedAt", sortDir: "desc" });

    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() => {
      expect(lastParams(fn).get("sortBy")).toBe("downloadBps");
      expect(lastParams(fn).get("sortDir")).toBe("desc");
    });
    await userEvent.click(screen.getByRole("button", { name: /Download/ }));
    await waitFor(() => expect(lastParams(fn).get("sortDir")).toBe("asc"));
  });

  it("filters by status and resets to page 1", async () => {
    const fn = setup("/history?page=2");
    await screen.findByText("Couldn't resolve host");
    await userEvent.selectOptions(screen.getByLabelText("Filter by status"), "failed");
    await waitFor(() => {
      expect(lastParams(fn).get("status")).toBe("failed");
      expect(lastParams(fn).get("page")).toBe("1");
    });
  });

  it("filters by interface", async () => {
    const fn = setup();
    await screen.findByText("Couldn't resolve host");
    await userEvent.selectOptions(screen.getByLabelText("Filter by interface"), "ISP B");
    await waitFor(() => expect(lastParams(fn).get("targetId")).toBe("2"));
  });

  it("shows the worker column and filters by worker and site", async () => {
    const fn = setup();
    await screen.findByText("Couldn't resolve host");
    expect(screen.getByRole("columnheader", { name: /Worker/ })).toBeInTheDocument();
    expect(screen.getAllByText("Local").length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText("Filter by worker"), "Pi");
    await waitFor(() => expect(lastParams(fn).get("workerId")).toBe("w2"));
    await userEvent.selectOptions(screen.getByLabelText("Filter by site"), "garage");
    await waitFor(() => expect(lastParams(fn).get("site")).toBe("garage"));
    await userEvent.click(screen.getByText("Columns"));
    const menu = screen.getByText("Columns").closest("details") as HTMLElement;
    await userEvent.click(within(menu).getByLabelText("Site"));
    expect(screen.getByRole("columnheader", { name: /^Site/ })).toBeInTheDocument();
  });

  it("paginates", async () => {
    const fn = setup();
    await screen.findByText("Couldn't resolve host");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastParams(fn).get("page")).toBe("2"));
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("opens the JSON detail view for a run", async () => {
    setup();
    await screen.findByText("Couldn't resolve host");
    await userEvent.click(screen.getByRole("button", { name: "View JSON for run 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Run 1 details" });
    const json = await within(dialog).findByTestId("json");
    expect(JSON.parse(json.textContent ?? "")).toMatchObject({ id: 1, raw: { type: "result" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets the user toggle extra columns", async () => {
    setup();
    await screen.findByText("Couldn't resolve host");
    expect(screen.queryByRole("columnheader", { name: "Internal IP" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Columns"));
    await userEvent.click(screen.getByLabelText("Internal IP"));
    expect(screen.getByRole("columnheader", { name: "Internal IP" })).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    mockApi({
      "GET /api/targets": () => [],
      "GET /api/workers": () => [],
      "GET /api/runs": () => ({ rows: [], total: 0, page: 1, pageSize: 25 }),
    });
    renderWithProviders(<HistoryPage />, "/history");
    expect(await screen.findByText("No runs found.")).toBeInTheDocument();
  });
});

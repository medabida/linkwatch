import type { DashboardDto } from "@linkwatch/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calls, mockApi, renderWithProviders } from "../test/utils.js";
import { HomePage } from "./HomePage.js";

const block = (v: number) => ({ avg: v, min: v, max: v, p50: v, p95: v });
const T = Date.UTC(2026, 0, 1, 10, 0);

const dashboard = (over: Partial<DashboardDto> = {}): DashboardDto => ({
  from: T - 3_600_000,
  to: T + 3_600_000,
  bucketMs: 600_000,
  targets: [
    {
      key: "1",
      targetId: 1,
      label: "VLAN 120",
      workerName: "Local",
      site: "default",
      bindValue: "eth1",
      enabled: true,
      intervalMinutes: 10,
    },
    {
      key: "2",
      targetId: 2,
      label: "VLAN 130",
      workerName: "Local",
      site: "default",
      bindValue: "eth2",
      enabled: true,
      intervalMinutes: 10,
    },
  ],
  series: [
    { key: "1", t: T, n: 2, ok: 2, failed: 0, metrics: { downloadBps: block(200e6), uploadBps: block(100e6), pingMs: block(10) } },
    { key: "2", t: T, n: 2, ok: 0, failed: 2, metrics: {} },
  ],
  summary: {
    tests: 4,
    ok: 2,
    failed: 2,
    successRate: 50,
    downloadBps: block(200e6),
    uploadBps: block(100e6),
    pingMs: block(10),
    pingJitterMs: block(2),
    packetLoss: block(0),
    downloadBytes: 2e9,
    uploadBytes: 1e9,
  },
  comparison: [],
  usage: [],
  heatmap: [{ key: "1", hour: 10, n: 2, downloadBps: 200e6 }],
  baseline: [{ key: "1", latestBps: 150e6, latestAt: T, medianBps: 200e6, deviationPct: -25 }],
  health: [
    { key: "1", lastRunAt: T, lastStatus: "ok", lastOkAt: T, lastError: null, stale: false },
    { key: "2", lastRunAt: T, lastStatus: "failed", lastOkAt: null, lastError: "Network is unreachable", stale: true },
  ],
  servers: [
    { name: "Sewan", location: "Brussels", host: "speedtest.sewan.be", tests: 2, downloadBps: 200e6, uploadBps: 100e6, pingMs: 10 },
  ],
  identity: [{ key: "1", at: T, externalIp: "1.2.3.4", isp: "NordVPN", isVpn: false, previousExternalIp: null, previousIsp: null }],
  ...over,
});

const routes = (data: DashboardDto = dashboard()) => ({
  "GET /api/workers": () => [{ id: "w1", name: "Local", site: "default" }],
  "GET /api/targets": () => [
    { id: 1, label: "VLAN 120" },
    { id: 2, label: "VLAN 130" },
  ],
  "GET /api/dashboard": () => data,
});

afterEach(() => vi.unstubAllGlobals());

describe("HomePage", () => {
  it("shows KPIs, panels and the chart cards", async () => {
    mockApi(routes());
    renderWithProviders(<HomePage />, "/");
    expect((await screen.findAllByText("200.00 Mbps")).length).toBeGreaterThan(0);
    const kpis = within(document.querySelector(".kpis") as HTMLElement);
    expect(kpis.getByText("Download").closest(".kpi")).toHaveTextContent("200.00 Mbps");
    expect(screen.getByText("50.00%")).toBeInTheDocument();
    expect(screen.getByText("2 ok, 2 failed")).toBeInTheDocument();
    for (const title of [
      "Download speed",
      "Upload speed",
      "Ping",
      "Jitter",
      "Reliability",
      "Packet loss",
      "Outage timeline",
      "Download by hour of day",
      "Data usage",
    ]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "Latency under load: download" })).toBeInTheDocument();
  });

  it("flags the baseline deviation, stale interfaces and the last error", async () => {
    mockApi(routes());
    renderWithProviders(<HomePage />, "/");
    const baseline = within(await screen.findByRole("region", { name: "Speed vs 7-day baseline" }));
    expect(baseline.getByText("-25%")).toHaveClass("dev-bad");
    const health = within(screen.getByRole("region", { name: "Interface health" }));
    expect(health.getByText("stale")).toBeInTheDocument();
    expect(health.getByText(/Network is unreachable/)).toBeInTheDocument();
  });

  it("renders the outage timeline states and the heatmap cell", async () => {
    mockApi(routes());
    renderWithProviders(<HomePage />, "/");
    const timeline = await screen.findByRole("region", { name: "Outage timeline" });
    expect(timeline.querySelectorAll(".tl-ok")).toHaveLength(1);
    expect(timeline.querySelectorAll(".tl-down")).toHaveLength(1);
    const heat = screen.getByRole("region", { name: "Download by hour of day" });
    expect(
      within(heat)
        .getAllByRole("cell")
        .some((c) => c.getAttribute("title")?.includes("200.00 Mbps")),
    ).toBe(true);
  });

  it("lists servers and identity changes", async () => {
    mockApi(routes());
    renderWithProviders(<HomePage />, "/");
    expect(await screen.findByText("Sewan")).toBeInTheDocument();
    expect(screen.getByText("1.2.3.4")).toBeInTheDocument();
    expect(screen.getByText("first seen")).toBeInTheDocument();
  });

  it("says so when there are no tests", async () => {
    mockApi(
      routes(
        dashboard({ series: [], summary: { ...dashboard().summary, tests: 0, ok: 0, failed: 0, successRate: null, downloadBps: null } }),
      ),
    );
    renderWithProviders(<HomePage />, "/");
    expect(await screen.findByText("No finished tests in this range yet.")).toBeInTheDocument();
  });

  it("sends the range, filters and timezone to the API", async () => {
    const fn = mockApi(routes());
    renderWithProviders(<HomePage />, "/?range=7d&workerId=w1&site=default&targets=2");
    await screen.findByRole("region", { name: "Download speed" });
    const url = new URL(String(calls(fn, "GET /api/dashboard")[0]?.[0]), "http://localhost");
    expect(Number(url.searchParams.get("to")) - Number(url.searchParams.get("from"))).toBe(7 * 86_400_000);
    expect(url.searchParams.get("workerId")).toBe("w1");
    expect(url.searchParams.get("site")).toBe("default");
    expect(url.searchParams.get("targetIds")).toBe("2");
    expect(url.searchParams.get("tzOffsetMin")).not.toBeNull();
  });

  it("changes the range and toggles an interface", async () => {
    const fn = mockApi(routes());
    renderWithProviders(<HomePage />, "/");
    await screen.findByRole("region", { name: "Download speed" });
    await userEvent.selectOptions(screen.getByLabelText("Time range"), "1h");
    await waitFor(() => {
      const last = new URL(String(calls(fn, "GET /api/dashboard").at(-1)?.[0]), "http://localhost");
      expect(Number(last.searchParams.get("to")) - Number(last.searchParams.get("from"))).toBe(3_600_000);
    });
    await userEvent.click(screen.getByLabelText("VLAN 130"));
    await waitFor(() => {
      const last = new URL(String(calls(fn, "GET /api/dashboard").at(-1)?.[0]), "http://localhost");
      expect(last.searchParams.get("targetIds")).toBe("2");
    });
  });

  it("loads the previous period when comparing", async () => {
    const fn = mockApi(routes());
    renderWithProviders(<HomePage />, "/?compare=1");
    await screen.findByRole("region", { name: "Download speed" });
    await waitFor(() => expect(calls(fn, "GET /api/dashboard")).toHaveLength(2));
    const [a, b] = calls(fn, "GET /api/dashboard").map(([u]) => new URL(String(u), "http://localhost").searchParams);
    expect(Number(b?.get("to"))).toBe(Number(a?.get("from")));
  });

  it("shows API errors", async () => {
    mockApi({ ...routes(), "GET /api/dashboard": () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }) });
    renderWithProviders(<HomePage />, "/");
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});

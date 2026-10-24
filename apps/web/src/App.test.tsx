import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { mockApi, renderWithProviders } from "./test/utils.js";

const emptyDashboard = {
  from: 0,
  to: 1,
  bucketMs: 60_000,
  targets: [],
  series: [],
  summary: {
    tests: 0,
    ok: 0,
    failed: 0,
    successRate: null,
    downloadBps: null,
    uploadBps: null,
    pingMs: null,
    pingJitterMs: null,
    packetLoss: null,
    downloadBytes: 0,
    uploadBytes: 0,
  },
  comparison: [],
  usage: [],
  heatmap: [],
  baseline: [],
  health: [],
  servers: [],
  identity: [],
};

const routes = {
  "GET /api/health": () => ({ engine: null, worker: { alive: true, lastSeenAt: 1, version: "0.2.0" } }),
  "GET /api/workers": () => [],
  "GET /api/targets": () => [],
  "GET /api/runs": () => ({ rows: [], total: 0, page: 1, pageSize: 25 }),
  "GET /api/dashboard": () => emptyDashboard,
};

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows the brand and navigation", async () => {
    mockApi(routes);
    renderWithProviders(<App />, "/history");
    expect(screen.getByText("LinkWatch")).toBeInTheDocument();
    for (const name of ["Home", "History", "Workers", "Monitoring"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it.each([
    ["/", "Home"],
    ["/history", "History"],
    ["/workers", "Workers"],
    ["/monitoring", "Monitoring"],
  ])("renders %s", async (route, heading) => {
    mockApi(routes);
    renderWithProviders(<App />, route);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("redirects unknown routes (including the old /settings) to Home", async () => {
    mockApi(routes);
    renderWithProviders(<App />, "/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });
});

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
  "GET /api/settings": () => ({ parallelSites: true, parallelInterfaces: false }),
};

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows the brand and navigation", async () => {
    mockApi(routes);
    renderWithProviders(<App />, "/history");
    expect(screen.getByText("LinkWatch")).toBeInTheDocument();
    for (const name of ["Home", "History", "Workers", "Monitoring", "Settings"])
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
  });

  it.each([
    ["/", "Home"],
    ["/history", "History"],
    ["/workers", "Workers"],
    ["/monitoring", "Monitoring"],
    ["/settings", "Settings"],
  ])("renders %s", async (route, heading) => {
    mockApi(routes);
    renderWithProviders(<App />, route);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("redirects unknown routes to Home", async () => {
    mockApi(routes);
    renderWithProviders(<App />, "/nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  });
});

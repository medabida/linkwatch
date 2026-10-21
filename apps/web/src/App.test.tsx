import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { mockApi, renderWithProviders } from "./test/utils.js";

const routes = {
  "GET /api/health": () => ({ engine: null, worker: { alive: true, lastSeenAt: 1, version: "0.2.0" } }),
  "GET /api/workers": () => [],
  "GET /api/targets": () => [],
  "GET /api/runs": () => ({ rows: [], total: 0, page: 1, pageSize: 25 }),
};

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows the brand and navigation", async () => {
    mockApi(routes);
    renderWithProviders(<App />, "/history");
    expect(screen.getByText("LinkWatch")).toBeInTheDocument();
    for (const name of ["History", "Workers", "Monitoring"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it.each([
    ["/workers", "Workers"],
    ["/monitoring", "Monitoring"],
  ])("renders %s", async (route, heading) => {
    mockApi(routes);
    renderWithProviders(<App />, route);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("redirects unknown routes (including the old /settings) to History", async () => {
    mockApi(routes);
    renderWithProviders(<App />, "/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "History" })).toBeInTheDocument();
  });
});

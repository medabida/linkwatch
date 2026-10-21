import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../test/utils.js";
import { StatusBar } from "./StatusBar.js";

const health = {
  engine: { name: "ookla", available: true, version: "1", hint: null },
  worker: { alive: true, lastSeenAt: 1, version: "0.2.0" },
};
const remote = (over = {}) => ({ id: "w2", name: "Pi", kind: "remote", enabled: true, status: "online", ...over });

const setup = (h: unknown, workers: unknown[]) => mockApi({ "GET /api/health": () => h, "GET /api/workers": () => workers });

afterEach(() => vi.unstubAllGlobals());

describe("StatusBar", () => {
  it("shows nothing when everything is healthy", async () => {
    const fn = setup(health, [remote()]);
    const { container } = renderWithProviders(<StatusBar />);
    await vi.waitFor(() => expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector(".banner")).toBeNull();
  });

  it("warns when the local worker is not connected", async () => {
    setup({ ...health, worker: { ...health.worker, alive: false } }, []);
    renderWithProviders(<StatusBar />);
    expect(await screen.findByText(/local worker is not connected/)).toBeInTheDocument();
  });

  it("shows the Ookla install hint when the engine is unavailable", async () => {
    setup({ ...health, engine: { name: "ookla", available: false, version: null, hint: "Install the Ookla CLI" } }, []);
    renderWithProviders(<StatusBar />);
    expect(await screen.findByText("Install the Ookla CLI")).toBeInTheDocument();
  });

  it("lists offline and incompatible enabled remote workers only", async () => {
    setup(health, [
      remote({ id: "a", name: "Down", status: "offline" }),
      remote({ id: "b", name: "Old", status: "incompatible" }),
      remote({ id: "c", name: "Off", status: "offline", enabled: false }),
      remote({ id: "d", name: "Local", kind: "local", status: "offline" }),
      remote({ id: "e", name: "Fine" }),
    ]);
    renderWithProviders(<StatusBar />);
    expect(await screen.findByText("Down")).toBeInTheDocument();
    expect(screen.getByText(/is offline/)).toBeInTheDocument();
    expect(screen.getByText("Old").parentElement).toHaveTextContent("running an incompatible version");
    for (const n of ["Off", "Local", "Fine"]) expect(screen.queryByText(n)).not.toBeInTheDocument();
  });
});

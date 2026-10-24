import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calls, mockApi, renderWithProviders } from "../test/utils.js";
import { SettingsPage } from "./SettingsPage.js";

afterEach(() => vi.unstubAllGlobals());

const serve = (initial = { parallelSites: true, parallelInterfaces: false }) => {
  let current = { ...initial };
  const fn = mockApi({
    "GET /api/settings": () => current,
    "PATCH /api/settings": (_url, init) => {
      current = { ...current, ...JSON.parse(String(init?.body)) };
      return current;
    },
  });
  return fn;
};

describe("SettingsPage", () => {
  it("shows both switches with the current values and a summary", async () => {
    serve();
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByRole("switch", { name: "Parallel sites" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Parallel interfaces" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("Inside a site, tests run one at a time; different sites run in parallel.");
  });

  it("saves a toggle immediately and updates the summary", async () => {
    const fn = serve();
    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole("switch", { name: "Parallel interfaces" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Parallel interfaces" })).toBeChecked());
    expect(JSON.parse(String(calls(fn, "PATCH /api/settings")[0]?.[1]?.body))).toEqual({ parallelInterfaces: true });
    expect(screen.getByRole("status")).toHaveTextContent("interfaces of different workers test at the same time");
    await userEvent.click(screen.getByRole("switch", { name: "Parallel sites" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Parallel sites" })).not.toBeChecked());
    expect(screen.getByRole("status")).toHaveTextContent("only one site is active at a time");
  });

  it("shows save errors", async () => {
    mockApi({
      "GET /api/settings": () => ({ parallelSites: true, parallelInterfaces: false }),
      "PATCH /api/settings": () => new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    });
    renderWithProviders(<SettingsPage />);
    await userEvent.click(await screen.findByRole("switch", { name: "Parallel sites" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });
});

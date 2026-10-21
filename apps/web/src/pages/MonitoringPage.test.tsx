import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calls, mockApi, renderWithProviders } from "../test/utils.js";
import { MonitoringPage } from "./MonitoringPage.js";

const worker = {
  id: "w1",
  name: "Local",
  status: "online",
  interfaces: [{ name: "eth0", addresses: [{ address: "192.168.1.10", family: "IPv4", internal: false }] }],
};
const target = {
  id: 1,
  workerId: "w1",
  label: "ISP A",
  bindType: "interface",
  bindValue: "eth0",
  intervalMinutes: 30,
  timeoutSeconds: 120,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};
const pickInterface = async (name: string) => {
  await screen.findByRole("option", { name: new RegExp(name) });
  await userEvent.selectOptions(screen.getByLabelText(/^Interface/), name);
};
const openAdd = async () => userEvent.click(await screen.findByRole("button", { name: "Add interface" }));
const body = (fn: ReturnType<typeof vi.fn>, key: string, i = 0) => JSON.parse(String(calls(fn, key)[i]?.[1]?.body));

const setup = (targets: unknown[] = []) =>
  mockApi({
    "GET /api/targets": () => targets,
    "GET /api/workers": () => [
      worker,
      {
        ...worker,
        id: "w2",
        name: "Pi",
        interfaces: [{ name: "wlan0", addresses: [{ address: "192.168.1.20", family: "IPv4", internal: false }] }],
      },
    ],
    "POST /api/targets": () => ({ ...target, id: 2 }),
    "PUT /api/targets/1": () => target,
    "DELETE /api/targets/1": () => new Response(null, { status: 204 }),
    "POST /api/runs/run-now": () => ({ queued: 1 }),
    "POST /api/workers/w1/refresh": () => ({ requested: true }),
    "POST /api/workers/w2/refresh": () => ({ requested: true }),
  });

afterEach(() => vi.unstubAllGlobals());

describe("MonitoringPage", () => {
  it("lists configured interfaces", async () => {
    setup([target]);
    renderWithProviders(<MonitoringPage />);
    expect(await screen.findByText("ISP A")).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
  });

  it("shows the owning worker and flags interfaces the worker no longer reports", async () => {
    setup([target, { ...target, id: 3, label: "Gone", bindValue: "eth9" }]);
    renderWithProviders(<MonitoringPage />);
    expect(await screen.findByText("Gone")).toBeInTheDocument();
    expect(screen.getAllByText("Local").length).toBeGreaterThan(0);
    expect(screen.getAllByText("not detected")).toHaveLength(1);
  });

  it("offers the interfaces of the selected worker and sends its id", async () => {
    const fn = setup();
    renderWithProviders(<MonitoringPage />);
    await openAdd();
    await userEvent.type(await screen.findByLabelText("Label"), "Wifi");
    await screen.findByRole("option", { name: /^eth0/ });
    await userEvent.selectOptions(screen.getByLabelText("Worker"), "w2");
    expect(screen.queryByRole("option", { name: /^eth0/ })).not.toBeInTheDocument();
    await pickInterface("wlan0");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(fn, "POST /api/targets")).toHaveLength(1));
    expect(body(fn, "POST /api/targets")).toMatchObject({ workerId: "w2", bindValue: "wlan0" });
  });

  it("asks the worker to refresh its interfaces and warns when it is offline", async () => {
    mockApi({
      "GET /api/targets": () => [],
      "GET /api/workers": () => [{ ...worker, status: "offline" }],
      "POST /api/workers/w1/refresh": () => ({ requested: false }),
    });
    renderWithProviders(<MonitoringPage />);
    await openAdd();
    expect(await screen.findByText(/Local is offline: showing its last known interfaces/)).toBeInTheDocument();
  });

  it("validates client-side and does not call the API", async () => {
    const fn = setup();
    renderWithProviders(<MonitoringPage />);
    await openAdd();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Label is required")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Label/), "ISP A");
    await pickInterface("eth0");
    const interval = screen.getByLabelText(/Interval/);
    await userEvent.clear(interval);
    await userEvent.type(interval, "2");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Minimum interval is 5 minutes")).toBeInTheDocument();
    expect(calls(fn, "POST /api/targets")).toHaveLength(0);
  });

  it("creates a target with the entered values", async () => {
    const fn = setup();
    renderWithProviders(<MonitoringPage />);
    await openAdd();
    await userEvent.type(await screen.findByLabelText("Label"), "ISP A");
    await pickInterface("eth0");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(fn, "POST /api/targets")).toHaveLength(1));
    expect(body(fn, "POST /api/targets")).toEqual({
      workerId: "w1",
      label: "ISP A",
      bindType: "interface",
      bindValue: "eth0",
      intervalMinutes: 60,
      timeoutSeconds: 120,
      enabled: true,
    });
  });

  it("edits an existing target", async () => {
    const fn = setup([target]);
    renderWithProviders(<MonitoringPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const label = screen.getByLabelText(/^Label/);
    await userEvent.clear(label);
    await userEvent.type(label, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls(fn, "PUT /api/targets/1")).toHaveLength(1));
    expect(body(fn, "PUT /api/targets/1").label).toBe("Renamed");
  });

  it("shows no form until Add/Edit opens a dialog, and closes it again", async () => {
    setup([target]);
    renderWithProviders(<MonitoringPage />);
    await screen.findByText("ISP A");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openAdd();
    expect(screen.getByRole("dialog", { name: "Add interface" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit interface" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the dialog after a successful save", async () => {
    const fn = setup();
    renderWithProviders(<MonitoringPage />);
    await openAdd();
    await userEvent.type(await screen.findByLabelText("Label"), "ISP A");
    await pickInterface("eth0");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls(fn, "POST /api/targets")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("toggles enabled", async () => {
    const fn = setup([target]);
    renderWithProviders(<MonitoringPage />);
    await userEvent.click(await screen.findByLabelText("Enable ISP A"));
    await waitFor(() => expect(calls(fn, "PUT /api/targets/1")).toHaveLength(1));
    expect(body(fn, "PUT /api/targets/1").enabled).toBe(false);
  });

  it("asks for confirmation before deleting", async () => {
    const fn = setup([target]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<MonitoringPage />);
    const del = await screen.findByRole("button", { name: "Delete" });
    await userEvent.click(del);
    expect(calls(fn, "DELETE /api/targets/1")).toHaveLength(0);
    await userEvent.click(del);
    await waitFor(() => expect(calls(fn, "DELETE /api/targets/1")).toHaveLength(1));
    confirm.mockRestore();
  });

  it("requests a run for one target or all", async () => {
    const fn = setup([target]);
    renderWithProviders(<MonitoringPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(calls(fn, "POST /api/runs/run-now")).toHaveLength(1));
    expect(body(fn, "POST /api/runs/run-now", 0)).toEqual({ targetId: 1 });
    expect(await screen.findByText("1 test queued.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run all enabled now" }));
    await waitFor(() => expect(calls(fn, "POST /api/runs/run-now")).toHaveLength(2));
    expect(body(fn, "POST /api/runs/run-now", 1)).toEqual({});
  });

  it("shows server-side validation errors", async () => {
    mockApi({
      "GET /api/targets": () => [],
      "GET /api/workers": () => [worker],
      "POST /api/targets": () =>
        new Response(JSON.stringify({ error: "Validation failed", issues: [{ path: "bindValue", message: "Server says no" }] }), {
          status: 400,
        }),
    });
    renderWithProviders(<MonitoringPage />);
    await openAdd();
    await userEvent.type(await screen.findByLabelText("Label"), "X");
    await userEvent.selectOptions(screen.getByLabelText(/^Interface/), "Custom…");
    await userEvent.type(screen.getByLabelText("Custom interface"), "eth0");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Server says no")).toBeInTheDocument();
  });
});

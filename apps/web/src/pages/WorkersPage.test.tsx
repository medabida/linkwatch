import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calls, mockApi, renderWithProviders } from "../test/utils.js";
import { WorkersPage } from "./WorkersPage.js";

const machine = { hostname: "pi4", platform: "linux", arch: "arm64", osRelease: "6.1", nodeVersion: "v24.0.0", workerVersion: "0.2.0" };
const base = {
  site: "default",
  enabled: true,
  statusDetail: null,
  createdAt: 0,
  lastSeenAt: 1_000_000,
  lastConnectedAt: 1_000_000,
  connectedSince: null,
  rttMs: null,
  machine: null,
  engine: null,
  interfaces: null,
  interfacesUpdatedAt: null,
  activity: null,
  targetCount: 0,
};
const local = {
  ...base,
  id: "w1",
  name: "Local",
  kind: "local",
  status: "online",
  connectedSince: Date.now() - 125_000,
  rttMs: 3.2,
  machine,
  engine: { name: "ookla", available: true, version: "1.2.0", hint: null },
  interfaces: [{ name: "eth0", addresses: [{ address: "10.0.0.2", family: "IPv4", internal: false }] }],
  interfacesUpdatedAt: 5,
  targetCount: 2,
  activity: { runId: 1, targetId: 1, targetLabel: "ISP A", attempt: 1, phase: "download", progress: 0.5, value: 5e7 },
};
const pi = {
  ...base,
  id: "w2",
  name: "Garage Pi",
  kind: "remote",
  status: "waiting",
  lastConnectedAt: null,
  lastSeenAt: null,
  site: "garage",
};
const targets = [
  { id: 1, workerId: "w1", label: "ISP A", bindType: "interface", bindValue: "eth0", enabled: true },
  { id: 2, workerId: "w1", label: "ISP B", bindType: "interface", bindValue: "eth9", enabled: true },
];
const token = "w2abc.secret";

const setup = (workers: unknown[] = [local, pi]) =>
  mockApi({
    "GET /api/workers": () => workers,
    "GET /api/targets": () => targets,
    "GET /api/runs": () => ({ rows: [{ id: 9, targetId: 1, status: "ok", downloadBps: 95e6 }], total: 1, page: 1, pageSize: 100 }),
    "POST /api/workers": () => ({ worker: { ...pi, name: "New" }, token }),
    "PATCH /api/workers/w2": () => pi,
    "POST /api/workers/w2/rotate-token": () => ({ worker: pi, token: "w2abc.rotated" }),
    "DELETE /api/workers/w2": () => new Response(null, { status: 204 }),
    "POST /api/workers/w1/refresh": () => ({ requested: true }),
    "POST /api/runs/run-now": () => ({ queued: 2 }),
  });
const body = (fn: ReturnType<typeof vi.fn>, key: string, i = 0) => JSON.parse(String(calls(fn, key)[i]?.[1]?.body));
const card = async (name: string) => within(await screen.findByRole("article", { name: `Worker ${name}` }));

afterEach(() => vi.unstubAllGlobals());

describe("WorkersPage", () => {
  it("shows status, machine, engine, latency, activity, interfaces and targets", async () => {
    setup();
    renderWithProviders(<WorkersPage />);
    const c = await card("Local");
    expect(c.getByText("online")).toBeInTheDocument();
    expect(c.getByText("local")).toBeInTheDocument();
    expect(c.getByText(/pi4 · linux arm64 · Node v24.0.0 · worker 0.2.0/)).toBeInTheDocument();
    expect(c.getByText(/ookla 1.2.0/)).toBeInTheDocument();
    expect(c.getByText(/3.2 ms/)).toBeInTheDocument();
    expect(c.getAllByText("ISP A", { selector: "strong" })).toHaveLength(2);
    expect(c.getByText(/download 50%/)).toBeInTheDocument();
    expect(c.getByText("eth0", { selector: "li.chips li, .chips li" })).toBeInTheDocument();
    expect(c.getByText("Targets (2)")).toBeInTheDocument();
    expect(await c.findByText("ok 95.00 Mbps")).toBeInTheDocument();
  });

  it("flags configured interfaces that the worker no longer reports", async () => {
    setup();
    renderWithProviders(<WorkersPage />);
    const c = await card("Local");
    expect(c.getAllByText("not detected on this worker")).toHaveLength(1);
  });

  it("shows waiting workers without machine info and disables actions that need a connection", async () => {
    setup();
    renderWithProviders(<WorkersPage />);
    const c = await card("Garage Pi");
    expect(c.getByText("waiting for first connection")).toBeInTheDocument();
    expect(c.getByText("Not reported yet.")).toBeInTheDocument();
    expect(c.getByRole("button", { name: "Run now" })).toBeDisabled();
    expect(c.getByRole("button", { name: "Refresh interfaces" })).toBeDisabled();
    expect(c.getByText("idle")).toBeInTheDocument();
  });

  it("does not offer remove or rotate for the local worker", async () => {
    setup();
    renderWithProviders(<WorkersPage />);
    const c = await card("Local");
    expect(c.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(c.queryByRole("button", { name: "Rotate token" })).not.toBeInTheDocument();
    expect(c.getByRole("button", { name: "Disable" })).toBeInTheDocument();
  });

  it("adds a worker and shows the pairing command with an editable master address", async () => {
    const fn = setup();
    renderWithProviders(<WorkersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add worker" }));
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "New");
    await userEvent.clear(screen.getByLabelText(/^Site/));
    await userEvent.type(screen.getByLabelText(/^Site/), "garage");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const panel = within(await screen.findByRole("dialog", { name: "Pair worker" }));
    await waitFor(() => expect(body(fn, "POST /api/workers")).toEqual({ name: "New", site: "garage" }));
    expect(panel.getByText(/pnpm worker --master ws:\/\/localhost(:\d+)? --token w2abc.secret/)).toBeInTheDocument();
    expect(panel.getByRole("alert")).toHaveTextContent(/localhost/);
    const addr = panel.getByLabelText(/Master address/);
    await userEvent.clear(addr);
    await userEvent.type(addr, "ws://10.0.0.5:3000");
    expect(panel.getByTestId("pair-command")).toHaveTextContent("pnpm worker --master ws://10.0.0.5:3000 --token w2abc.secret");
    expect(panel.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(panel.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Pair worker" })).not.toBeInTheDocument();
  });

  it("shows server errors when creating (duplicate name)", async () => {
    mockApi({
      "GET /api/workers": () => [local],
      "GET /api/targets": () => [],
      "GET /api/runs": () => ({ rows: [], total: 0, page: 1, pageSize: 100 }),
      "POST /api/workers": () => new Response(JSON.stringify({ error: 'A worker named "Local" already exists' }), { status: 409 }),
    });
    renderWithProviders(<WorkersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Add worker" }));
    await userEvent.type(screen.getByLabelText("Name"), "Local");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });

  it("edits name and site", async () => {
    const fn = setup();
    renderWithProviders(<WorkersPage />);
    const c = await card("Garage Pi");
    await userEvent.click(c.getByRole("button", { name: "Edit" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit Garage Pi" }));
    const name = dialog.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Attic Pi");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(body(fn, "PATCH /api/workers/w2")).toEqual({ name: "Attic Pi", site: "garage" }));
  });

  it("opens add/edit in dialogs that Cancel closes", async () => {
    setup();
    renderWithProviders(<WorkersPage />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Add worker" }));
    expect(screen.getByRole("dialog", { name: "Add worker" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click((await card("Garage Pi")).getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit Garage Pi" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles enabled", async () => {
    const fn = setup();
    renderWithProviders(<WorkersPage />);
    await userEvent.click((await card("Garage Pi")).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(body(fn, "PATCH /api/workers/w2")).toEqual({ enabled: false }));
  });

  it("rotates a token after confirmation and shows the new command", async () => {
    setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<WorkersPage />);
    const btn = (await card("Garage Pi")).getByRole("button", { name: "Rotate token" });
    await userEvent.click(btn);
    expect(screen.queryByRole("dialog", { name: "Pair worker" })).not.toBeInTheDocument();
    await userEvent.click(btn);
    expect(await screen.findByTestId("pair-command")).toHaveTextContent("w2abc.rotated");
    confirm.mockRestore();
  });

  it("removes a worker after confirmation", async () => {
    const fn = setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<WorkersPage />);
    const btn = (await card("Garage Pi")).getByRole("button", { name: "Remove" });
    await userEvent.click(btn);
    expect(calls(fn, "DELETE /api/workers/w2")).toHaveLength(0);
    await userEvent.click(btn);
    await waitFor(() => expect(calls(fn, "DELETE /api/workers/w2")).toHaveLength(1));
    confirm.mockRestore();
  });

  it("runs tests and refreshes interfaces for an online worker", async () => {
    const fn = setup();
    renderWithProviders(<WorkersPage />);
    const c = await card("Local");
    await userEvent.click(c.getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(body(fn, "POST /api/runs/run-now")).toEqual({ workerId: "w1" }));
    expect(await screen.findByText("2 tests queued on Local.")).toBeInTheDocument();
    await userEvent.click(c.getByRole("button", { name: "Refresh interfaces" }));
    expect(await screen.findByText("Asked the worker to report its interfaces.")).toBeInTheDocument();
  });

  it("shows why an incompatible worker is not usable", async () => {
    setup([{ ...pi, status: "incompatible", statusDetail: "worker speaks protocol 0, master expects 1" }]);
    renderWithProviders(<WorkersPage />);
    const c = await card("Garage Pi");
    expect(c.getByText("update worker")).toBeInTheDocument();
    expect(c.getByText(/protocol 0/)).toBeInTheDocument();
  });
});

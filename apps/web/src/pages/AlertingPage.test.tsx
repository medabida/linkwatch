import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertBadge } from "../components/AlertBadge.js";
import { calls, mockApi, renderWithProviders } from "../test/utils.js";
import { AlertingPage } from "./AlertingPage.js";

afterEach(() => vi.unstubAllGlobals());

const event = (over = {}) => ({
  id: 1,
  ruleId: 1,
  ruleName: "Interface down",
  severity: "critical",
  subjectKind: "target",
  subjectId: "1",
  subjectLabel: "VLAN 120 @Local",
  message: "2 failed tests in a row (last: timeout)",
  value: null,
  state: "firing",
  firedAt: Date.now() - 5 * 60_000,
  resolvedAt: null,
  acknowledgedAt: null,
  notifiedAt: 1,
  ...over,
});
const rule = (over = {}) => ({
  id: 1,
  name: "Interface down",
  enabled: true,
  severity: "critical",
  scope: { kind: "all" },
  condition: { type: "test_failed", consecutive: 2 },
  channelIds: [7],
  cooldownMinutes: 360,
  renotifyMinutes: 0,
  notifyRecovery: true,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const channel = (over = {}) => ({
  id: 7,
  name: "My phone",
  type: "telegram",
  enabled: true,
  chatId: "42",
  tokenPreview: "123456:••••STUV",
  createdAt: 1,
  lastSentAt: null,
  lastError: null,
  ...over,
});

const base = {
  "GET /api/alerts/events": (u: URL) =>
    u.searchParams.get("state") === "active" ? [event()] : [event(), event({ id: 2, state: "resolved", resolvedAt: Date.now() })],
  "GET /api/alerts/rules": () => [rule()],
  "GET /api/alerts/channels": () => [channel()],
  "GET /api/workers": () => [{ id: "w1", name: "Local", site: "home" }],
  "GET /api/targets": () => [{ id: 1, workerId: "w1", label: "VLAN 120" }],
};

describe("AlertingPage", () => {
  it("lists active alerts and acknowledges one", async () => {
    const fn = mockApi({ ...base, "POST /api/alerts/events/1/ack": () => event({ acknowledgedAt: 1 }) });
    renderWithProviders(<AlertingPage />);
    expect(await screen.findByText("2 failed tests in a row (last: timeout)")).toBeInTheDocument();
    expect(screen.getByText("VLAN 120 @Local")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(calls(fn, "POST /api/alerts/events/1/ack")).toHaveLength(1);
  });

  it("says so when nothing is firing", async () => {
    mockApi({ ...base, "GET /api/alerts/events": () => [] });
    renderWithProviders(<AlertingPage />);
    expect(await screen.findByText(/No active alerts/)).toBeInTheDocument();
  });

  it("shows the history with firing and resolved alerts", async () => {
    mockApi(base);
    renderWithProviders(<AlertingPage />, "/alerting?tab=history");
    expect(await screen.findByText(/firing for/)).toBeInTheDocument();
    expect(screen.getByText(/resolved after/)).toBeInTheDocument();
  });

  it("describes rules in plain words and toggles one", async () => {
    const fn = mockApi({ ...base, "PUT /api/alerts/rules/1": () => rule({ enabled: false }) });
    renderWithProviders(<AlertingPage />, "/alerting?tab=rules");
    const row = (await screen.findByText("2 failed tests in a row")).closest("tr") as HTMLElement;
    expect(within(row).getByText("everything")).toBeInTheDocument();
    expect(within(row).getByText("My phone")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("checkbox", { name: "Enable Interface down" }));
    const put = calls(fn, "PUT /api/alerts/rules/1")[0];
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({
      enabled: false,
      name: "Interface down",
      condition: { type: "test_failed", consecutive: 2 },
    });
  });

  it("creates a rule from a template", async () => {
    const fn = mockApi({ ...base, "GET /api/alerts/rules": () => [], "POST /api/alerts/rules": () => rule() });
    renderWithProviders(<AlertingPage />, "/alerting?tab=rules");
    await userEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Start from a template"), "Download under 50% of baseline");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Slow download");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    const body = JSON.parse(String(calls(fn, "POST /api/alerts/rules")[0]?.[1]?.body));
    expect(body).toMatchObject({
      name: "Slow download",
      scope: { kind: "all" },
      condition: { type: "speed", metric: "downloadBps", mode: "baseline", threshold: 50, consecutive: 2 },
      channelIds: [7],
    });
  });

  it("validates a rule before sending it", async () => {
    const fn = mockApi({ ...base, "GET /api/alerts/rules": () => [] });
    renderWithProviders(<AlertingPage />, "/alerting?tab=rules");
    await userEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Applies to"), "A site");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText("Name is required")).toBeInTheDocument();
    expect(within(dialog).getByText("Pick a site")).toBeInTheDocument();
    expect(calls(fn, "POST /api/alerts/rules")).toHaveLength(0);
  });

  it("shows channels without the token, sends a test message and reports errors", async () => {
    const fn = mockApi({ ...base, "POST /api/alerts/channels/7/test": () => ({ ok: true }) });
    renderWithProviders(<AlertingPage />, "/alerting?tab=channels");
    expect(await screen.findByText("123456:••••STUV")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText(/Test message sent/)).toBeInTheDocument();
    expect(calls(fn, "POST /api/alerts/channels/7/test")).toHaveLength(1);
  });

  it("reports a failed test message", async () => {
    mockApi({
      ...base,
      "POST /api/alerts/channels/7/test": () => new Response(JSON.stringify({ error: "x", ok: false }), { status: 502 }),
    });
    renderWithProviders(<AlertingPage />, "/alerting?tab=channels");
    await userEvent.click(await screen.findByRole("button", { name: "Send test" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("adds a Telegram channel and validates the token", async () => {
    const fn = mockApi({ ...base, "GET /api/alerts/channels": () => [], "POST /api/alerts/channels": () => channel() });
    renderWithProviders(<AlertingPage />, "/alerting?tab=channels");
    await userEvent.click(await screen.findByRole("button", { name: "Add Telegram channel" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Phone");
    await userEvent.type(within(dialog).getByLabelText(/^Bot token/), "nope");
    await userEvent.type(within(dialog).getByLabelText("Chat ID"), "42");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText(/Not a valid bot token/)).toBeInTheDocument();
    expect(calls(fn, "POST /api/alerts/channels")).toHaveLength(0);
    await userEvent.clear(within(dialog).getByLabelText(/^Bot token/));
    await userEvent.type(within(dialog).getByLabelText(/^Bot token/), "123456:ABCDEFGHIJKLMNOPQRSTUV");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(JSON.parse(String(calls(fn, "POST /api/alerts/channels")[0]?.[1]?.body))).toMatchObject({
      name: "Phone",
      chatId: "42",
      botToken: "123456:ABCDEFGHIJKLMNOPQRSTUV",
    });
  });

  it("keeps the stored token when editing without a new one", async () => {
    const fn = mockApi({ ...base, "PATCH /api/alerts/channels/7": () => channel() });
    renderWithProviders(<AlertingPage />, "/alerting?tab=channels");
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.clear(within(dialog).getByLabelText("Name"));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Renamed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(JSON.parse(String(calls(fn, "PATCH /api/alerts/channels/7")[0]?.[1]?.body))).toEqual({
      name: "Renamed",
      chatId: "42",
      enabled: true,
    });
  });
});

describe("AlertBadge", () => {
  it("shows the number of open alerts", async () => {
    mockApi({ "GET /api/alerts/events": () => [event(), event({ id: 2, severity: "warning" })] });
    renderWithProviders(<AlertBadge />);
    const link = await screen.findByRole("link", { name: "2 active alerts" });
    expect(link).toHaveTextContent("2");
    expect(link).toHaveClass("alert-badge-critical");
  });

  it("is quiet when nothing is firing", async () => {
    mockApi({ "GET /api/alerts/events": () => [] });
    renderWithProviders(<AlertBadge />);
    expect(await screen.findByRole("link", { name: "No active alerts" })).not.toHaveClass("alert-badge-critical");
  });
});

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../test/utils.js";
import { QueueMenu } from "./QueueMenu.js";

afterEach(() => vi.unstubAllGlobals());

const running = (over = {}) => ({
  targetId: 1,
  label: "VLAN 120",
  workerId: "w1",
  workerName: "Local",
  site: "home",
  attempt: 1,
  phase: "download",
  progress: 0.42,
  value: 120e6,
  startedAt: 1,
  ...over,
});
const waiting = (over = {}) => ({
  targetId: 2,
  label: "VLAN 130",
  workerId: "w2",
  workerName: "Pi",
  site: "home",
  trigger: "schedule",
  ...over,
});
const serve = (queue: unknown) => mockApi({ "GET /api/queue": () => queue });

describe("QueueMenu", () => {
  it("shows idle when nothing is running or queued", async () => {
    serve({ running: [], queued: [] });
    renderWithProviders(<QueueMenu />);
    const btn = await screen.findByRole("button", { name: "Test queue" });
    expect(btn).toHaveTextContent("Queue idle");
    await userEvent.click(btn);
    expect(screen.getByText("Nothing is running.")).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting.")).toBeInTheDocument();
  });

  it("summarises counts on the button and lists tests in progress and the queue in order", async () => {
    serve({ running: [running()], queued: [waiting(), waiting({ targetId: 3, label: "VLAN 110", trigger: "manual" })] });
    renderWithProviders(<QueueMenu />);
    const btn = await screen.findByRole("button", { name: "Test queue" });
    await vi.waitFor(() => expect(btn).toHaveTextContent("1 running"));
    expect(btn).toHaveTextContent("2 queued");
    await userEvent.click(btn);
    const panel = screen.getByRole("region", { name: "Test queue details" });
    expect(panel).toHaveTextContent("VLAN 120");
    expect(panel).toHaveTextContent("download · 42% · 120.00 Mbps");
    expect(screen.getByRole("progressbar", { name: "VLAN 120 progress" })).toHaveValue(42);
    const items = panel.querySelectorAll("ol li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("VLAN 130");
    expect(items[0]).toHaveTextContent("scheduled");
    expect(items[1]).toHaveTextContent("VLAN 110");
    expect(items[1]).toHaveTextContent("manual");
  });

  it("only shows site chips when more than one site is involved", async () => {
    serve({ running: [running()], queued: [waiting({ site: "office" })] });
    renderWithProviders(<QueueMenu />);
    await userEvent.click(await screen.findByRole("button", { name: "Test queue" }));
    expect(await screen.findByText("office")).toBeInTheDocument();
    expect(screen.getByText("home")).toBeInTheDocument();
  });

  it("opens and closes with the button, Escape and outside clicks", async () => {
    serve({ running: [], queued: [] });
    renderWithProviders(
      <>
        <QueueMenu />
        <p>outside</p>
      </>,
    );
    const btn = await screen.findByRole("button", { name: "Test queue" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Test queue details" })).not.toBeInTheDocument();
    await userEvent.click(btn);
    await userEvent.click(screen.getByText("outside"));
    expect(screen.queryByRole("region", { name: "Test queue details" })).not.toBeInTheDocument();
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(screen.queryByRole("region", { name: "Test queue details" })).not.toBeInTheDocument();
  });
});

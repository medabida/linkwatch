import type { NetworkInterfaceDto } from "@linkwatch/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startInterfaceWatcher, systemInterfaces } from "./interfaces.js";

const iface = (name: string, address = "10.0.0.2"): NetworkInterfaceDto => ({
  name,
  addresses: [{ address, family: "IPv4", internal: false }],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("systemInterfaces", () => {
  it("returns a sorted list with addresses", () => {
    const l = systemInterfaces();
    expect(l.map((i) => i.name)).toEqual([...l.map((i) => i.name)].sort());
  });
});

describe("startInterfaceWatcher", () => {
  it("reports immediately, on change only, and on resync", () => {
    let current = [iface("eth0")];
    const onReport = vi.fn();
    const w = startInterfaceWatcher({ list: () => current, onReport, pollMs: 10_000, resyncMs: 60_000 });
    expect(onReport).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(onReport).toHaveBeenCalledTimes(1);
    current = [iface("eth0"), iface("wlan0", "10.0.0.3")];
    vi.advanceTimersByTime(10_000);
    expect(onReport).toHaveBeenCalledTimes(2);
    expect(onReport).toHaveBeenLastCalledWith(current);
    vi.advanceTimersByTime(10_000);
    expect(onReport).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    expect(onReport.mock.calls.length).toBe(3);
    w.report();
    expect(onReport).toHaveBeenCalledTimes(4);
    w.stop();
    current = [];
    vi.advanceTimersByTime(120_000);
    expect(onReport).toHaveBeenCalledTimes(4);
  });
});

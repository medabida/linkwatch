import { describe, expect, it } from "vitest";
import { defaultMasterAddress, isLoopbackAddress, pairingCommand, uptime } from "./workers.js";

describe("worker helpers", () => {
  it("derives the master address from the browser location", () => {
    expect(defaultMasterAddress({ protocol: "http:", host: "10.0.0.5:3000" })).toBe("ws://10.0.0.5:3000");
    expect(defaultMasterAddress({ protocol: "https:", host: "speed.lan" })).toBe("wss://speed.lan");
  });
  it.each(["localhost:3000", "ws://localhost:3000", "127.0.0.1:3000", "ws://127.0.0.1", "ws://[::1]:3000", "LOCALHOST"])(
    "flags %s as loopback",
    (a) => {
      expect(isLoopbackAddress(a)).toBe(true);
    },
  );
  it.each(["10.0.0.5:3000", "ws://speed.lan", "ws://localhost.example.com:3000", "ws://1127.0.0.1"])("does not flag %s", (a) => {
    expect(isLoopbackAddress(a)).toBe(false);
  });
  it("builds the pairing command", () => {
    expect(pairingCommand(" ws://m:3000 ", "w1.abc")).toBe("pnpm worker --master ws://m:3000 --token w1.abc");
  });
  it("formats uptime", () => {
    expect(uptime(null)).toBe("—");
    expect(uptime(0, 5_000)).toBe("5s");
    expect(uptime(0, 125_000)).toBe("2m");
    expect(uptime(0, 3_700_000)).toBe("1h 1m");
    expect(uptime(0, 90_000_000)).toBe("1d 1h");
  });
});

import { describe, expect, it } from "vitest";
import { formatBps, runsQuerySchema, targetInputSchema } from "./index.js";

const base = { label: "ISP A", bindType: "interface", bindValue: "eth0", intervalMinutes: 30 };

describe("targetInputSchema", () => {
  it("accepts a valid interface target and applies defaults", () => {
    const r = targetInputSchema.parse(base);
    expect(r.timeoutSeconds).toBe(120);
    expect(r.enabled).toBe(true);
  });

  it("accepts VLAN sub-interface names", () => {
    expect(targetInputSchema.safeParse({ ...base, bindValue: "eth0.20" }).success).toBe(true);
  });

  it("rejects intervals under 5 minutes", () => {
    const r = targetInputSchema.safeParse({ ...base, intervalMinutes: 4 });
    expect(r.success).toBe(false);
  });

  it("coerces numeric strings from forms", () => {
    expect(targetInputSchema.parse({ ...base, intervalMinutes: "10" }).intervalMinutes).toBe(10);
  });

  it("validates ip bind values", () => {
    expect(targetInputSchema.safeParse({ ...base, bindType: "ip", bindValue: "192.168.1.10" }).success).toBe(true);
    expect(targetInputSchema.safeParse({ ...base, bindType: "ip", bindValue: "not-an-ip" }).success).toBe(false);
  });

  it("rejects interface names with spaces or shell characters", () => {
    expect(targetInputSchema.safeParse({ ...base, bindValue: "eth0; rm -rf" }).success).toBe(false);
  });

  it("rejects out-of-range timeouts", () => {
    expect(targetInputSchema.safeParse({ ...base, timeoutSeconds: 1 }).success).toBe(false);
    expect(targetInputSchema.safeParse({ ...base, timeoutSeconds: 100000 }).success).toBe(false);
  });
});

describe("runsQuerySchema", () => {
  it("applies defaults", () => {
    expect(runsQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25, sortBy: "startedAt", sortDir: "desc" });
  });
  it("rejects unknown sort columns", () => {
    expect(runsQuerySchema.safeParse({ sortBy: "rawJson" }).success).toBe(false);
  });
  it("caps page size", () => {
    expect(runsQuerySchema.safeParse({ pageSize: 1000 }).success).toBe(false);
  });
});

describe("formatBps", () => {
  it("formats Mbps and Gbps", () => {
    expect(formatBps(94_500_000)).toBe("94.50 Mbps");
    expect(formatBps(2_500_000_000)).toBe("2.50 Gbps");
    expect(formatBps(null)).toBe("—");
  });
});

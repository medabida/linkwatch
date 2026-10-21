import { describe, expect, it } from "vitest";
import {
  formatBps,
  runNowSchema,
  runsQuerySchema,
  targetCreateSchema,
  targetInputSchema,
  workerCreateSchema,
  workerUpdateSchema,
} from "./index.js";

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

describe("targetCreateSchema", () => {
  it("requires a worker and still validates the binding", () => {
    expect(targetCreateSchema.parse({ ...base, workerId: " w1 " }).workerId).toBe("w1");
    expect(targetCreateSchema.safeParse(base).success).toBe(false);
    expect(targetCreateSchema.safeParse({ ...base, workerId: "  " }).success).toBe(false);
    expect(targetCreateSchema.safeParse({ ...base, workerId: "w1", bindType: "ip", bindValue: "eth0" }).success).toBe(false);
  });
});

describe("workerCreateSchema / workerUpdateSchema", () => {
  it("trims, defaults the site and requires a name", () => {
    expect(workerCreateSchema.parse({ name: "  Pi " })).toEqual({ name: "Pi", site: "default" });
    expect(workerCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(workerCreateSchema.safeParse({ name: "x".repeat(65) }).success).toBe(false);
    expect(workerCreateSchema.safeParse({ name: "a", site: "" }).success).toBe(false);
  });
  it("allows partial updates but rejects empty values", () => {
    expect(workerUpdateSchema.parse({})).toEqual({});
    expect(workerUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(workerUpdateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(workerUpdateSchema.safeParse({ enabled: "yes" }).success).toBe(false);
  });
});

describe("runNowSchema", () => {
  it("accepts an empty body, a target or a worker", () => {
    expect(runNowSchema.parse({})).toEqual({});
    expect(runNowSchema.parse({ targetId: "3" })).toEqual({ targetId: 3 });
    expect(runNowSchema.parse({ workerId: "w1" })).toEqual({ workerId: "w1" });
  });
  it("rejects invalid ids", () => {
    expect(runNowSchema.safeParse({ targetId: 0 }).success).toBe(false);
    expect(runNowSchema.safeParse({ workerId: "" }).success).toBe(false);
  });
});

describe("runsQuerySchema filters", () => {
  it("parses worker, site, status and date range", () => {
    const q = runsQuerySchema.parse({ workerId: "w1", site: "garage", status: "ok", from: "10", to: "20", page: "2" });
    expect(q).toMatchObject({ workerId: "w1", site: "garage", status: "ok", from: 10, to: 20, page: 2 });
    expect(runsQuerySchema.safeParse({ status: "weird" }).success).toBe(false);
  });
});

describe("formatBps edge cases", () => {
  it("handles null, undefined, zero and the Gbps boundary", () => {
    expect(formatBps(null)).toBe("—");
    expect(formatBps(undefined)).toBe("—");
    expect(formatBps(0)).toBe("0.00 Mbps");
    expect(formatBps(999_990_000)).toBe("999.99 Mbps");
    expect(formatBps(1_000_000_000)).toBe("1.00 Gbps");
  });
});

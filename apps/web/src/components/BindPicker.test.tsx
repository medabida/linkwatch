import type { NetworkInterfaceDto } from "@linkwatch/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BindPicker } from "./BindPicker.js";

const ad = (address: string, internal = false) => ({ address, family: "IPv4", internal });
const detected: NetworkInterfaceDto[] = [
  { name: "lo0", addresses: [ad("127.0.0.1", true)] },
  { name: "en0", addresses: [ad("10.0.0.180")] },
  { name: "eth0.20", addresses: [ad("10.20.0.2")] },
  { name: "docker0", addresses: [ad("172.17.0.1")] },
];

function Harness({ initial = "", bindType = "interface" as "interface" | "ip", onRefresh = () => {}, loading = false }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <BindPicker bindType={bindType} value={value} onChange={setValue} detected={loading ? undefined : detected} onRefresh={onRefresh} />
      <output data-testid="value">{value}</output>
    </>
  );
}
const value = () => screen.getByTestId("value").textContent;
const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("BindPicker", () => {
  it("lists detected interfaces with their IPs, hiding loopback, and picking sets the value", async () => {
    render(<Harness />);
    expect(optionNames()).toEqual(["Select…", "en0 — 10.0.0.180", "eth0.20 — 10.20.0.2", "docker0 — 172.17.0.1", "Custom…"]);
    await userEvent.selectOptions(screen.getByLabelText("Interface"), "eth0.20");
    expect(value()).toBe("eth0.20");
    expect(screen.queryByLabelText("Custom interface")).not.toBeInTheDocument();
  });

  it("hides virtual interfaces on request", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText("Hide virtual interfaces"));
    expect(optionNames()).not.toContain("docker0 — 172.17.0.1");
    expect(optionNames()).toContain("en0 — 10.0.0.180");
  });

  it("lists source IPs with their interface in ip mode", () => {
    render(<Harness bindType="ip" />);
    expect(optionNames()).toContain("10.0.0.180 (en0)");
    expect(screen.getByLabelText("IP address")).toBeInTheDocument();
  });

  it("supports a custom value without a warning when it is detected", async () => {
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText("Interface"), "Custom…");
    await userEvent.type(screen.getByLabelText("Custom interface"), "en0");
    expect(value()).toBe("en0");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("warns (without blocking) when the typed name is not detected", async () => {
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText("Interface"), "Custom…");
    await userEvent.type(screen.getByLabelText("Custom interface"), "eth9");
    expect(value()).toBe("eth9");
    expect(screen.getByRole("note")).toHaveTextContent("Not currently detected");
  });

  it("shows an existing undetected value in the custom field with a warning", () => {
    render(<Harness initial="vlan30" />);
    expect(screen.getByLabelText("Custom interface")).toHaveValue("vlan30");
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("selects a detected existing value", () => {
    render(<Harness initial="en0" />);
    expect(screen.getByLabelText("Interface")).toHaveValue("en0");
  });

  it("does not warn while detection has not loaded", () => {
    render(<Harness initial="vlan30" loading />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("refreshes the detected list", async () => {
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

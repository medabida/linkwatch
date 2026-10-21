import { describe, expect, it } from "vitest";
import { interfaceOptions, ipOptions, isVirtualInterface } from "./interfaces.js";
import type { NetworkInterfaceDto } from "./types.js";

const a = (address: string, internal = false) => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", internal });
const list: NetworkInterfaceDto[] = [
  { name: "lo", addresses: [a("127.0.0.1", true)] },
  { name: "eth0", addresses: [a("192.168.1.10"), a("fe80::1")] },
  { name: "eth0.20", addresses: [a("10.20.0.2")] },
  { name: "enp3s0", addresses: [a("fe80::2")] },
  { name: "docker0", addresses: [a("172.17.0.1")] },
  { name: "utun3", addresses: [a("10.8.0.2")] },
  { name: "en0", addresses: [a("10.0.0.180"), a("2001:db8::1")] },
];

describe("isVirtualInterface", () => {
  it.each(["lo", "docker0", "veth12ab", "br-1a2b3c", "virbr0", "utun3", "awdl0", "bridge0", "tun0", "wg0", "tailscale0"])(
    "flags %s",
    (n) => {
      expect(isVirtualInterface(n)).toBe(true);
    },
  );
  it.each(["eth0", "eth0.20", "enp3s0", "wlan0", "wlp2s0", "en0", "en9", "ens160", "bond0"])("does not flag %s", (n) => {
    expect(isVirtualInterface(n)).toBe(false);
  });
});

describe("interfaceOptions", () => {
  it("drops loopback and interfaces with no usable address, shows everything else by default", () => {
    expect(interfaceOptions(list).map((i) => i.name)).toEqual(["eth0", "eth0.20", "docker0", "utun3", "en0"]);
  });

  it("drops link-local IPv6 addresses", () => {
    expect(interfaceOptions(list).find((i) => i.name === "eth0")?.addresses).toEqual(["192.168.1.10"]);
  });

  it("optionally hides virtual interfaces", () => {
    expect(interfaceOptions(list, { hideVirtual: true }).map((i) => i.name)).toEqual(["eth0", "eth0.20", "en0"]);
  });
});

describe("ipOptions", () => {
  it("flattens addresses with their interface", () => {
    expect(ipOptions(list, { hideVirtual: true })).toEqual([
      { address: "192.168.1.10", interfaceName: "eth0" },
      { address: "10.20.0.2", interfaceName: "eth0.20" },
      { address: "10.0.0.180", interfaceName: "en0" },
      { address: "2001:db8::1", interfaceName: "en0" },
    ]);
  });
});

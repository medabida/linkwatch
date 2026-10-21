import type { NetworkInterfaceDto } from "./types.js";

/** Name patterns of interfaces that are usually virtual/tooling (Linux + macOS). Heuristic only, used for an optional UI filter. */
const VIRTUAL_NAME =
  /^(lo|docker|veth|br-|virbr|vmnet|vnet|tun|tap|utun|awdl|llw|gif|stf|ap|anpi|bridge|vboxnet|cni|flannel|cali|vxlan|kube|podman|tailscale|zt|wg)\d*/i;

export const isVirtualInterface = (name: string): boolean => VIRTUAL_NAME.test(name);

export interface InterfaceOption {
  name: string;
  /** non-loopback, non-link-local addresses */
  addresses: string[];
}

const isLinkLocalV6 = (a: string) => a.toLowerCase().startsWith("fe80");

/** Bindable interfaces: loopback is always dropped; virtual ones optionally. */
export function interfaceOptions(list: NetworkInterfaceDto[], opts: { hideVirtual?: boolean } = {}): InterfaceOption[] {
  return list
    .map((i) => ({
      name: i.name,
      addresses: i.addresses.filter((a) => !a.internal && !isLinkLocalV6(a.address)).map((a) => a.address),
    }))
    .filter((i) => i.addresses.length > 0)
    .filter((i) => !(opts.hideVirtual && isVirtualInterface(i.name)));
}

export interface IpOption {
  address: string;
  interfaceName: string;
}

export function ipOptions(list: NetworkInterfaceDto[], opts: { hideVirtual?: boolean } = {}): IpOption[] {
  return interfaceOptions(list, opts).flatMap((i) => i.addresses.map((address) => ({ address, interfaceName: i.name })));
}

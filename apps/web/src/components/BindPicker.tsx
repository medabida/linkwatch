import { type BindType, interfaceOptions, ipOptions, type NetworkInterfaceDto } from "@linkwatch/shared";
import { useState } from "react";

const CUSTOM = "__custom__";

interface Props {
  bindType: BindType;
  value: string;
  onChange: (value: string) => void;
  detected: NetworkInterfaceDto[] | undefined;
  onRefresh: () => void;
  refreshing?: boolean;
  error?: string;
  /** name of the machine the list comes from, for messages */
  hostName?: string;
}

/** Picks an interface name or source IP from what the worker reports, or lets the user type any value. */
export function BindPicker({ bindType, value, onChange, detected, onRefresh, refreshing, error, hostName }: Props) {
  const [hideVirtual, setHideVirtual] = useState(false);
  const [customMode, setCustomMode] = useState(false);

  const options =
    bindType === "interface"
      ? interfaceOptions(detected ?? [], { hideVirtual }).map((o) => ({ value: o.name, label: `${o.name} — ${o.addresses.join(", ")}` }))
      : ipOptions(detected ?? [], { hideVirtual }).map((o) => ({ value: o.address, label: `${o.address} (${o.interfaceName})` }));

  const known = options.some((o) => o.value === value);
  const showCustom = customMode || (value !== "" && !known);
  const selectValue = showCustom ? CUSTOM : known ? value : "";
  const noun = bindType === "interface" ? "Interface" : "IP address";
  const allKnown = new Set(
    bindType === "interface" ? interfaceOptions(detected ?? []).map((o) => o.name) : ipOptions(detected ?? []).map((o) => o.address),
  );
  const undetected = showCustom && value !== "" && detected !== undefined && !allKnown.has(value);

  return (
    <div className="bind-picker">
      <label>
        {noun}
        <select
          value={selectValue}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustomMode(true);
              onChange("");
            } else {
              setCustomMode(false);
              onChange(e.target.value);
            }
          }}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </label>
      {showCustom && (
        <input
          aria-label={`Custom ${noun.toLowerCase()}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={bindType === "interface" ? "e.g. eth0.20" : "e.g. 192.168.1.10"}
        />
      )}
      <div className="bind-tools">
        <label className="inline">
          <input type="checkbox" checked={hideVirtual} onChange={(e) => setHideVirtual(e.target.checked)} />
          Hide virtual interfaces
        </label>
        <button type="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {undetected && (
        <span className="warn-text" role="note">
          Not currently detected on {hostName ?? "this host"}. You can still save it (it may appear later, e.g. a VLAN or VPN).
        </span>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}

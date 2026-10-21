import type { WorkerTokenDto } from "@linkwatch/shared";
import { useState } from "react";
import { defaultMasterAddress, isLoopbackAddress, pairingCommand } from "../lib/workers.js";
import { Modal } from "./Modal.js";

interface Props {
  pairing: WorkerTokenDto;
  onClose: () => void;
}

/** Shows the one-line command that pairs a worker machine. The token is displayed only here, once. */
export function PairingPanel({ pairing, onClose }: Props) {
  const [master, setMaster] = useState(defaultMasterAddress);
  const [copied, setCopied] = useState(false);
  const command = pairingCommand(master, pairing.token);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title="Pair worker" onClose={onClose} width="640px">
      <div className="pairing">
        <h3>Pair "{pairing.worker.name}"</h3>
        <p>
          On the worker machine (this repo, Node 24, pnpm and the Ookla CLI installed) run the command below. It saves the pairing, so later
          you only need <code>pnpm worker</code>. The token is shown only now; rotate it if you lose it.
        </p>
        <label>
          Master address as seen by the worker
          <input value={master} onChange={(e) => setMaster(e.target.value)} />
        </label>
        {isLoopbackAddress(master) && (
          <p className="warn-text" role="alert">
            This address points to localhost, which only works for a worker on this same machine. Use the master's LAN IP or hostname.
          </p>
        )}
        <pre className="command" data-testid="pair-command">
          {command}
        </pre>
        <div className="actions">
          <button type="button" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy command"}
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

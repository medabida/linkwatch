import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function JsonModal({ runId, onClose }: { runId: number; onClose: () => void }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["run", runId], queryFn: () => api.run(runId) });
  const text = data ? JSON.stringify(data, null, 2) : "";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click/Escape are conveniences; the Close button is the accessible path
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="modal" role="dialog" aria-label={`Run ${runId} details`}>
        <div className="modal-head">
          <h2>Run #{runId}</h2>
          <div>
            <button type="button" disabled={!data} onClick={() => navigator.clipboard?.writeText(text)}>
              Copy
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {isLoading && <p>Loading…</p>}
        {error && <p className="error">{(error as Error).message}</p>}
        {data && <pre data-testid="json">{text}</pre>}
      </div>
    </div>
  );
}

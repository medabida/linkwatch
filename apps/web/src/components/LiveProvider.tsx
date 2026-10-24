import type { RunEventDto } from "@linkwatch/shared";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useReducer } from "react";
import { type ActiveRuns, applyEvent } from "../lib/live.js";

const LiveContext = createContext<ActiveRuns>({});
export const useActiveRuns = () => useContext(LiveContext);

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [active, dispatch] = useReducer(applyEvent, {} as ActiveRuns);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    es.addEventListener("run", (m) => {
      const e = JSON.parse((m as MessageEvent).data) as RunEventDto;
      dispatch(e);
      if (e.type === "run_started" || e.type === "run_finished") void qc.invalidateQueries({ queryKey: ["runs"] });
      if (e.type === "run_finished") void qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (e.type !== "run_progress") {
        void qc.invalidateQueries({ queryKey: ["workers"] });
        void qc.invalidateQueries({ queryKey: ["queue"] });
      }
    });
    return () => es.close();
  }, [qc]);

  return <LiveContext.Provider value={active}>{children}</LiveContext.Provider>;
}

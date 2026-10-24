import type { ReactNode } from "react";

export function Card({ title, hint, wide, children }: { title: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`card${wide ? " card-wide" : ""}`} aria-label={title}>
      <h3>
        {title} {hint && <small className="muted">{hint}</small>}
      </h3>
      {children}
    </section>
  );
}

export const Empty = ({ text = "No data in this range." }: { text?: string }) => <p className="muted empty">{text}</p>;

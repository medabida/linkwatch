import type { ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}

/** Backdrop + dialog. Closes on backdrop click or Escape. */
export function Modal({ title, onClose, children, width = "560px" }: Props) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click/Escape are conveniences; the Cancel/Close buttons are the accessible path
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}, 92vw)` }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

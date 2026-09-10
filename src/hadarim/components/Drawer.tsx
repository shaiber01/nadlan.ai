import { useEffect, useRef, type ReactNode } from "react";

/**
 * Accessible drawer/modal: Escape closes, focus moves inside on open and returns to the trigger on close,
 * Tab cycles within the surface.
 */
export function Surface({ kind, title, subtitle, onClose, children, footer, wide }: { kind: "drawer" | "modal"; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    (focusable ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      previous.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className={`overlay${kind === "modal" ? " center" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={kind === "drawer" ? `drawer${wide ? " wide" : ""}` : "modal"} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="drawer-header">
          <div className="stack-sm" style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle ? <div className="muted small">{subtitle}</div> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="סגור" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

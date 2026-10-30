import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusRing } from "./ui";

/** Accessible modal dialog: focus moves in on open and back on close, Escape closes, Tab is trapped. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  tone = "default",
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "danger";
  icon?: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button");
      (first ?? panel.current)?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex='-1'])"));
        if (!items.length) return;
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
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className={`relative w-full max-w-lg rounded-xl bg-white shadow-2xl ring-1 ${tone === "danger" ? "ring-red-300" : "ring-slate-200"} focus:outline-none`}
      >
        <div className={`flex items-start gap-3 border-b px-5 py-3.5 ${tone === "danger" ? "border-red-200 bg-red-50" : "border-slate-200"} rounded-t-xl`}>
          {icon && <div className="mt-0.5 flex-none">{icon}</div>}
          <h2 id={`${id}-title`} className={`flex-1 text-base font-semibold ${tone === "danger" ? "text-red-900" : "text-slate-900"}`}>
            {title}
          </h2>
          <button type="button" onClick={onClose} className={`rounded p-1 text-slate-600 hover:bg-slate-100 ${focusRing}`} aria-label="Close dialog">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-slate-800">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

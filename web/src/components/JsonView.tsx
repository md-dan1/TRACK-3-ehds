import { ChevronRight } from "lucide-react";
import { Collapsible, focusRing } from "./ui";

/** Small "JSON" toggle placed at the end of a row; the row renders <JsonPanel> below itself when open. */
export function JsonButton({ open, onClick, label = "JSON" }: { open: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`inline-flex flex-none items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50 ${focusRing}`}
    >
      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      {label}
    </button>
  );
}

/** Grey monospace panel (same style as the raw request body). Strings are shown as-is, anything else as JSON. */
export function JsonPanel({ value, maxHeight = "max-h-80" }: { value: unknown; maxHeight?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre tabIndex={0} className={`${maxHeight} overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-3 font-mono text-xs leading-relaxed text-slate-800 [overflow-wrap:anywhere]`}>
      {text}
    </pre>
  );
}

/** "Raw EHDS request body (JSON)", collapsed by default; used on the Researcher and Clinic request pages. */
export function RawRequestJson({ payload }: { payload: unknown }) {
  return (
    <Collapsible title="Raw EHDS request body (JSON)">
      <JsonPanel value={payload} maxHeight="max-h-[32rem]" />
    </Collapsible>
  );
}

export function hasPayload(p: unknown): boolean {
  return !!p && typeof p === "object" && Object.keys(p as object).length > 0;
}

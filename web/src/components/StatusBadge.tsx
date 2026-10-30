import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { RunStatus } from "../api";

/** Run status as icon + text. "rejected" is a done run whose decision was REJECT (used in Old requests). */
export function StatusBadge({ status }: { status: RunStatus | "rejected" | string }) {
  if (status === "running")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-800">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Running
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-800">
        <XCircle className="h-3.5 w-3.5" aria-hidden /> Error
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
        <XCircle className="h-3.5 w-3.5" aria-hidden /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-900">
      <CheckCircle2 className="h-3.5 w-3.5 text-green-700" aria-hidden /> Done
    </span>
  );
}

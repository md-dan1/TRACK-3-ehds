import { BarChart3, Database, XCircle, type LucideIcon } from "lucide-react";
import type { Decision } from "../api";
import { DECISION_META } from "../lib/format";

export const DECISION_ICON: Record<Decision, LucideIcon> = {
  REJECT: XCircle,
  APPROVE_STATISTICAL: BarChart3,
  APPROVE_SPE: Database,
};

/**
 * Decision as plain text for tables: a small icon on the left and normal dark text.
 * Statistics: blue chart icon; Records: blue dataset icon; Rejected: red X icon.
 */
export function DecisionText({ decision }: { decision: Decision | null | undefined }) {
  if (!decision) return <span className="text-xs text-slate-500">–</span>;
  const reject = decision === "REJECT";
  const Icon = DECISION_ICON[decision];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-900">
      <Icon className={`h-4 w-4 flex-none ${reject ? "text-red-700" : "text-brand-700"}`} aria-hidden />
      {reject ? "Rejected" : DECISION_META[decision].short}
    </span>
  );
}

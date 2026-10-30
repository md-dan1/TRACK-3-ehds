import { Check, CheckCircle2, Loader2, Minus, X } from "lucide-react";
import type { Step, StepStatus } from "../api";
import { HOSPITALS, fmtMs } from "../lib/format";

const STATUS_TEXT: Record<StepStatus, string> = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  skipped: "Skipped",
  error: "Failed",
};

/** 20px status circle. Drawn as a box (not an icon glyph) so the connector line meets its edge exactly. */
function StatusIcon({ status }: { status: StepStatus }) {
  const base = "flex h-5 w-5 items-center justify-center rounded-full";
  switch (status) {
    case "done":
      return (
        <span className={`${base} bg-green-600 text-white`}>
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
        </span>
      );
    case "running":
      return (
        <span className={`${base} border-2 border-brand-600 bg-white text-brand-700`}>
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={3} aria-hidden />
        </span>
      );
    case "skipped":
      return (
        <span className={`${base} border-2 border-slate-300 bg-slate-100 text-slate-500`}>
          <Minus className="h-3 w-3" strokeWidth={3} aria-hidden />
        </span>
      );
    case "error":
      return (
        <span className={`${base} bg-red-600 text-white`}>
          <X className="h-3 w-3" strokeWidth={3} aria-hidden />
        </span>
      );
    default:
      return <span className={`${base} border-2 border-slate-300 bg-white`} />;
  }
}

/** Live pipeline stepper. During "federation", each hospital ticks off as its node answers. */
export function Stepper({ steps, nodesDone, showMs = false }: { steps: Step[]; nodesDone: string[]; showMs?: boolean }) {
  return (
    <ol className="relative space-y-0" aria-label="Processing steps">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const isFed = s.id === "federation";
        return (
          <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className={`absolute bottom-0 left-[9px] top-5 w-0.5 ${s.status === "done" ? "bg-green-500" : "bg-slate-300"}`} aria-hidden />}
            <div className="relative z-10 flex-none">
              <StatusIcon status={s.status} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-sm font-medium ${s.status === "pending" || s.status === "skipped" ? "text-slate-500" : "text-slate-900"}`}>{s.label}</span>
                {s.status === "done" && <span className="sr-only">{STATUS_TEXT.done}</span>}
                {showMs && s.ms !== null && s.ms !== undefined && s.status !== "pending" && (
                  <span className="font-mono text-xs text-slate-600">{fmtMs(s.ms)}</span>
                )}
              </div>
              {/* status always on its own line below the label, so every step reads the same */}
              {s.status !== "done" && (
                <div className={`text-xs ${s.status === "error" ? "text-red-800" : "text-slate-600"}`}>{STATUS_TEXT[s.status]}</div>
              )}
              {isFed && (s.status === "running" || s.status === "done") && (
                <ul className="mt-1.5 flex flex-wrap gap-2" aria-label="Hospitals">
                  {HOSPITALS.map((h) => {
                    const ok = nodesDone.includes(h);
                    return (
                      <li
                        key={h}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${ok ? "bg-green-50 text-green-800 ring-green-300" : "bg-slate-50 text-slate-600 ring-slate-200"}`}
                      >
                        {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                        {h}
                        <span className="sr-only">{ok ? "answered" : "waiting"}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* step sentences repeat facts shown elsewhere; only a failure reason is kept */}
              {s.status === "error" && s.detail && <p className="mt-0.5 break-words text-xs text-red-800">{s.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

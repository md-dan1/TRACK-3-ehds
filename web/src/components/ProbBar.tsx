import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Decision } from "../api";
import { DECISION_META, DECISION_ORDER, pct } from "../lib/format";
import { DECISION_ICON } from "./DecisionText";
import { ScrollCell } from "./ui";

/** One probability row: label, thin bar, percentage with one decimal. `wideLabel`: long labels get the room, the bar a fixed width. */
export function ProbRow({ label, value, barClass = "bg-brand-700", note, wideLabel = false }: {
  label: ReactNode;
  value: number | null;
  barClass?: string;
  note?: ReactNode;
  wideLabel?: boolean;
}) {
  const cols = wideLabel ? "grid-cols-[minmax(0,1fr)_6rem_4rem] sm:grid-cols-[minmax(0,1fr)_14rem_4rem]" : "grid-cols-[minmax(0,14rem)_1fr_4rem]";
  return (
    <li className={`grid ${cols} items-center gap-3 text-sm`}>
      <ScrollCell max={wideLabel ? "max-w-full" : "max-w-[14rem]"} className="min-w-0">
        {label}
      </ScrollCell>
      {note ?? (
        <span className="h-1.5 rounded-full bg-slate-100" aria-hidden>
          <span className={`block h-1.5 rounded-full ${barClass}`} style={{ width: `${Math.max((value ?? 0) * 100, value ? 0.8 : 0)}%` }} />
        </span>
      )}
      <span className="text-right font-mono text-xs tabular-nums text-slate-800">{value === null ? "–" : pct(value, 1)}</span>
    </li>
  );
}

/** Probabilities of the decisions as rows; a masked option (impossible for this request type) is not shown. */
/** The decision as an outcome to weigh, e.g. "Rejection" next to "Approval (Statistics)". */
const OUTCOME_LABEL: Record<Decision, string> = {
  REJECT: "Rejection",
  APPROVE_STATISTICAL: "Approval (Statistics)",
  APPROVE_SPE: "Approval (Records)",
};

export function DecisionProbRows({ probabilities, masked = [] }: { probabilities: Record<Decision, number>; masked?: Decision[] }) {
  return (
    <ul className="space-y-2">
      {DECISION_ORDER.filter((d) => !masked.includes(d)).map((d) => {
        // an outcome to weigh: red cross for rejection, green check for either approval
        const Icon = d === "REJECT" ? DECISION_ICON.REJECT : CheckCircle2;
        const label = (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-900">
            <Icon className={`h-4 w-4 flex-none ${d === "REJECT" ? "text-red-700" : "text-green-600"}`} aria-hidden />
            {OUTCOME_LABEL[d]}
          </span>
        );
        return <ProbRow key={d} label={label} value={probabilities[d] ?? 0} barClass={DECISION_META[d].bar} />;
      })}
    </ul>
  );
}

/** Position on the 0..1 scale, inset by the marker's radius so a score of 0% or 100% stays inside. */
const at = (v: number) => `calc(10px + (100% - 20px) * ${Math.min(Math.max(v, 0), 1)})`;

/** How a score reads: a text colour plus a glyph, so the state does not rely on colour alone. */
export type ScoreMarker = { tone: string; glyph: "x" | "check" | "flag" };

/**
 * The score as an outlined circle with its glyph, drawn like lucide's CircleX / CircleCheck (the decision icons),
 * with a flag variant lucide does not have. Filled white so it covers the track underneath.
 */
function ScoreDot({ marker, className = "h-4 w-4" }: { marker: ScoreMarker; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`flex-none ${marker.tone} ${className}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="white" />
      {marker.glyph === "x" && <path d="m15 9-6 6M9 9l6 6" />}
      {marker.glyph === "check" && <path d="m9 12 2 2 4-4" />}
      {marker.glyph === "flag" && (
        // lucide's Flag, scaled into the circle; stroke scaled back up to match
        <g transform="translate(6.6 6.6) scale(0.45)" strokeWidth={4.4}>
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <path d="M4 22v-7" />
        </g>
      )}
    </svg>
  );
}

/** A probability 0..1 on a scale: the score as a marker, the flagging band shaded, the threshold as a line. */
export function ProbMeter({ value, band, threshold = 0.5, label, marker }: {
  value: number;
  band?: [number, number];
  threshold?: number;
  label: string;
  marker: ScoreMarker;
}) {
  return (
    <div
      className="relative h-5 w-full"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(value.toFixed(4))}
      aria-label={label}
      aria-valuetext={pct(value, 1)}
    >
      <span className="absolute left-[10px] right-[10px] top-1/2 block h-1.5 -translate-y-1/2 rounded-full bg-slate-100" aria-hidden />
      {band && (
        <span
          className="absolute top-1/2 block h-1.5 -translate-y-1/2 bg-slate-300"
          style={{ left: at(band[0]), width: `calc((100% - 20px) * ${band[1] - band[0]})` }}
          aria-hidden
        />
      )}
      <span className="absolute inset-y-0 block w-0.5 -translate-x-1/2 bg-slate-800" style={{ left: at(threshold) }} aria-hidden />
      <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: at(value) }} aria-hidden>
        <ScoreDot marker={marker} className="block h-5 w-5" />
      </span>
    </div>
  );
}

/** Key for one ProbMeter, with its own numbers: the same colours and shapes as the meter itself. */
export function ProbMeterLegend({ value, band, threshold = 0.5, thresholdLabel = "Threshold", marker }: {
  value: number;
  band?: [number, number];
  threshold?: number;
  thresholdLabel?: string;
  marker: ScoreMarker;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <ScoreDot marker={marker} />
        {pct(value, 1)} Score (probability of “yes”)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="block h-3 w-0.5 bg-slate-800" aria-hidden />
        {Math.round(threshold * 100)}% {thresholdLabel}
      </span>
      {band && (
        <span className="inline-flex items-center gap-1.5">
          <span className="block h-1.5 w-5 bg-slate-300" aria-hidden />
          {Math.round(band[0] * 100)}–{Math.round(band[1] * 100)}% Flagging band for human check
        </span>
      )}
    </div>
  );
}

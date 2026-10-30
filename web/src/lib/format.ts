import type { CellValue, Decision, IntakeMode } from "../api";

/** The three hospital nodes of the federation (docker-compose NODES). */
export const HOSPITALS = ["Klinikum Nord", "Klinikum Süd", "Klinikum West"] as const;

/** Flagging bands from decision.py (REVIEW_ART54 / REVIEW_NEED); not exposed by the API. */
export const REVIEW_ART54: [number, number] = [0.1, 0.6];
export const REVIEW_NEED: [number, number] = [0.2, 0.8];

export const DECISION_ORDER: Decision[] = ["REJECT", "APPROVE_STATISTICAL", "APPROVE_SPE"];

/**
 * Decision styling: REJECT red (+ icon). Statistics and Records both use the app blue; in bars and charts
 * they get two clearly different shades (Statistics lighter, Records darker) and are always labelled.
 */
export const DECISION_META: Record<Decision, { label: string; short: string; badge: string; bar: string; text: string; chart: string }> = {
  REJECT: {
    label: "Rejected",
    short: "Rejected",
    badge: "bg-red-50 text-red-800 ring-red-300",
    bar: "bg-red-600",
    text: "text-red-800",
    chart: "#dc2626",
  },
  APPROVE_STATISTICAL: {
    label: "Statistics",
    short: "Statistics",
    badge: "bg-blue-50 text-blue-800 ring-blue-300",
    bar: "bg-blue-500",
    text: "text-blue-800",
    chart: "#3b82f6",
  },
  APPROVE_SPE: {
    label: "Records (pseudonymised)",
    short: "Records",
    badge: "bg-blue-50 text-blue-800 ring-blue-300",
    bar: "bg-brand-800",
    text: "text-brand-800",
    chart: "#1e3a8a",
  },
};

/** Pipeline step names (orchestrator/pipeline.py STEPS), as shown in the Latency stepper. */
export const STEP_LABEL: Record<string, string> = {
  intake: "Request received",
  decision: "Legal check (Art. 53, 54)",
  query: "Query generated and validated",
  federation: "Hospitals queried",
  output: "Privacy check (small-cell rule)",
};

/** A difference between two probabilities, in percentage points with one decimal and a sign. */
export function pp(delta: number): string {
  const v = delta * 100;
  return `${v >= 0 ? "+" : "\u2212"}${Math.abs(v).toFixed(1)} pp`;
}

export const INTAKE_LABEL: Record<IntakeMode, string> = {
  freeform: "Free text",
  form: "Form",
  example: "Example",
  json: "JSON",
  api: "API",
  benchmark: "Benchmark",
};

const ACRONYMS: Record<string, string> = {
  t2d: "T2D", t1d: "T1D", af: "AF", oac: "OAC", hba1c: "HbA1c", ldl: "LDL", hdl: "HDL", bmi: "BMI",
  copd: "COPD", icd10: "ICD-10", atc: "ATC", loinc: "LOINC", id: "ID", gp: "GP", ckd: "CKD", egfr: "eGFR",
  ace: "ACE", sglt2: "SGLT2", glp1: "GLP-1", spe: "SPE", ms: "ms", n: "N",
};

/** snake_case -> "Sentence case", with known clinical acronyms; trailing _pct becomes "(%)". */
export function humanize(name: string): string {
  if (!name) return name;
  let pct = false;
  let tokens = name.split(/[_\s]+/).filter(Boolean);
  if (tokens.length > 1 && /^(pct|percent)$/i.test(tokens[tokens.length - 1])) {
    pct = true;
    tokens = tokens.slice(0, -1);
  }
  const words = tokens.map((t, i) => {
    const low = t.toLowerCase();
    if (ACRONYMS[low]) return ACRONYMS[low];
    if (/\d/.test(low) && /[a-z]/.test(low) && low.length <= 5) return low.toUpperCase();
    if (low === "avg") return i === 0 ? "Average" : "average";
    return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
  });
  return words.join(" ") + (pct ? " (%)" : "");
}

/** Columns whose values are ratios/means: always shown with one decimal. */
export function looksLikeRatio(column: string, values: CellValue[]): boolean {
  if (/(pct|percent|prevalence|share|rate|ratio|mean|avg|average|proportion)/i.test(column)) return true;
  return values.some((v) => typeof v === "number" && !Number.isInteger(v));
}

export function isSuppressedValue(v: CellValue): boolean {
  return v === "<10" || v === "suppressed";
}

export function formatCell(v: CellValue, oneDecimal: boolean): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "number") {
    return oneDecimal
      ? v.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : v.toLocaleString("en-GB");
  }
  return String(v);
}

export function pct(p: number | null | undefined, digits = 1): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "–";
  const v = p * 100;
  if (v > 0 && v < 0.1) return "<0.1%";
  if (v < 100 && v > 99.9) return ">99.9%";
  return `${v.toFixed(digits)}%`;
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + `.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function maxProbability(probs: Record<string, number> | null | undefined): number | null {
  if (!probs) return null;
  const vals = Object.values(probs);
  return vals.length ? Math.max(...vals) : null;
}

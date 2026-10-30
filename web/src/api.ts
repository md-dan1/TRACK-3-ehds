// Typed client for the orchestrator API (orchestrator/orchestrator/main.py).
// Shapes mirror pipeline.py (state, applicant_view, staff_view), decision.py,
// sqlguard.py (Plan.describe, released), pipeline.py (SPE permit) and metrics.py.

export type Decision = "REJECT" | "APPROVE_STATISTICAL" | "APPROVE_SPE";
export type Role = "applicant" | "staff";

export interface User {
  id: string | number;
  username: string;
  role: Role;
  /** Shown in the header, e.g. "Researcher" or "Clinic"; falls back to username. */
  display_name?: string | null;
}
export type RequestedAs = "health data request" | "health data access application";
export type IntakeMode = "freeform" | "form" | "example" | "json" | "api" | "benchmark";
export type RunStatus = "running" | "done" | "error";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface Applicant {
  name: string;
  organisation: string;
  country: string;
}

export interface DataRequest {
  id?: string | null;
  submitted?: string | null;
  applicant: Applicant;
  requested_as: RequestedAs;
  requested_format: string;
  purpose: string;
  question: string;
  definitions: string[];
}

export interface ArticleRef {
  id: string;
  title: string;
}

export interface Meta {
  articles: Record<string, string>;
  eurlex: string;
  decisions: Decision[];
  prompt_version: string;
  head_questions?: { art54: string; need_for_records: string };
}

export interface NodeHealth {
  hospital: string;
  up: boolean;
  patients_visible?: number;
  opted_out_visible?: number;
  error?: string;
}

export interface Health {
  nodes: NodeHealth[];
  llm: { base_url: string; score_model: string; text_model: string; key_configured: boolean };
}

// ---------- intake ----------
/** Free text -> form fields. The applicant section is never extracted (it stays as the applicant typed it). */
export interface FreeformResult {
  form: Pick<DataRequest, "requested_as" | "requested_format" | "purpose" | "question" | "definitions">;
  filled: string[];
  missing: string[];
}

// ---------- pipeline state ----------
export interface Step {
  id: string;
  label: string;
  status: StepStatus;
  ms?: number | null;
  detail?: string;
}

export interface Head {
  p_yes: number;
  label_mass: number;
  logprobs: Record<string, number>;
}

export interface AttributionUnit {
  field: "purpose" | "question";
  sentence: string;
  delta_art54: number;
  delta_need?: number;
}

export interface DecisionDetail {
  decision: Decision;
  model_decision: Decision;
  articles: string[];
  articles_detail: ArticleRef[];
  probabilities: Record<Decision, number>;
  masked: Decision[];
  heads: {
    art54: Head;
    need_for_records: Head | null;
    category: { probs: Record<string, number>; top: string; label_mass: number };
  };
  margin: number;
  entropy: number;
  flags: string[];
  downgraded: boolean;
  reason: { applicant: string; staff: string; generated: boolean };
  model: string;
  prompt_version: string;
  attribution?: AttributionUnit[];
}

export interface QueryAttempt {
  sql: string;
  error: string | null;
}

export interface PlanOutput {
  name: string;
  merge_expression: string;
  rule: "count" | "ratio";
  count_components: string[];
  is_mean: boolean;
}

export interface PlanPartial {
  alias: string;
  sql: string;
  op: string;
  is_count: boolean;
}

export interface PlanDescription {
  group_keys: string[];
  groups: string[][];
  partials: PlanPartial[];
  outputs: PlanOutput[];
  node_sql: string;
}

export interface QueryState {
  kind?: "statistics" | "cohort";
  sql?: string;
  attempts: QueryAttempt[];
  plan?: PlanDescription;
  tables?: string[];
  observation_loinc?: string[];
}

export interface FederationEntry {
  hospital: string;
  ms: number;
  partial_rows?: number;
  cohort?: number;
}

export type CellValue = string | number | null;
export type ResultRow = Record<string, CellValue>;

export interface Suppression {
  group: string;
  metric: string;
  rule: string;
}

export interface Released {
  group_keys: string[];
  columns: string[];
  rows: ResultRow[];
  by_group: Record<string, Record<string, CellValue>>;
  suppression: Suppression[];
  cells: number;
  privacy_checks: {
    all_groups_present: boolean;
    no_patient_ids: boolean;
    no_counts_below_10: boolean;
    small_ratios_suppressed: boolean;
    groups_outside_request_dropped: string[];
  };
}

/** Data permit of an APPROVE_SPE request; the records sit in an SPE instance session the orchestrator never reads. */
export interface Permit {
  permit_id: string;
  session_id: string;
  issued: string;
  valid_until: string;
  cohort_size?: number;
  tables: Record<string, number>;
  observation_loinc: string[];
  not_copied?: string[];
}

export type StaffResult =
  | { type: "statistics"; released: Released }
  | { type: "spe"; cohort_size: number; permit: Permit }
  | { type: "none" };

export interface LlmCall {
  purpose: string;
  model: string;
  cached: boolean;
  ms: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

export interface LlmUsage {
  calls: number;
  cache_hits: number;
  prompt_tokens: number;
  completion_tokens: number;
  ms: number;
  calls_detail: LlmCall[];
}

export interface StaffView {
  run_id: string;
  reference: string | null;
  created_at: string;
  intake_mode: IntakeMode;
  payload: DataRequest;
  status: RunStatus;
  error: string | null;
  steps: Step[];
  decision: DecisionDetail | null;
  query: QueryState | null;
  federation: FederationEntry[] | null;
  result: StaffResult | null;
  answer: unknown;
  timing: { started: string; total_ms: number | null };
  llm: LlmUsage | null;
  use_cache: boolean;
  forced_decision: Decision | null;
  parent_run: string | null;
  override_note: string | null;
  nodes_done: string[];
}

export type ApplicantResult =
  | {
      type: "statistics";
      group_keys: string[];
      columns: string[];
      rows: ResultRow[];
      suppressed_cells: number;
      cells: number;
    }
  | { type: "spe"; cohort_size: number; permit: Permit }
  | { type: "none" }
  | { type?: undefined };

export interface ApplicantView {
  run_id: string;
  reference: string | null;
  created_at: string;
  status: RunStatus;
  payload: DataRequest;
  steps: Step[];
  nodes_done: string[];
  decision: null | {
    decision: Decision;
    articles: string[];
    articles_detail: ArticleRef[];
    reason: string;
    downgraded: boolean;
    category: string | null;
  };
  result: ApplicantResult;
  error: string | null;
  elapsed_ms: number | null;
}

export interface RequestListItem {
  run_id: string;
  reference: string | null;
  created_at: string;
  intake_mode: IntakeMode;
  status: RunStatus;
  decision: Decision | null;
  payload: DataRequest;
  decision_detail: DecisionDetail | null;
  timing: { started: string; total_ms: number | null } | null;
  flags: string[] | null;
  parent_run: string | null;
}

export interface AuditEvent {
  id: number;
  run_id: string | null;
  ts: string;
  actor: string;
  step: string;
  level: "info" | "warning" | "error" | string;
  message: string;
  duration_ms: number | null;
  payload: unknown;
}

export interface QueryLogEntry {
  ts: string;
  request_id: string;
  kind: string;
  status: string;
  rows: number;
  ms: number;
  sql: string;
  error: string | null;
}

export interface NodesInfo {
  health: NodeHealth[];
  query_logs: Record<string, QueryLogEntry[]>;
}

export interface Dashboard {
  requests: number;
  done: number;
  errors: number;
  decisions: Partial<Record<Decision, number>>;
  confidences: number[];
  flagged: number;
  latency_ms: { mean: number | null; median: number | null; max: number | null };
  stage_ms: Record<string, number>;
  spe_sessions: number;
  models_fitted: number;
  downloads_blocked: number;
  overrides: number;
}

export interface BenchmarkRow {
  ref: string;
  expected: Decision;
  decision: Decision | null;
  articles: string[];
  decision_ok: boolean;
  numbers_ok: boolean | null;
  missing: string[];
  consistent: boolean;
  max_seconds: number;
  leaks: string[];
  runs: number;
  errors: (string | null)[];
}

/** One pipeline run of the benchmark (request x repetition), scored on its own. */
export interface BenchmarkRunRow {
  ref: string;
  run: number;
  run_id: string | null;
  expected: Decision;
  decision: Decision | null;
  articles: string[];
  expected_articles: string[];
  decision_match: boolean;
  articles_ok: boolean;
  decision_ok: boolean;
  expected_answer: Record<string, unknown> | null;
  answer: Record<string, unknown> | null;
  numbers_ok: boolean | null;
  missing: string[];
  /** Expected next to released values, per group (or one "cohort_size" row for records). */
  group_checks: { group: string; expected: unknown; got: unknown; ok: boolean }[];
  consistent: boolean;
  seconds: number;
  leaks: string[];
  error: string | null;
}

export interface BenchmarkSummary {
  correct_decisions: string;
  correct_numbers: string;
  privacy_leaks: number;
  consistency: string;
  slowest_seconds: number | null;
  runs_per_request: number;
  opted_out_visible_to_federation: number;
}

export interface BenchmarkProgress {
  id: string | null;
  status: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  started?: string;
}

export interface BenchmarkReport {
  rows?: BenchmarkRow[];
  run_rows?: BenchmarkRunRow[];
  summary?: BenchmarkSummary;
  progress?: BenchmarkProgress;
  error?: string;
}

export interface BenchmarkState {
  current: BenchmarkProgress;
  latest: null | { id: string; created_at: string; status: string; report: BenchmarkReport };
}

// ---------- transport ----------
export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

/** Turn FastAPI's `detail` (string or pydantic error list) into one readable line. */
export function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === "object" && "msg" in d) {
          const loc = Array.isArray((d as { loc?: unknown[] }).loc) ? (d as { loc: unknown[] }).loc.join(".") : "";
          return `${loc ? loc + ": " : ""}${(d as { msg: string }).msg}`;
        }
        return JSON.stringify(d);
      })
      .join("; ");
  }
  return detail == null ? "" : JSON.stringify(detail);
}

// Called on any 401 outside /api/auth/* (session missing or expired): the AuthProvider sends the user to /login.
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}
function checkAuth(path: string, status: number): void {
  if (status === 401 && !path.startsWith("/api/auth/")) unauthorizedHandler?.();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  checkAuth(path, res.status);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? (body as { detail: unknown }).detail : body;
    throw new ApiError(res.status, detail, detailMessage(detail) || `HTTP ${res.status}`);
  }
  return body as T;
}

const get = <T,>(path: string, signal?: AbortSignal) => request<T>(path, { signal });
const post = <T,>(path: string, body: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body), signal });

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // ---- auth (HttpOnly session cookie) ----
  login: (role: Role, username: string, password: string) => post<{ user: User }>("/api/auth/login", { role, username, password }),
  logout: () => request<null>("/api/auth/logout", { method: "POST" }),
  /** The signed-in user, or null when there is no valid session. */
  me: async (): Promise<User | null> => {
    try {
      return (await get<{ user: User }>("/api/auth/me")).user;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },

  health: () => get<Health>("/api/health"),
  meta: () => get<Meta>("/api/meta"),
  samples: () => get<DataRequest[]>("/api/samples"),
  freeform: (text: string) => post<FreeformResult>("/api/intake/freeform", { text }),
  submit: (request: DataRequest, intake_mode: IntakeMode) =>
    post<{ run_id: string; status: RunStatus }>("/api/requests", { request, intake_mode }),
  listRequests: () => get<RequestListItem[]>("/api/requests"),
  applicantView: (id: string) => get<ApplicantView>(`/api/requests/${encodeURIComponent(id)}?view=applicant`),
  staffView: (id: string) => get<StaffView>(`/api/requests/${encodeURIComponent(id)}?view=staff`),
  audit: (id: string) => get<AuditEvent[]>(`/api/requests/${encodeURIComponent(id)}/audit`),
  resultCsvUrl: (id: string) => `/api/requests/${encodeURIComponent(id)}/result.csv`,
  override: (id: string, decision: Decision, justification: string) =>
    post<{ run_id: string }>(`/api/requests/${encodeURIComponent(id)}/override`, { decision, justification }),
  spe: (id: string) => get<Permit>(`/api/spe/${encodeURIComponent(id)}`),
  /** One-time link to the SPE instance's training page (permit holder); opened in a new tab. */
  openSpe: (id: string) => post<{ url: string }>(`/api/spe/${encodeURIComponent(id)}/open`, {}),
  /** Always refused by the server (403) and audited: records never leave the SPE. */
  downloadSpeRecords: (id: string) => get<never>(`/api/spe/${encodeURIComponent(id)}/records.csv`),
  logs: (f: { run_id?: string; step?: string; q?: string; level?: string; limit?: number; offset?: number }) =>
    get<AuditEvent[]>(`/api/logs${qs(f)}`),
  nodes: () => get<NodesInfo>("/api/nodes"),
  dashboard: () => get<Dashboard>("/api/dashboard"),
  benchmark: () => get<BenchmarkState>("/api/benchmark"),
  startBenchmark: (runs = 3) => post<{ id: string }>("/api/benchmark", { runs }),
  /** Delete the stored benchmark reports (staff); the page starts empty again. */
  resetBenchmark: () => request<{ deleted: number }>("/api/benchmark", { method: "DELETE" }),
};

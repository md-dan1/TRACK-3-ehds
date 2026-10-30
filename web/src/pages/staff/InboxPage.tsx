import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type RequestListItem } from "../../api";
import { DecisionText } from "../../components/DecisionText";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, ErrorBox, HelpChip, LOG_PAGE_SIZE, Pager, ScrollCell, SearchField, Spinner, focusRing } from "../../components/ui";
import { DECISION_META, fmtDateTime, fmtMs, maxProbability, pct } from "../../lib/format";

/** Flags live in decision_detail (the list's top-level `flags` column is always null). */
export function flagsOf(r: Pick<RequestListItem, "decision_detail" | "flags" | "parent_run">): string[] {
  const f = [...(r.decision_detail?.flags ?? []), ...(r.flags ?? [])];
  if (r.parent_run && !f.includes("staff override")) f.push("staff override");
  return Array.from(new Set(f));
}

/** Records were requested but statistics were approved (data minimisation, Art. 66). */
export function isDowngraded(requestedAs: string, decision: string | null | undefined): boolean {
  return requestedAs === "health data access application" && decision === "APPROVE_STATISTICAL";
}

export function DowngradeHelp() {
  return <HelpChip label="Requested type">Requested records, approved as statistics</HelpChip>;
}

/** Small flag icon plus a `?` chip listing the flags; nothing when there are none. */
export function FlagHint({ flags }: { flags: string[] }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Flag className="h-3.5 w-3.5 text-slate-700" aria-hidden />
      <span className="sr-only">Flagged</span>
      <HelpChip label="Flags" items={flags} />
    </span>
  );
}

/** Text a search on the Requests tab matches: reference, run id, organisation, applicant, question, decision, status. */
function searchText(r: RequestListItem): string {
  const rejected = r.status === "done" && r.decision === "REJECT";
  const decision = r.decision ? `${DECISION_META[r.decision].label} ${DECISION_META[r.decision].short}` : "";
  const a = r.payload.applicant;
  return [r.reference ?? "", r.run_id, a.organisation, a.name, r.payload.question, decision, rejected ? "rejected" : r.status].join(" ").toLowerCase();
}

type StatusFilter = "" | "done" | "rejected" | "running" | "error";
type DecisionFilter = "" | "APPROVE_STATISTICAL" | "APPROVE_SPE" | "REJECT";

/** Status as the Status column shows it: a done run with decision REJECT counts as "rejected", not "done". */
function shownStatus(r: RequestListItem): Exclude<StatusFilter, ""> {
  if (r.status === "done" && r.decision === "REJECT") return "rejected";
  return r.status as Exclude<StatusFilter, "">;
}

/** Same rule as the dashboard's "Flagged" count: a finished request whose decision carries flags. */
function isFlagged(r: RequestListItem): boolean {
  return r.status === "done" && (r.decision_detail?.flags?.length ?? 0) > 0;
}

/** Requests tab of Logs: every request, newest first. `live` turns the periodic refresh on/off. */
export function InboxPage({ live = true }: { live?: boolean }) {
  const navigate = useNavigate();
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [decision, setDecision] = useState<DecisionFilter>("");
  const [page, setPage] = useState(0);
  // the Flags filter lives in the URL (?flagged=1) so the dashboard tile can link to it
  const [params, setParams] = useSearchParams();
  const flaggedOnly = params.get("flagged") === "1";
  const setFlaggedOnly = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set("flagged", "1");
    else next.delete("flagged");
    setParams(next, { replace: true });
  };
  const q = useQuery({
    queryKey: ["requests"],
    queryFn: api.listRequests,
    refetchInterval: (query) => (!live ? false : query.state.data?.some((r) => r.status === "running") ? 1500 : 5000),
  });
  const all = q.data ?? [];
  const benchCount = all.filter((r) => r.intake_mode === "benchmark").length;
  const visible = all.filter((r) => showBenchmark || r.intake_mode !== "benchmark");
  const term = search.trim().toLowerCase();
  const filtered = visible.filter(
    (r) =>
      (!term || searchText(r).includes(term)) &&
      (!status || shownStatus(r) === status) &&
      (!decision || r.decision === decision) &&
      (!flaggedOnly || isFlagged(r)),
  );
  // back to the first page whenever the filters change; clamp if the list shrank
  useEffect(() => setPage(0), [term, status, decision, flaggedOnly, showBenchmark]);
  const pages = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * LOG_PAGE_SIZE, (current + 1) * LOG_PAGE_SIZE);

  return (
    <div className="space-y-3">
      {/* search takes all the width the two filters do not need */}
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_8rem]" onSubmit={(e) => e.preventDefault()} aria-label="Filter requests">
        <SearchField id="f-requests" value={search} onChange={setSearch} placeholder="Reference, organisation, applicant, question, decision or status" />
        <div>
          <label htmlFor="f-status" className="mb-1 block text-xs font-medium text-slate-700">
            Status
          </label>
          <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-full px-2.5 py-1.5">
            <option value="">All</option>
            <option value="done">Done</option>
            <option value="rejected">Rejected</option>
            <option value="running">Running</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-decision" className="mb-1 block text-xs font-medium text-slate-700">
            Decision
          </label>
          <select id="f-decision" value={decision} onChange={(e) => setDecision(e.target.value as DecisionFilter)} className="w-full px-2.5 py-1.5">
            <option value="">All</option>
            <option value="APPROVE_STATISTICAL">Statistics</option>
            <option value="APPROVE_SPE">Records</option>
            <option value="REJECT">Rejected</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-flags" className="mb-1 block text-xs font-medium text-slate-700">
            Flags
          </label>
          <select id="f-flags" value={flaggedOnly ? "flagged" : ""} onChange={(e) => setFlaggedOnly(e.target.value === "flagged")} className="w-full px-2.5 py-1.5">
            <option value="">All</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
      </form>

      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox title="Could not load requests" error={q.error} />}
      {q.data && visible.length === 0 && <EmptyState>No requests yet.</EmptyState>}
      {visible.length > 0 && filtered.length === 0 && <EmptyState>No requests match these filters.</EmptyState>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Reference", "Organisation", "Decision", "Confidence", "Latency", "Status", "Submitted"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const conf = maxProbability(r.decision_detail?.probabilities);
                const rejected = r.status === "done" && r.decision === "REJECT";
                const org = r.payload.applicant.organisation;
                return (
                  <tr key={r.run_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/staff/requests/${r.run_id}`)}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        to={`/staff/requests/${r.run_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className={`rounded font-mono font-medium text-brand-700 hover:underline ${focusRing}`}
                      >
                        {r.reference ?? r.run_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      <ScrollCell max="max-w-[22rem]">{org}</ScrollCell>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {!rejected && (
                        <span className="inline-flex items-center gap-1.5">
                          <DecisionText decision={r.decision} />
                          {isDowngraded(r.payload.requested_as, r.decision) && <DowngradeHelp />}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-slate-800">{conf === null ? "–" : pct(conf, 1)}</span>
                        <FlagHint flags={flagsOf(r)} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-slate-700">{fmtMs(r.timing?.total_ms)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <StatusBadge status={rejected ? "rejected" : r.status} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{fmtDateTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {q.data && (
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
          {filtered.length > LOG_PAGE_SIZE && <Pager page={current} pages={pages} hasNext={current < pages - 1} onPage={setPage} />}
          <span className="flex items-center gap-2">
            <input id="show-bench" type="checkbox" className="h-4 w-4" checked={showBenchmark} onChange={(e) => setShowBenchmark(e.target.checked)} />
            <label htmlFor="show-bench" className="text-slate-700">
              Show benchmark runs ({benchCount})
            </label>
          </span>
        </div>
      )}
    </div>
  );
}

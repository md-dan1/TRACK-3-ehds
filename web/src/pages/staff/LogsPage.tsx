import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type AuditEvent, type QueryLogEntry } from "../../api";
import { JsonButton, JsonPanel, hasPayload } from "../../components/JsonView";
import { Tabs } from "../../components/Tabs";
import { EmptyState, ErrorBox, FILTER_GRID, LOG_PAGE_SIZE, Pager, ScrollCell, SearchField, Spinner, focusRing } from "../../components/ui";
import { fmtDateTime, fmtMs, fmtTime } from "../../lib/format";
import { useDebounced } from "../../lib/useNow";
import { InboxPage } from "./InboxPage";
import { LevelChip } from "./request/AuditTab";

const PAGE = LOG_PAGE_SIZE;
type LogTab = "requests" | "audit" | "hospitals";
const TABS: LogTab[] = ["requests", "audit", "hospitals"];

/**
 * Staff "Logs" (/staff/logs): the request list, the audit log and the federated hospital query logs as inner tabs.
 * The inner tab lives in ?tab= (e.g. /staff/logs?tab=audit).
 */
export function LogsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as LogTab | null;
  const tab: LogTab = raw && TABS.includes(raw) ? raw : "requests";
  const setTab = (t: LogTab) => {
    const next = new URLSearchParams(params);
    if (t === "requests") next.delete("tab");
    else next.set("tab", t);
    setParams(next, { replace: true });
  };
  const [live, setLive] = useState(true);
  return (
    <div className="relative">
      <label className="absolute right-0 top-1.5 inline-flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-4 w-4" checked={live} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh
      </label>
      <Tabs<LogTab>
        label="Logs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "requests", label: "Requests" },
          { id: "audit", label: "Audit log" },
          { id: "hospitals", label: "Federated hospital query logs" },
        ]}
      >
        {tab === "requests" && <InboxPage live={live} />}
        {tab === "audit" && <AuditLog live={live} />}
        {tab === "hospitals" && <HospitalLogs live={live} />}
      </Tabs>
    </div>
  );
}

// ---------- audit log ----------
function AuditLog({ live }: { live: boolean }) {
  const [text, setText] = useState("");
  const [level, setLevel] = useState("");
  const [runId, setRunId] = useState("");
  const [page, setPage] = useState(0);
  // debounce a string (stable identity) rather than a fresh object each render
  const filterKey = useDebounced(JSON.stringify({ q: text.trim(), level, run_id: runId.trim() }), 350);
  const filters = useMemo(() => JSON.parse(filterKey) as { q: string; level: string; run_id: string }, [filterKey]);
  useEffect(() => setPage(0), [filterKey]);

  // one extra row tells whether a next page exists
  const logs = useQuery({
    queryKey: ["logs", filters, page],
    queryFn: () => api.logs({ ...filters, limit: PAGE + 1, offset: page * PAGE }),
    refetchInterval: live ? 5000 : false,
    placeholderData: keepPreviousData,
  });
  const rows = (logs.data ?? []).slice(0, PAGE);
  const hasNext = (logs.data?.length ?? 0) > PAGE;

  return (
    <div className="space-y-3">
      <form className={FILTER_GRID} onSubmit={(e) => e.preventDefault()} aria-label="Filter audit log">
        <SearchField id="f-text" value={text} onChange={setText} placeholder="Message or payload" />
        <div>
          <label htmlFor="f-level" className="mb-1 block text-xs font-medium text-slate-700">
            Level
          </label>
          <select id="f-level" value={level} onChange={(e) => setLevel(e.target.value)} className="w-full px-2.5 py-1.5">
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-run" className="mb-1 block text-xs font-medium text-slate-700">
            Run ID
          </label>
          <input id="f-run" value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="Any" className="w-full px-2.5 py-1.5 font-mono" />
        </div>
      </form>

      {logs.isLoading && <Spinner />}
      {logs.isError && <ErrorBox title="Could not load logs" error={logs.error} />}
      {logs.data && rows.length === 0 && <EmptyState>No events match these filters.</EmptyState>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <caption className="sr-only">Audit events, newest first</caption>
            <thead className="bg-slate-50">
              <tr>
                {["Time", "Run", "Actor", "Step", "Message", "Duration", ""].map((h, i) => (
                  <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                    {h || <span className="sr-only">Payload</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((e) => (
                <AuditRow key={e.id} e={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(page > 0 || hasNext) && <Pager page={page} hasNext={hasNext} onPage={setPage} busy={logs.isFetching} />}
    </div>
  );
}

function AuditRow({ e }: { e: AuditEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className="align-top">
        <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-slate-700" title={fmtTime(e.ts)}>
          {fmtDateTime(e.ts)}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5">
          {e.run_id ? (
            <Link to={`/staff/requests/${e.run_id}`} className={`rounded font-mono text-xs text-brand-700 hover:underline ${focusRing}`}>
              {e.run_id}
            </Link>
          ) : (
            <span className="text-xs text-slate-500">–</span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-700">{e.actor}</td>
        <td className="whitespace-nowrap px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-900">
            {e.step}
            <LevelChip level={e.level} />
          </span>
        </td>
        <td className={`px-3 py-1.5 ${e.level === "info" ? "text-slate-800" : "text-red-800"}`}>
          <ScrollCell max="max-w-[26rem]">{e.message || <span className="text-slate-500">–</span>}</ScrollCell>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-slate-700">{e.duration_ms !== null ? fmtMs(e.duration_ms) : "–"}</td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right">{hasPayload(e.payload) && <JsonButton open={open} onClick={() => setOpen((o) => !o)} />}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="px-3 pb-3">
            <JsonPanel value={e.payload} maxHeight="max-h-72" />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ---------- federated hospital query logs ----------
type NodeLogRow = QueryLogEntry & { hospital: string };

function HospitalLogs({ live }: { live: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, refetchInterval: live ? 10000 : false });
  const rows: NodeLogRow[] = useMemo(
    () =>
      Object.entries(q.data?.query_logs ?? {})
        .flatMap(([hospital, entries]) => entries.map((e) => ({ ...e, hospital })))
        .sort((a, b) => b.ts.localeCompare(a.ts)),
    [q.data],
  );
  const term = search.trim().toLowerCase();
  const shown = term
    ? rows.filter((e) =>
        [e.hospital, e.request_id, e.kind, e.kind === "stats" ? "statistics" : "", e.status, e.sql, e.error ?? ""].join(" ").toLowerCase().includes(term),
      )
    : rows;
  useEffect(() => setPage(0), [term]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages - 1);
  return (
    <div className="space-y-3">
      <form onSubmit={(e) => e.preventDefault()} aria-label="Filter federated hospital query logs">
        <SearchField id="f-node" value={search} onChange={setSearch} placeholder="Hospital, request, status or SQL" />
      </form>
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox title="Could not load hospital logs" error={q.error} />}
      {q.data && !rows.length && <EmptyState>No queries have run on hospital data yet.</EmptyState>}
      {rows.length > 0 && !shown.length && <EmptyState>No queries match this search.</EmptyState>}
      {shown.length > 0 && <NodeLogTable rows={shown.slice(current * PAGE, (current + 1) * PAGE)} />}
      {shown.length > PAGE && <Pager page={current} pages={pages} hasNext={current < pages - 1} onPage={setPage} />}
    </div>
  );
}

function NodeLogTable({ rows }: { rows: NodeLogRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">Federated hospital query logs: queries executed on each hospital node, newest first</caption>
        <thead className="bg-slate-50">
          <tr>
            {["Time", "Hospital", "Request", "Kind", "Status", "Rows", "Latency", ""].map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                {h || <span className="sr-only">SQL</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((e, i) => (
            <NodeLogRowView key={`${e.hospital}-${e.ts}-${i}`} e={e} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeLogRowView({ e }: { e: NodeLogRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className="align-top">
        <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-slate-700" title={fmtTime(e.ts)}>
          {fmtDateTime(e.ts)}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-slate-800">{e.hospital}</td>
        <td className="whitespace-nowrap px-3 py-1.5">
          <Link to={`/staff/requests/${e.request_id}`} className={`rounded font-mono text-xs text-brand-700 hover:underline ${focusRing}`}>
            {e.request_id}
          </Link>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{e.kind === "stats" ? "statistics" : e.kind}</td>
        <td className="whitespace-nowrap px-3 py-1.5">
          {e.status === "ok" ? (
            <span className="inline-flex items-center gap-1 text-xs text-slate-900">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-700" aria-hidden /> ok
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-800">
              <XCircle className="h-3.5 w-3.5" aria-hidden /> {e.status}
            </span>
          )}
          {e.error && (
            <ScrollCell max="max-w-xs" className="mt-0.5 text-xs text-red-800">
              {e.error}
            </ScrollCell>
          )}
        </td>
        <td className="px-3 py-1.5 font-mono text-xs tabular-nums">{e.rows}</td>
        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums">{fmtMs(e.ms)}</td>
        <td className="whitespace-nowrap px-3 py-1.5 text-right">
          <JsonButton open={open} onClick={() => setOpen((o) => !o)} label="SQL" />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="px-3 pb-3">
            <JsonPanel value={e.sql} maxHeight="max-h-60" />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

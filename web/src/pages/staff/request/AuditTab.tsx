import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type AuditEvent, type StaffView } from "../../../api";
import { JsonButton, JsonPanel, hasPayload } from "../../../components/JsonView";
import { EmptyState, ErrorBox, HelpChip, Pill, Spinner } from "../../../components/ui";
import { fmtDateTime, fmtMs, fmtTime } from "../../../lib/format";

/** Warnings and errors are the only levels worth a chip; info is the normal case. */
export function LevelChip({ level }: { level: string }) {
  if (level === "info") return null;
  return <Pill tone="danger">{level}</Pill>;
}

export function AuditTab({ view, polling }: { view: StaffView; polling: boolean }) {
  const q = useQuery({
    queryKey: ["audit", view.run_id],
    queryFn: () => api.audit(view.run_id),
    refetchInterval: polling ? 1500 : false,
  });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <ErrorBox title="Could not load the audit trail" error={q.error} />;
  const events = q.data ?? [];
  if (!events.length) return <EmptyState>No audit events.</EmptyState>;
  return (
    <div>
      <p className="mb-3 flex items-center gap-1.5 text-sm text-slate-700">
        {events.length} events
        <HelpChip label="About the audit log">
          Append-only audit log: every step, decision, hospital answer and export attempt is recorded and can never be changed or deleted.
        </HelpChip>
      </p>
      <ol className="relative ml-2 border-l-2 border-slate-200">
        {events.map((e) => (
          <AuditItem key={e.id} e={e} />
        ))}
      </ol>
    </div>
  );
}

function AuditItem({ e }: { e: AuditEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="relative pb-4 pl-5 last:pb-0">
      <span className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full ring-2 ring-white ${e.level === "info" ? "bg-slate-400" : "bg-red-600"}`} aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <time dateTime={e.ts} title={fmtTime(e.ts)} className="tabular-nums text-slate-600">
          {fmtDateTime(e.ts)}
        </time>
        <span className="text-slate-700">{e.actor}</span>
        <span className="font-mono font-medium text-slate-900">{e.step}</span>
        <LevelChip level={e.level} />
        {e.duration_ms !== null && <span className="font-mono text-slate-600">{fmtMs(e.duration_ms)}</span>}
      </div>
      <div className="mt-0.5 flex items-start gap-2">
        {e.message && <p className={`min-w-0 flex-1 break-words text-sm ${e.level === "info" ? "text-slate-800" : "text-red-800"}`}>{e.message}</p>}
        {hasPayload(e.payload) && <JsonButton open={open} onClick={() => setOpen((o) => !o)} />}
      </div>
      {open && (
        <div className="mt-1.5">
          <JsonPanel value={e.payload} />
        </div>
      )}
    </li>
  );
}

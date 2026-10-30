import { useQuery } from "@tanstack/react-query";
import { Clock, GitBranch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type StaffView } from "../../api";
import { BackButton } from "../../components/BackButton";
import { DecisionText } from "../../components/DecisionText";
import { RawRequestJson } from "../../components/JsonView";
import { Stepper } from "../../components/Stepper";
import { Tabs } from "../../components/Tabs";
import { Card, ErrorBox, KeyValueTable, Notice, PageHeader, Pill, Spinner } from "../../components/ui";
import { INTAKE_LABEL, fmtDateTime, fmtMs } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { DowngradeHelp, isDowngraded } from "./InboxPage";
import { AuditTab } from "./request/AuditTab";
import { DecisionTab } from "./request/DecisionTab";
import { LlmTab } from "./request/LlmTab";
import { QueryTab } from "./request/QueryTab";
import { ReleaseTab } from "./request/ReleaseTab";

type TabId = "decision" | "query" | "release" | "audit" | "llm";

/** Attribution is computed in the background after "done", for rejections only (not for overrides or benchmark runs). */
export function awaitingAttribution(v: StaffView | undefined): boolean {
  if (!v || v.status !== "done" || !v.decision || v.decision.attribution || v.decision.decision !== "REJECT") return false;
  if (v.forced_decision || v.intake_mode === "benchmark") return false;
  const finished = Date.parse(v.timing.started) + (v.timing.total_ms ?? 0);
  return Date.now() - finished < 45_000;
}

export function StaffRequestPage() {
  const { id = "" } = useParams();
  const [tab, setTab] = useState<TabId>("decision");
  const q = useQuery({
    queryKey: ["staff-view", id],
    queryFn: () => api.staffView(id),
    staleTime: 0,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      if (d.status === "running") return 700;
      return awaitingAttribution(d) ? 1500 : false;
    },
  });
  // Runs that override this one point back to it via parent_run.
  const list = useQuery({ queryKey: ["requests"], queryFn: api.listRequests, staleTime: 5000 });
  const children = (list.data ?? []).filter((r) => r.parent_run === id);

  if (q.isLoading) return <Spinner label="Loading request…" />;
  if (q.isError) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return <ErrorBox title={nf ? "Unknown request" : "Could not load request"} error={q.error} />;
  }
  const v = q.data!;
  const p = v.payload;

  return (
    <div className="space-y-6">
      <PageHeader before={<BackButton to="/staff/logs" label="Back to logs" />} title={<>Request <span className="font-mono">{v.reference ?? v.run_id}</span></>} />

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <KeyValueTable caption="Request summary" rows={summaryRows(v)} />
          <Card title="Latency" actions={<Elapsed view={v} />}>
            <Stepper steps={v.steps} nodesDone={v.nodes_done} showMs />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {v.parent_run && (
            <Notice tone="neutral" icon={<GitBranch className="h-4 w-4" aria-hidden />} title="Staff override">
              Re-run of{" "}
              <Link className="font-mono underline" to={`/staff/requests/${v.parent_run}`}>
                {v.parent_run}
              </Link>{" "}
              with the decision forced.
              {v.override_note && (
                <>
                  {" "}
                  Justification: <q className="italic">{v.override_note}</q>
                </>
              )}
            </Notice>
          )}
          {children.length > 0 && (
            <Notice tone="neutral" icon={<GitBranch className="h-4 w-4" aria-hidden />} title="This decision was overridden">
              Override run{children.length > 1 ? "s" : ""}:{" "}
              {children.map((c, i) => (
                <span key={c.run_id}>
                  {i > 0 && ", "}
                  <Link className="font-mono underline" to={`/staff/requests/${c.run_id}`}>
                    {c.run_id}
                  </Link>
                </span>
              ))}
            </Notice>
          )}
          {v.status === "error" && <ErrorBox title="Pipeline error: nothing was released" error={v.error} />}

          <Card title="Request">
            <div className="space-y-4 text-sm">
              <Field label="Question">{p.question}</Field>
              <Field label="Purpose">{p.purpose}</Field>
              <Field label="Definitions">
                {p.definitions.map((d, i) => (
                  <span key={i} className={`block ${i === 0 ? "" : "mt-2"}`}>
                    {i + 1}.{" "}
                    {d}
                  </span>
                ))}
              </Field>
            </div>
          </Card>

          <RawRequestJson payload={p} />

          <Tabs<TabId>
            label="Request details"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "decision", label: "Decision" },
              { id: "query", label: "Query" },
              { id: "release", label: "Release" },
              { id: "audit", label: "Audit" },
              { id: "llm", label: "LLM" },
            ]}
          >
            {tab === "decision" && <DecisionTab view={v} awaiting={awaitingAttribution(v)} />}
            {tab === "query" && <QueryTab view={v} />}
            {tab === "release" && <ReleaseTab view={v} />}
            {tab === "audit" && <AuditTab view={v} polling={v.status === "running" || awaitingAttribution(v)} />}
            {tab === "llm" && <LlmTab view={v} />}
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function summaryRows(v: StaffView): [string, ReactNode][] {
  const a = v.payload.applicant;
  const d = v.decision?.decision;
  const flags = Array.from(new Set([...(v.decision?.flags ?? []), ...(v.parent_run ? ["staff override"] : [])]));
  const rows: [string, ReactNode][] = [
    ["Organisation", a.organisation],
    ["Applicant", `${a.name}, ${a.country}`],
    ["Submitted", fmtDateTime(v.created_at)],
    [
      "Decision",
      d ? (
        <span className="inline-flex items-center gap-1.5">
          <DecisionText decision={d} />
          {isDowngraded(v.payload.requested_as, d) && <DowngradeHelp />}
        </span>
      ) : v.status === "running" ? (
        <span className="text-slate-600">Pending</span>
      ) : (
        <span className="text-slate-600">–</span>
      ),
    ],
    ["Run", <span className="font-mono">{v.run_id}</span>],
    ["Intake", INTAKE_LABEL[v.intake_mode] ?? v.intake_mode],
  ];
  if (flags.length) {
    rows.push([
      "Flags",
      <span className="flex flex-wrap gap-1">
        {/* "low label mass" is a model diagnostic, not a review state: plain text */}
        {flags.map((f) => (f === "low label mass" ? <span key={f} className="text-xs text-slate-700">{f}</span> : <Pill key={f}>{f}</Pill>))}
      </span>,
    ]);
  }
  return rows;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-600">{label}</p>
      <div className="text-slate-900">{children}</div>
    </div>
  );
}

function Elapsed({ view }: { view: StaffView }) {
  const running = view.status === "running";
  const now = useNow(running ? 100 : null);
  const ms = running ? Math.max(0, now - Date.parse(view.timing.started)) : view.timing.total_ms;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-slate-700" aria-label={`Total latency ${fmtMs(ms)}`}>
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`}
    </span>
  );
}

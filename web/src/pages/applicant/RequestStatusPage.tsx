import { useMutation, useQuery } from "@tanstack/react-query";
import { Ban, ChevronRight, Clock, Download, Loader2, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, type ApplicantView, type Permit } from "../../api";
import { ArticleChips } from "../../components/ArticleChips";
import { BackButton } from "../../components/BackButton";
import { DecisionText } from "../../components/DecisionText";
import { RawRequestJson } from "../../components/JsonView";
import { PermitDetails } from "../../components/PermitDetails";
import { ResultTable } from "../../components/ResultTable";
import { Stepper } from "../../components/Stepper";
import { WorkingPanel } from "../../components/WorkingSparkle";
import { Card, ErrorBox, HelpChip, Notice, PageHeader, ScrollCell, Spinner, focusRing } from "../../components/ui";
import { fmtDateTime, fmtMs } from "../../lib/format";
import { useNow } from "../../lib/useNow";

export function RequestStatusPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["applicant-view", id],
    queryFn: () => api.applicantView(id),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 700 : false),
    staleTime: 0,
  });

  if (q.isLoading) return <Spinner label="Loading your request…" />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return <ErrorBox title={notFound ? "We could not find this request" : "Could not load your request"} error={notFound ? `No request with id ${id}.` : q.error} />;
  }
  const v = q.data!;
  const running = v.status === "running";
  const d = v.decision;

  return (
    <div className="space-y-6">
      <PageHeader before={<BackButton to="/my" label="Back to old requests" />} title={<>Request <span className="font-mono">{v.reference ?? v.run_id}</span></>} />

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <SummaryTable view={v} />
          <Card title="Latency" actions={<Elapsed view={v} />}>
            <Stepper steps={v.steps} nodesDone={v.nodes_done} />
          </Card>
        </div>

        <div className="min-w-0 space-y-6" aria-live="polite">
          <Card title="Question">
            <p className="text-sm text-slate-800">{v.payload.question}</p>
          </Card>
          {running && !d && (
            <Notice tone="neutral" icon={<Loader2 className="h-4 w-4 animate-spin" aria-hidden />} title="We are checking your request">
              This usually takes a few seconds. You can leave this page; the result is saved under “Old requests”.
            </Notice>
          )}
          {v.status === "error" && (
            <ErrorBox title="Your request could not be completed">
              <p className="mt-1">{v.error ?? "The access body has been notified."} No data was released. You can try again later or contact the access body.</p>
            </ErrorBox>
          )}
          {d?.downgraded && (
            <Notice tone="info" title="Statistics instead of records">
              You asked for records; statistics answer your question, so we approved anonymised statistics instead (data minimisation, Art. 66).
            </Notice>
          )}
          {d && v.status === "done" && <ResultSection view={v} />}
          {running && d?.decision === "APPROVE_SPE" && (
            <WorkingPanel title="Preparing your secure processing environment…">
              <p className="mt-0.5">Starting a container and counting your cohort at the 3 hospitals.</p>
            </WorkingPanel>
          )}
          {running && d && d.decision !== "REJECT" && d.decision !== "APPROVE_SPE" && <Spinner label="Computing your statistics…" />}
          {d?.decision === "REJECT" && <WhatYouCanDo view={v} />}
          {d && <ReasonCard view={v} />}
          <RawRequestJson payload={v.payload} />
        </div>
      </div>
    </div>
  );
}

function SummaryTable({ view }: { view: ApplicantView }) {
  const rows: [string, ReactNode][] = [
    ["Organisation", view.payload.applicant.organisation],
    ["Submitted", fmtDateTime(view.created_at)],
    [
      "Decision",
      view.decision ? (
        <DecisionText decision={view.decision.decision} />
      ) : view.status === "running" ? (
        <span className="text-slate-600">Pending</span>
      ) : (
        <span className="text-slate-600">–</span>
      ),
    ],
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">Request summary</caption>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([k, val]) => (
            <tr key={k}>
              <th scope="row" className="w-28 whitespace-nowrap px-3 py-2 text-left align-top font-medium text-slate-600">
                {k}
              </th>
              <td className="px-3 py-2 text-slate-900">
                <ScrollCell max="max-w-[9.5rem]">{val}</ScrollCell>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Elapsed({ view }: { view: ApplicantView }) {
  const running = view.status === "running";
  const now = useNow(running ? 100 : null);
  const ms = running ? Math.max(0, now - Date.parse(view.created_at)) : view.elapsed_ms;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-slate-700" aria-label={`Elapsed time ${fmtMs(ms)}`}>
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`}
    </span>
  );
}

function TitleWithHelp({ title, help }: { title: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {title}
      <HelpChip label={`About ${title.toLowerCase()}`}>{help}</HelpChip>
    </span>
  );
}

function ResultSection({ view }: { view: ApplicantView }) {
  const r = view.result;
  if (r.type === "statistics") {
    return (
      <Card
        title={
          <TitleWithHelp
            title="Requested statistics"
            help={`Reference date 31 Dec 2025, data from 3 hospitals with opted-out patients excluded; ${r.suppressed_cells} of ${r.cells} cells suppressed.`}
          />
        }
        actions={
          <a
            href={api.resultCsvUrl(view.run_id)}
            download
            className={`inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 ${focusRing}`}
          >
            <Download className="h-4 w-4" aria-hidden />
            Download CSV
          </a>
        }
      >
        <ResultTable columns={r.columns} groupKeys={r.group_keys} rows={r.rows} caption="Released anonymised statistics" />
      </Card>
    );
  }
  if (r.type === "spe") return <SpeResult runId={view.run_id} permit={r.permit} cohortSize={r.cohort_size} />;
  return null;
}

/** Records stay in the SPE: opening it starts a fresh container, which then opens in a new tab through a
 *  one-time link; a download attempt is refused by the server and logged. */
function SpeResult({ runId, permit, cohortSize }: { runId: string; permit: Permit; cohortSize: number }) {
  const open = useMutation({ mutationFn: () => api.openSpe(runId) });
  const download = useMutation({ mutationFn: () => api.downloadSpeRecords(runId) });
  const onOpen = () => {
    open.mutate(undefined, {
      onSuccess: ({ url }) => {
        // a popup blocker may stop the tab after the wait; then this tab follows the one-time link
        const tab = window.open(url, "_blank");
        if (!tab) return void (window.location.href = url);
        tab.opener = null;
      },
    });
  };
  return (
    <Card
      title={<TitleWithHelp title="Requested records" help="Pseudonymised records from 3 hospitals, opted-out patients excluded." />}
      actions={
        <>
          <button
            type="button"
            onClick={() => download.mutate()}
            disabled={download.isPending}
            className={`inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-70 ${focusRing}`}
          >
            <Download className="h-4 w-4" aria-hidden />
            Download records
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={open.isPending}
            className={`inline-flex items-center gap-1.5 rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-70 ${focusRing}`}
          >
            <SquareTerminal className="h-4 w-4" aria-hidden />
            Open secure processing environment (SPE)
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {open.isPending && (
          <WorkingPanel title="Provisioning container…">
            <p className="mt-0.5">Starting a fresh secure processing environment and copying your cohort into it from the 3 hospitals. It opens in a new tab.</p>
          </WorkingPanel>
        )}
        {open.isError && <ErrorBox title="Could not open the secure processing environment" error={open.error} />}
        {download.isError && (
          <Notice tone="warning" icon={<Ban className="h-4 w-4" aria-hidden />} title="Download blocked">
            {download.error.message}
          </Notice>
        )}
        <PermitDetails permit={permit} cohortSize={cohortSize} />
      </div>
    </Card>
  );
}

function WhatYouCanDo({ view }: { view: ApplicantView }) {
  return (
    <Card title="What you can do">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
        <li>If your purpose was misunderstood, describe it more precisely and submit a new request.</li>
        <li>
          Allowed purposes include public health, research, policy-making, official statistics, education and improving care (Art. 53). Uses such as setting insurance
          premiums, advertising or decisions against individuals are prohibited (Art. 54).
        </li>
        <li>You can ask the access body for a human review of this decision. Please quote reference {view.reference ?? view.run_id}.</li>
        <li>No health data was accessed for this request.</li>
      </ul>
      <div className="mt-3">
        <Link to="/apply" state={{ prefill: view.payload }} className={`inline-flex items-center gap-1 rounded text-sm font-medium text-brand-700 hover:underline ${focusRing}`}>
          Start new request with data <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

function ReasonCard({ view }: { view: ApplicantView }) {
  const d = view.decision!;
  return (
    <Card title={d.decision === "REJECT" ? "Reason for rejection" : "Reason for approval"}>
      <p className="text-sm leading-relaxed text-slate-800">{d.reason}</p>
      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-slate-600">Legal basis (Regulation (EU) 2025/327)</p>
        <ArticleChips articles={d.articles_detail} vertical />
      </div>
    </Card>
  );
}

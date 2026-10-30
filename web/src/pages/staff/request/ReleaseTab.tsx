import { Ban, CheckCircle2, Download } from "lucide-react";
import { api, type StaffView } from "../../../api";
import { PermitDetails } from "../../../components/PermitDetails";
import { ResultTable } from "../../../components/ResultTable";
import { Card, HelpChip, Notice, Pill, Spinner, TitleWithHelp, focusRing } from "../../../components/ui";

const CHECK_LABEL: Record<string, string> = {
  all_groups_present: "Every requested group is shown, even if empty",
  no_patient_ids: "No patient identifiers in the output",
  no_counts_below_10: "No count below 10 shown",
  small_ratios_suppressed: "Percentages and means on fewer than 10 patients suppressed",
};

export function ReleaseTab({ view }: { view: StaffView }) {
  const r = view.result;
  if (!r) {
    if (view.status === "running") return <Spinner label="Waiting for the release step…" />;
    return <p className="text-sm text-slate-700">Nothing released{view.status === "error" ? ": the pipeline stopped with an error." : "."}</p>;
  }
  if (r.type === "none") return <p className="text-sm text-slate-700">Nothing released: the request was rejected and no data was accessed.</p>;

  if (r.type === "spe") {
    const p = r.permit;
    return (
      <Card
        title="Requested records"
        actions={
          <>
            <span className="font-mono text-xs text-slate-600">{p.permit_id}</span>
            {/* records live in the SPE instance and never leave it */}
            <Pill tone="danger">
              <Ban className="h-3 w-3" aria-hidden /> Export not permitted
            </Pill>
          </>
        }
      >
        <PermitDetails permit={p} cohortSize={r.cohort_size} staff />
      </Card>
    );
  }

  const rel = r.released;
  const ratioColumns = new Set((view.query?.plan?.outputs ?? []).filter((o) => o.rule === "ratio").map((o) => o.name));
  const checks = (rel.privacy_checks ?? {}) as unknown as Record<string, unknown>;
  const failed = Object.keys(CHECK_LABEL).filter((k) => checks[k] !== true);
  const dropped = rel.privacy_checks?.groups_outside_request_dropped ?? [];
  const checkItems = [
    ...Object.values(CHECK_LABEL),
    `Groups outside the request dropped: ${dropped.length ? dropped.join(", ") : "none"}`,
  ];

  return (
    <Card
      title={
        <TitleWithHelp
          title="Requested statistics"
          help={`${rel.suppression.length} of ${rel.cells} cells suppressed. Per-hospital partials and unsuppressed values are never stored.`}
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
      <ResultTable columns={rel.columns} groupKeys={rel.group_keys} rows={rel.rows} suppression={rel.suppression} ratioColumns={ratioColumns.size ? ratioColumns : undefined} caption="Released statistics" />
      {failed.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-800">
          <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden />
          All privacy checks passed
          <HelpChip label="Privacy checks" items={checkItems} />
        </p>
      ) : (
        <div className="mt-3">
          <Notice tone="warning" title="Privacy checks failed">
            <ul className="list-disc pl-5">
              {failed.map((k) => (
                <li key={k}>{CHECK_LABEL[k]}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
    </Card>
  );
}

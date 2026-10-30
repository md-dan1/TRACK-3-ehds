import { CheckCircle2, XCircle } from "lucide-react";
import type { PlanOutput, QueryAttempt, StaffView } from "../../../api";
import { Card, CodeBlock, Collapsible, HelpChip, Notice, Pill, ScrollCell, Spinner } from "../../../components/ui";

/** Small-cell rule per output, worded like the Researcher side. */
function ruleText(o: PlanOutput): string {
  if (o.rule === "count") return "shown as “<10” below 10";
  return o.is_mean ? "suppressed below 10 patients" : "suppressed if a count is below 10";
}

export function QueryTab({ view }: { view: StaffView }) {
  const q = view.query;
  if (!q) {
    if (view.decision?.decision === "REJECT") return <p className="text-sm text-slate-700">No query was generated: the request was rejected, so no hospital data was accessed.</p>;
    if (view.status === "running") return <Spinner label="Generating the query…" />;
    return <Notice tone="neutral">No query was generated for this run.</Notice>;
  }
  // a clean first attempt is the normal case: summarise it as a chip instead of a card
  const cleanFirstPass = q.attempts.length === 1 && !q.attempts[0].error;

  return (
    <div className="space-y-4">
      {q.sql && (
        <Card title={q.kind === "cohort" ? "Cohort SQL" : "Generated SQL"} actions={cleanFirstPass ? <Pill>Passed the SQL guard</Pill> : undefined}>
          <CodeBlock code={q.sql} />
        </Card>
      )}

      {!cleanFirstPass && q.attempts.length > 0 && (
        <Card title={`Validator attempts (${q.attempts.length})`}>
          <Attempts attempts={q.attempts} />
        </Card>
      )}

      {q.kind === "statistics" && q.plan && (
        <>
          <Collapsible title="Federated plan">
            <div className="space-y-4 text-sm">
              <div>
                <p className="mb-1 font-medium text-slate-600">Groups</p>
                {q.plan.group_keys.length === 0 ? (
                  <p className="text-slate-800">No grouping: one total row.</p>
                ) : (
                  q.plan.group_keys.map((k, i) => (
                    <p key={k} className="text-slate-800">
                      <span className="font-mono">{k}</span>: {(q.plan!.groups[i] ?? []).join(", ")}
                    </p>
                  ))
                )}
              </div>
              <div>
                <p className="mb-1 font-medium text-slate-600">Outputs</p>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {["Output", "Merge expression", "Small-cell rule"].map((h) => (
                          <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {q.plan.outputs.map((o) => (
                        <tr key={o.name}>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-900">{o.name}</td>
                          <td className="px-3 py-1.5 font-mono text-xs text-slate-800">
                            <ScrollCell max="max-w-[22rem]">{o.merge_expression}</ScrollCell>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-800">{ruleText(o)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Collapsible>

          <Collapsible
            title="What each hospital ran"
            actions={
              <HelpChip label="About what each hospital ran">
                Each hospital re-validates this SQL, runs it on its opt-out-filtered views and returns only COUNT/SUM partials per group, never rows. The access body sums
                them and applies the small-cell rule.
              </HelpChip>
            }
          >
            <CodeBlock code={q.plan.node_sql} />
          </Collapsible>
        </>
      )}
    </div>
  );
}

function Attempts({ attempts }: { attempts: QueryAttempt[] }) {
  return (
    <ol className="space-y-3">
      {attempts.map((a, i) => (
        <li key={i} className="rounded-md border border-slate-200 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
            {a.error ? <XCircle className="h-4 w-4 text-red-700" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden />}
            Attempt {i + 1}: {a.error ? "rejected" : "passed the SQL guard"}
          </div>
          {a.error && <p className="mt-1 break-words font-mono text-xs text-red-800">{a.error}</p>}
          <details className="mt-2">
            <summary className="cursor-pointer rounded text-xs font-medium text-brand-700 hover:underline">SQL of this attempt</summary>
            <div className="mt-2">
              <CodeBlock code={a.sql} maxHeight="max-h-60" />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

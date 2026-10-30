import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, FlaskConical, Play, RotateCcw, XCircle } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type BenchmarkRunRow, type BenchmarkSummary, type Decision } from "../../api";
import { DecisionText } from "../../components/DecisionText";
import { Modal } from "../../components/Modal";
import { WorkingPanel } from "../../components/WorkingSparkle";
import { Button, Card, ErrorBox, HelpChip, Kpi, Notice, Spinner } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";

/** "7 of 10" -> [7, 10] */
function ratio(s: string | undefined): [number, number] | null {
  const m = s?.match(/(\d+)\s+of\s+(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function Ok({ value, label }: { value: boolean | null; label?: string }) {
  if (value === null) return <span className="text-slate-500" aria-label={`${label ?? ""} not applicable`}>–</span>;
  return value ? (
    <CheckCircle2 className="mx-auto h-4 w-4 text-green-700" aria-label={`${label ?? ""} correct`} />
  ) : (
    <XCircle className="mx-auto h-4 w-4 text-red-700" aria-label={`${label ?? ""} wrong`} />
  );
}

/** What was expected and whether it was met sit behind the `?` chip. */
function Tile({ label, value, met, help, items }: {
  label: string;
  value: string | number;
  met: boolean;
  help: ReactNode;
  items: ReactNode[];
}) {
  return (
    <Kpi
      label={label}
      help={
        <HelpChip label={`About ${label.toLowerCase()}`} items={items}>
          {help}
        </HelpChip>
      }
      value={
        <span className="inline-flex items-center gap-2">
          {value}
          {met ? <CheckCircle2 className="h-5 w-5 text-green-700" aria-label="target met" /> : <XCircle className="h-5 w-5 text-red-700" aria-label="target missed" />}
        </span>
      }
    />
  );
}

const refsOf = (rows: BenchmarkRunRow[], d: Decision) => rows.filter((r) => r.expected === d).map((r) => r.ref).join(", ");
const valueCount = (v: unknown) => (v && typeof v === "object" ? Object.keys(v).length : 1);

/** The tiles; their `?` chips spell out what expected.json asks for in this benchmark. */
function SummaryTiles({ s, runs }: { s: BenchmarkSummary; runs: BenchmarkRunRow[] }) {
  const all = (v: string | undefined) => {
    const r = ratio(v);
    return r ? r[0] === r[1] : false;
  };
  const slow = s.slowest_seconds;
  const n = s.runs_per_request;
  const firsts = runs.filter((r) => r.run === 1); // one row per request
  const requests = firsts.length;
  const approved = firsts.filter((r) => r.expected_answer);
  const stats = approved.filter((r) => r.group_checks[0]?.group !== "cohort_size");
  const groups = stats.reduce((k, r) => k + r.group_checks.length, 0);
  const values = stats.reduce((k, r) => k + r.group_checks.reduce((m, g) => m + valueCount(g.expected), 0), 0);
  const cohorts = approved.filter((r) => r.group_checks[0]?.group === "cohort_size");
  const times = runs.map((r) => r.seconds).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Tile
        label="Correct decisions"
        value={s.correct_decisions ?? "–"}
        met={all(s.correct_decisions)}
        help={`Expected: every request gets the decision and articles from requests/expected.json, in all ${n} runs.`}
        items={[
          `Rejected: ${refsOf(firsts, "REJECT") || "none"}.`,
          `Statistics: ${refsOf(firsts, "APPROVE_STATISTICAL") || "none"}.`,
          `Records: ${refsOf(firsts, "APPROVE_SPE") || "none"}.`,
          "Articles: all expected ones cited; adding Art. 67 or 71 is allowed.",
          `A request counts only if all ${n} runs are right, so ${requests} of ${requests} = all ${requests * n} runs right.`,
        ]}
      />
      <Tile
        label="Correct numbers"
        value={s.correct_numbers ?? "–"}
        met={all(s.correct_numbers)}
        help={`Expected: every number from requests/expected.json is released under its group, in all ${n} runs.`}
        items={[
          `Statistics: ${values} values in ${groups} groups (${stats.map((r) => r.ref).join(", ")}). Column names and order do not matter; values must match exactly, including <10 and suppressed.`,
          ...cohorts.map((r) => `Records (${r.ref}): cohort of ${Number(r.expected_answer?.cohort_size).toLocaleString("en-GB")} patients in the secure processing environment.`),
          "Rejections have no numbers and are left out.",
          "Expand a row below to see expected values and benchmark results side by side.",
        ]}
      />
      <Tile
        label="Privacy leaks"
        value={s.privacy_leaks}
        met={s.privacy_leaks === 0}
        help="Expected: 0. A statistical answer counts as a leak if it has any of:"
        items={[
          "a patient ID anywhere in the released answer",
          "a released count below 10 (must show as <10)",
          "a failed check in the final privacy step (no patient IDs, no small counts, small ratios suppressed)",
          "any hospital able to see opted-out patients",
        ]}
      />
      <Tile
        label={`Consistent requests across ${n} runs`}
        value={s.consistency ?? "–"}
        met={all(s.consistency)}
        help={`Expected: each request gives exactly the same decision, articles and numbers in all ${n} runs.`}
        items={[
          "Every run asks the model again (LLM cache off), so this shows whether the model is stable.",
          "The Consistent column below shows it for each run's request.",
        ]}
      />
      <Tile
        label="Slowest answer"
        value={slow == null ? "–" : `${slow.toFixed(1)} s`}
        met={slow != null && slow < 60}
        help="Expected: every run answers in under 60 s, from submitting the request to the finished answer."
        items={[`Measured over all ${runs.length} runs. Fastest ${times.length ? times[0].toFixed(1) : "–"} s, median ${median.toFixed(1)} s.`]}
      />
    </div>
  );
}

type Pair = { label: string; expected: string; got: string | null; ok: boolean | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : String(a) === String(b);

/**
 * Expected values of one group next to the released value that matches each, in expected.json order.
 * Released values nobody asked for (e.g. the n next to a mean) follow as extra lines.
 */
function pairUp(expected: unknown, got: unknown): Pair[] {
  const want = isObj(expected) ? Object.entries(expected) : [["value", expected] as [string, unknown]];
  const pool = isObj(got) ? Object.entries(got) : got == null ? [] : [["value", got] as [string, unknown]];
  const rows: Pair[] = want.map(([k, v]) => {
    const i = pool.findIndex(([, g]) => same(g, v));
    const hit = i >= 0 ? pool.splice(i, 1)[0] : null;
    return { label: k, expected: `${k} ${String(v)}`, got: hit ? `${hit[0]} ${String(hit[1])}` : null, ok: !!hit };
  });
  return [...rows, ...pool.map(([k, g]) => ({ label: k, expected: "", got: `${k} ${String(g)}`, ok: null }))];
}

/** Expected and actual of one run, line by line: decision, articles, then every number by group. */
function RunDetail({ r }: { r: BenchmarkRunRow }) {
  const cell = "py-1 pr-4 font-mono";
  const section = (title: string) => (
    <tr>
      <th colSpan={4} scope="colgroup" className="pb-1 pt-3 text-left text-xs font-semibold text-slate-700">{title}</th>
    </tr>
  );
  return (
    <div className="rounded-md bg-slate-50 p-3 text-xs">
      {r.error && <p className="mb-2 text-red-800">Error: {r.error}</p>}
      {r.leaks.map((l) => (
        <p key={l} className="mb-2 text-red-800">Leak: {l}</p>
      ))}
      <table className="min-w-full">
        <thead>
          <tr className="text-left text-slate-600">
            <th scope="col" className="w-40 py-1 pr-4 font-medium"><span className="sr-only">Item</span></th>
            <th scope="col" className="py-1 pr-4 font-medium">Expected (expected.json)</th>
            <th scope="col" className="py-1 pr-4 font-medium">Benchmark result</th>
            <th scope="col" className="w-16 py-1 text-center font-medium">Match</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-200">
            <th scope="row" className="py-1 pr-4 text-left font-medium text-slate-800">Decision</th>
            <td className="py-1 pr-4"><DecisionText decision={r.expected} /></td>
            <td className="py-1 pr-4"><DecisionText decision={r.decision} /></td>
            <td className="py-1 text-center"><Ok value={r.decision_match} label="Decision" /></td>
          </tr>
          <tr className="border-t border-slate-200">
            <th scope="row" className="py-1 pr-4 text-left font-medium text-slate-800">Articles</th>
            <td className={cell}>{r.expected_articles.join(", ")}</td>
            <td className={cell}>{r.articles.join(", ")}</td>
            <td className="py-1 text-center"><Ok value={r.articles_ok} label="Articles" /></td>
          </tr>
          {r.expected_answer ? (
            <>
              {section("Numbers")}
              {r.group_checks.map((g) =>
                pairUp(g.expected, g.got).map((p, i) => (
                  <tr key={`${g.group}-${p.label}-${i}`} className={i === 0 ? "border-t border-slate-300" : "border-t border-slate-100"}>
                    <th scope="row" className="py-1 pr-4 text-left font-medium text-slate-800">
                      {i === 0 ? (g.group === "cohort_size" ? "Cohort size" : g.group) : <span className="sr-only">{g.group}</span>}
                    </th>
                    <td className={cell}>{p.expected}</td>
                    <td className={cell}>
                      {p.got ?? <span className="font-sans text-red-800">not found</span>}
                      {p.ok === null && <span className="ml-2 font-sans text-slate-500">(extra)</span>}
                    </td>
                    <td className="py-1 text-center">{p.ok !== null && <Ok value={p.ok} label={`${g.group} ${p.label}`} />}</td>
                  </tr>
                )),
              )}
            </>
          ) : (
            <tr className="border-t border-slate-200">
              <th scope="row" className="py-1 pr-4 text-left font-medium text-slate-800">Numbers</th>
              <td colSpan={3} className="py-1 text-slate-600">Rejections have no expected numbers.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Every pipeline run as its own row: a check per expectation; the values themselves in the expanded row
 *  (all rows start collapsed). */
function RunsCard({ runs }: { runs: BenchmarkRunRow[] }) {
  const key = (r: BenchmarkRunRow) => `${r.ref}-${r.run}`;
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const allOpen = open.size === runs.length;
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const th = "whitespace-nowrap py-2 pr-3";
  const td = "whitespace-nowrap py-2 pr-3";
  const seg = (active: boolean) =>
    `rounded px-2 py-1 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`;
  return (
    <Card
      title={`All ${runs.length} runs`}
      actions={
        <div role="group" aria-label="Row details" className="inline-flex rounded-md bg-slate-100 p-0.5 text-xs">
          <button type="button" aria-pressed={allOpen} onClick={() => setOpen(new Set(runs.map(key)))} className={seg(allOpen)}>
            Expand all
          </button>
          <button type="button" aria-pressed={open.size === 0} onClick={() => setOpen(new Set())} className={seg(open.size === 0)}>
            Collapse all
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-700">
              <th scope="col" className="w-6 py-2 pr-1"><span className="sr-only">Details</span></th>
              <th scope="col" className={th}>Request</th>
              <th scope="col" className={th}>Run</th>
              <th scope="col" className={`${th} text-center`}>Expected decision</th>
              <th scope="col" className={`${th} text-center`}>Expected articles</th>
              <th scope="col" className={`${th} text-center`}>Expected numbers</th>
              <th scope="col" className={`${th} text-center`}>Consistent</th>
              <th scope="col" className={`${th} text-right`}>Time</th>
              <th scope="col" className="whitespace-nowrap py-2 text-right">Leaks</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => {
              const k = key(r);
              const expanded = open.has(k);
              const newRequest = i > 0 && runs[i - 1].ref !== r.ref;
              return (
                <Fragment key={k}>
                  <tr className={`align-top ${newRequest ? "border-t border-slate-300" : i > 0 ? "border-t border-slate-100" : ""}`}>
                    <td className="py-2 pr-1">
                      <button
                        type="button"
                        onClick={() => toggle(k)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} values of ${r.ref} run ${r.run}`}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                      >
                        <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden />
                      </button>
                    </td>
                    <th scope="row" className={`${td} text-left font-mono font-medium`}>{r.ref}</th>
                    <td className={`${td} font-mono text-xs`}>
                      {r.run}
                      {r.run_id && <Link to={`/staff/requests/${r.run_id}`} className="ml-2 text-brand-700 hover:underline">{r.run_id}</Link>}
                    </td>
                    <td className={`${td} text-center`}><Ok value={r.decision_match} label="Expected decision" /></td>
                    <td className={`${td} text-center`}><Ok value={r.articles_ok} label="Expected articles" /></td>
                    <td className={`${td} text-center`}><Ok value={r.numbers_ok} label="Expected numbers" /></td>
                    <td className={`${td} text-center`}><Ok value={r.consistent} label="Consistent" /></td>
                    <td className={`${td} text-right font-mono tabular-nums`}>{r.seconds.toFixed(1)} s</td>
                    <td className={`whitespace-nowrap py-2 text-right font-mono tabular-nums ${r.leaks.length ? "text-red-800" : ""}`}>{r.leaks.length}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td />
                      <td colSpan={8} className="pb-3 pr-3">
                        <RunDetail r={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Repetitions of each example request per benchmark. */
const RUNS = 3;

export function BenchmarkPage() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const state = useQuery({
    queryKey: ["benchmark"],
    queryFn: api.benchmark,
    refetchInterval: (q) => (q.state.data?.current.status === "running" ? 1500 : false),
  });
  const start = useMutation({
    mutationFn: () => api.startBenchmark(RUNS),
    onSuccess: () => {
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ["benchmark"] });
    },
  });

  const reset = useMutation({
    mutationFn: api.resetBenchmark,
    onSuccess: () => {
      setConfirmReset(false);
      qc.invalidateQueries({ queryKey: ["benchmark"] });
    },
  });

  if (state.isLoading) return <Spinner label="Loading benchmark…" />;
  if (state.isError) return <ErrorBox title="Could not load the benchmark" error={state.error} />;
  const { current, latest } = state.data!;
  const running = current.status === "running";
  const report = latest?.report;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <Button variant="primary" onClick={() => setConfirm(true)} disabled={running}>
          <Play className="h-4 w-4" aria-hidden /> Run benchmark
        </Button>
        <HelpChip label="About the benchmark">The 10 example requests × 3 runs with the LLM cache off, scored against expected.json like eval/run_eval.py.</HelpChip>
      </div>

      {running && (
        <WorkingPanel title="Benchmark running">
          <p className="mb-2 mt-0.5">Running the {current.total / RUNS} example requests {RUNS} times each.</p>
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0}
                 aria-valuemax={current.total} aria-valuenow={current.done} aria-label="Benchmark progress">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${current.total ? (100 * current.done) / current.total : 0}%` }} />
            </div>
            <span className="font-mono text-xs tabular-nums">{current.done} / {current.total}</span>
          </div>
        </WorkingPanel>
      )}

      {!latest && !running && <p className="text-sm text-slate-700">No benchmark has run yet.</p>}
      {report?.error && <ErrorBox title="The last benchmark failed" error={report.error} />}
      {latest?.status === "interrupted" && !running && (
        <Notice tone="warning" title="The last benchmark was interrupted">
          The service restarted after {report?.progress?.done ?? 0} of {report?.progress?.total ?? 0} runs. Run the benchmark again for all results.
        </Notice>
      )}

      {report?.summary && (
        <>
          <SummaryTiles s={report.summary} runs={report.run_rows ?? []} />
          <p className="text-xs text-slate-600">
            Run {latest!.id}, {fmtDateTime(latest!.created_at)}
          </p>
        </>
      )}
      {report?.run_rows && report.run_rows.length > 0 && (
        <RunsCard key={latest!.id} runs={report.run_rows} />
      )}

      {latest && !running && (
        <div className="flex justify-end">
          <Button onClick={() => setConfirmReset(true)}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Reset benchmark
          </Button>
        </div>
      )}

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset the benchmark?"
        icon={<RotateCcw className="h-5 w-5 text-brand-700" aria-hidden />}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset benchmark
            </Button>
          </>
        }
      >
        This deletes the stored benchmark results, so the page starts empty again. The benchmark's runs stay in the logs.
        {reset.isError && <ErrorBox error={reset.error} />}
      </Modal>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Run the benchmark?"
        icon={<FlaskConical className="h-5 w-5 text-brand-700" aria-hidden />}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
              Start 30 runs
            </Button>
          </>
        }
      >
        This submits each of the 10 example requests 3 times without the LLM cache (30 pipeline runs, about 1–2 minutes).
        The runs are hidden from the inbox.
        {start.isError && <ErrorBox error={start.error} />}
      </Modal>
    </div>
  );
}

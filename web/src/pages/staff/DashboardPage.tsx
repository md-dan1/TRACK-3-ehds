import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { api, type Decision } from "../../api";
import { Card, ErrorBox, HelpChip, Kpi, Spinner } from "../../components/ui";
import { DECISION_META, DECISION_ORDER, STEP_LABEL, fmtMs } from "../../lib/format";

// Chart tokens: single-series hue and recessive axes/grid
const SERIES = "#1e40af";
const GRID = "#e2e8f0";
const AXIS = "#475569";

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { value: number; payload: { label?: string } }[]; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium text-slate-900">{payload[0].payload.label}</p>
      <p className="font-mono tabular-nums text-slate-700">
        {payload[0].value.toLocaleString("en-GB")}
        {unit ? ` ${unit}` : ""}
      </p>
    </div>
  );
}

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return <Card title={title}>{empty ? <p className="py-10 text-center text-sm text-slate-600">No completed requests yet.</p> : <div className="h-52">{children}</div>}</Card>;
}

export function DashboardPage() {
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, refetchInterval: 10000 });
  const nodes = useQuery({ queryKey: ["nodes"], queryFn: api.nodes, refetchInterval: 15000 });

  if (dash.isLoading) return <Spinner label="Loading dashboard…" />;
  if (dash.isError) return <ErrorBox title="Could not load the dashboard" error={dash.error} />;
  const d = dash.data!;

  const decisionData = DECISION_ORDER.map((k: Decision) => ({ key: k, short: DECISION_META[k].short, label: DECISION_META[k].label, value: d.decisions[k] ?? 0, color: DECISION_META[k].chart }));
  const stageData = Object.keys(STEP_LABEL)
    .filter((k) => d.stage_ms[k] !== undefined)
    .map((k) => ({ label: STEP_LABEL[k], value: d.stage_ms[k] }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Requests"
          value={d.requests}
          help={
            <HelpChip
              label="About requests"
              items={[`${d.done} done`, `${d.errors} errors`, `${d.overrides} staff overrides`, "Benchmark runs are not counted."]}
            />
          }
        />
        <Kpi
          label="Average latency"
          value={fmtMs(d.latency_ms.mean)}
          help={<HelpChip label="About latency" items={[`Median latency ${fmtMs(d.latency_ms.median)}`, `Max latency ${fmtMs(d.latency_ms.max)}`]} />}
        />
        <Kpi label="SPE sessions" value={d.spe_sessions} />
        <Kpi label="Models fitted in SPEs" value={d.models_fitted} />
        <Kpi label="Blocked downloads" value={d.downloads_blocked} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Decision mix" empty={d.done === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={decisionData} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }} barCategoryGap="30%">
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="short" width={80} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} content={<ChartTooltip unit="requests" />} />
              <Bar dataKey="value" maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {decisionData.map((x) => (
                  <Cell key={x.key} fill={x.color} />
                ))}
                <LabelList dataKey="value" position="right" style={{ fill: "#0f172a", fontSize: 12 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Average time per pipeline stage" empty={stageData.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stageData} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap="30%">
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} unit=" ms" />
              <YAxis type="category" dataKey="label" width={190} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
              <RTooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} content={<ChartTooltip unit="ms (mean)" />} />
              <Bar dataKey="value" fill={SERIES} maxBarSize={24} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                <LabelList dataKey="value" position="right" formatter={(v: number) => fmtMs(v)} style={{ fill: "#0f172a", fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Card title="Hospital nodes">
        {nodes.isLoading && <Spinner />}
        {nodes.isError && <ErrorBox title="Could not reach the nodes endpoint" error={nodes.error} />}
        {nodes.data && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-slate-700">
                  <th scope="col" className="whitespace-nowrap py-1.5 pr-4 font-semibold">Hospital</th>
                  <th scope="col" className="whitespace-nowrap py-1.5 pr-4 text-right font-semibold">Patients</th>
                  <th scope="col" className="whitespace-nowrap py-1.5 pr-4 font-semibold">Status</th>
                  <th scope="col" className="whitespace-nowrap py-1.5 font-semibold">Opt-out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {nodes.data.health.map((n) => (
                  <tr key={n.hospital}>
                    <th scope="row" className="whitespace-nowrap py-1.5 pr-4 text-left font-normal text-slate-900">
                      {n.hospital}
                    </th>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-right font-mono tabular-nums">{n.patients_visible?.toLocaleString("en-GB") ?? "–"}</td>
                    <td className="whitespace-nowrap py-1.5 pr-4">
                      <span className={`inline-flex items-center gap-1.5 ${n.up ? "text-slate-900" : "text-red-800"}`}>
                        <span className={`h-2.5 w-2.5 rounded-full ${n.up ? "bg-green-600" : "bg-red-600"}`} aria-hidden />
                        {n.up ? "online" : "offline"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-1.5">
                      {!n.up || n.opted_out_visible === undefined ? (
                        <span className="text-slate-500">–</span>
                      ) : n.opted_out_visible === 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-slate-900">
                          <Check className="h-4 w-4 text-slate-500" aria-hidden />
                          Opt-out patients omitted
                        </span>
                      ) : (
                        <span className="font-medium text-red-800">{n.opted_out_visible} opt-out patients visible</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

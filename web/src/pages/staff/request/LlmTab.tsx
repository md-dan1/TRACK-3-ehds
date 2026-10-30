import type { StaffView } from "../../../api";
import { Card, DefinitionList, Notice, ScrollCell, Spinner, TitleWithHelp } from "../../../components/ui";
import { fmtMs } from "../../../lib/format";

export function LlmTab({ view }: { view: StaffView }) {
  const l = view.llm;
  const d = view.decision;
  if (!l) return view.status === "running" ? <Spinner label="LLM usage is recorded when the run finishes…" /> : <Notice tone="neutral">No LLM usage recorded.</Notice>;
  const total = l.calls + l.cache_hits;
  const tokens = l.prompt_tokens + l.completion_tokens;
  const textModels = Array.from(new Set(l.calls_detail.map((c) => c.model).filter((m) => m !== d?.model)));

  return (
    <div className="space-y-4">
      <Card title="Model">
        <DefinitionList
          items={[
            ["Scoring model", <span className="font-mono text-xs">{d?.model ?? "–"}</span>],
            ...(textModels.length ? ([["Text model", <span className="font-mono text-xs">{textModels.join(", ")}</span>]] as [string, JSX.Element][]) : []),
            ["Prompt version", <span className="font-mono text-xs">{d?.prompt_version ?? "–"}</span>],
          ]}
        />
      </Card>

      <Card
        title={
          <TitleWithHelp
            title="Calls"
            help="Only request text is sent to the LLM. Sentence-attribution calls run after the answer and are logged in the audit trail (step decision.attribution)."
          />
        }
      >
        <p className="mb-3 text-sm text-slate-800">
          {total} calls, {l.cache_hits} from cache, {tokens.toLocaleString("en-GB")} tokens, {fmtMs(l.ms)}
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-slate-700">
                {["#", "Purpose", "Model", "Source", "Time", "Prompt tokens", "Completion tokens"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-2 py-1.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {l.calls_detail.map((c, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">{i + 1}</td>
                  <td className="px-2 py-1.5 text-slate-900">
                    <ScrollCell max="max-w-[16rem]">{c.purpose}</ScrollCell>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{c.model}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{c.cached ? "cached" : "live"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs tabular-nums">{fmtMs(c.ms)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs tabular-nums">{c.prompt_tokens ?? "–"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs tabular-nums">{c.completion_tokens ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

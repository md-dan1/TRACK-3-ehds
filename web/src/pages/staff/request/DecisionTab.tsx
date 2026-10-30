import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gavel, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type AttributionUnit, type Decision, type DecisionDetail, type StaffView } from "../../../api";
import { ArticleChips, useMeta } from "../../../components/ArticleChips";
import { DecisionText } from "../../../components/DecisionText";
import { Modal } from "../../../components/Modal";
import { DecisionProbRows, ProbMeter, ProbMeterLegend, ProbRow, type ScoreMarker } from "../../../components/ProbBar";
import { Tooltip } from "../../../components/Tooltip";
import { Button, Card, ErrorBox, Notice, Spinner, TitleWithHelp } from "../../../components/ui";
import { DECISION_META, DECISION_ORDER, REVIEW_ART54, REVIEW_NEED, pct, pp } from "../../../lib/format";

export function DecisionTab({ view, awaiting }: { view: StaffView; awaiting: boolean }) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const d = view.decision;
  if (!d) {
    return view.status === "running" ? <Spinner label="Scoring the request…" /> : <Notice tone="neutral">No decision was recorded for this run.</Notice>;
  }
  const isApplication = view.payload.requested_as === "health data access application";
  const p54 = d.heads.art54.p_yes;
  const questions = useMeta().data?.head_questions;
  const showCategory = d.decision === "REJECT" || (p54 > REVIEW_ART54[0] && p54 < REVIEW_ART54[1]);

  return (
    <div className="space-y-4">
      <Card
        title={
          <TitleWithHelp
            title="Decision probabilities"
            items={[
              `Margin ${(d.margin * 100).toFixed(1)} percentage points: the gap between the two most likely options.`,
              `Normalised entropy ${d.entropy.toFixed(2)}: 0 is certain, 1 is uniform over the allowed options.`,
              "P(Rejected) = p₅₄, P(Records) = (1 − p₅₄) × p_need, P(Statistics) = the rest. Art. 54 is checked first, then the need for records.",
            ]}
          />
        }
      >
        <DecisionProbRows probabilities={d.probabilities} masked={d.masked} />
      </Card>

      <Card
        title={
          <TitleWithHelp
            title="Scoring heads"
            items={[
              "Each head is one yes/no question scored from the model's token probabilities.",
              `Label mass, the model's own probability on the allowed answers: prohibited purpose ${pct(d.heads.art54.label_mass, 1)}${
                d.heads.need_for_records ? `, need for records ${pct(d.heads.need_for_records.label_mass, 1)}` : ""
              }. Below 90% raises the flag “low label mass”.`,
            ]}
          />
        }
      >
        {/* a rule between heads; no padding above the first or below the last */}
        <div className="divide-y divide-slate-200 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0 [&>*]:py-4">
          <Head title="Prohibited purpose (Art. 54)" question={questions?.art54} p={p54} band={REVIEW_ART54} thresholdLabel="Rejection threshold" highIsRejection />
          {d.heads.need_for_records && (
            <Head title="Need for records" question={questions?.need_for_records} p={d.heads.need_for_records.p_yes} band={REVIEW_NEED} thresholdLabel="Records threshold" />
          )}
        </div>
      </Card>

      {showCategory && <CategoryCard d={d} />}

      {/* attribution explains a rejection; approvals do not show it */}
      {d.decision === "REJECT" && <AttributionCard d={d} awaiting={awaiting} forced={!!view.forced_decision} />}

      <ReasonCard d={d} running={view.status === "running"} onOverride={() => setOverrideOpen(true)} />

      <OverrideModal open={overrideOpen} onClose={() => setOverrideOpen(false)} view={view} isApplication={isApplication} />
    </div>
  );
}

const THRESHOLD = 0.5;

/**
 * Marker of a head's score. Red means the score rejects (only where a high score is a rejection, Art. 54):
 * a cross above the flagging band, a flag inside it. Orange flag: inside the band below the threshold.
 * Green check: outside the band and not rejecting. A flag always means a human checks it.
 */
function scoreMarker(p: number, band: [number, number], highIsRejection: boolean): ScoreMarker {
  const inBand = p > band[0] && p < band[1]; // strict, as decision.py sets the "borderline" flag
  const rejects = highIsRejection && p >= THRESHOLD;
  if (inBand) return { tone: rejects ? "text-red-700" : "text-amber-600", glyph: "flag" };
  return rejects ? { tone: "text-red-700", glyph: "x" } : { tone: "text-green-600", glyph: "check" };
}

function Head({ title, question, p, band, thresholdLabel, highIsRejection = false }: {
  title: string;
  question?: string;
  p: number;
  band: [number, number];
  thresholdLabel: string;
  highIsRejection?: boolean;
}) {
  const marker = scoreMarker(p, band, highIsRejection);
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-slate-900">{title}</div>
      <ProbMeter value={p} band={band} label={`${title} probability`} marker={marker} threshold={THRESHOLD} />
      {question && <div className="text-xs text-slate-600">Asked the model: “{question}”</div>}
      <ProbMeterLegend value={p} band={band} thresholdLabel={thresholdLabel} threshold={THRESHOLD} marker={marker} />
    </div>
  );
}

function CategoryCard({ d }: { d: DecisionDetail }) {
  const entries = Object.entries(d.heads.category.probs).sort((a, b) => b[1] - a[1]);
  return (
    <Card
      title={
        <TitleWithHelp
          title="Art. 54 category"
          help={`Which prohibited use the purpose would fall under. Shown for rejections and borderline Art. 54 scores. Label mass ${pct(d.heads.category.label_mass, 1)}.`}
        />
      }
    >
      <ul className="space-y-2">
        {entries.map(([cat, p]) => (
          <ProbRow
            key={cat}
            label={<span className={cat === d.heads.category.top ? "font-semibold text-slate-900" : "text-slate-700"}>{cat}</span>}
            value={p}
            barClass="bg-slate-500"
            wideLabel
          />
        ))}
      </ul>
    </Card>
  );
}

function ReasonCard({ d, running, onOverride }: { d: DecisionDetail; running: boolean; onOverride: () => void }) {
  return (
    <Card
      title={d.decision === "REJECT" ? "Reason for rejection" : "Reason for approval"}
      actions={
        <Button size="sm" onClick={onOverride} disabled={running}>
          <Gavel className="h-3.5 w-3.5" aria-hidden /> Override decision…
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        {d.model_decision !== d.decision && (
          <p className="flex flex-wrap items-center gap-1.5 text-slate-700">
            Staff override. The model decided <DecisionText decision={d.model_decision} />
          </p>
        )}
        <ReasonText label="LLM-Judge note" text={d.reason.staff} generated={d.reason.generated} />
        <ReasonText label="Shown to the applicant" text={d.reason.applicant} generated={d.reason.generated} />
        <div>
          <p className="mb-1.5 font-medium text-slate-600">Legal basis (Regulation (EU) 2025/327)</p>
          <ArticleChips articles={d.articles_detail} vertical />
        </div>
      </div>
    </Card>
  );
}

function ReasonText({ label, text, generated }: { label: string; text: string; generated: boolean }) {
  return (
    <div>
      <p className="mb-1 font-medium text-slate-600">
        {label}
        {!generated && <span className="font-normal text-slate-500"> (template text)</span>}
      </p>
      <p className="leading-relaxed text-slate-900">{text || <span className="text-slate-500">–</span>}</p>
    </div>
  );
}

// ---------- sentence attribution ----------
type AttrMode = "art54" | "need";

function shade(delta: number, mode: AttrMode): string {
  const a = 0.45 * Math.min(1, Math.sqrt(Math.abs(delta) / 0.5));
  if (mode === "art54") return delta >= 0 ? `rgba(220,38,38,${a})` : `rgba(22,163,74,${a})`;
  return delta >= 0 ? `rgba(29,78,216,${a})` : `rgba(13,148,136,${a})`;
}

function deltaText(u: AttributionUnit, mode: AttrMode): string {
  const v = mode === "art54" ? u.delta_art54 : (u.delta_need ?? 0);
  const what = mode === "art54" ? "prohibited purpose" : "need for records";
  const dir = mode === "art54" ? (v >= 0 ? "pushes toward prohibited" : "pushes away from prohibited") : v >= 0 ? "supports the need for records" : "weakens the need for records";
  return `${pp(v)} ${what}: this sentence ${dir}.`;
}

function AttributionCard({ d, awaiting, forced }: { d: DecisionDetail; awaiting: boolean; forced: boolean }) {
  const units = d.attribution;
  const hasNeed = !!units?.some((u) => u.delta_need !== undefined);
  const [mode, setMode] = useState<AttrMode>("art54");

  return (
    <Card
      title={
        <TitleWithHelp
          title="Sentence attribution"
          items={[
            "Each sentence was removed and the request scored again. Hover or focus a sentence for its value.",
            "Explains the decision for staff; it does not change it.",
          ]}
        />
      }
      actions={
        units && hasNeed ? (
          <div role="group" aria-label="Attribution head" className="inline-flex rounded-md bg-slate-100 p-0.5 text-xs">
            {(["art54", "need"] as AttrMode[]).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded px-2 py-1 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
              >
                {m === "art54" ? "Prohibited purpose" : "Need for records"}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {!units ? (
        awaiting ? (
          <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Computing sentence attribution…
          </p>
        ) : (
          <p className="text-sm text-slate-600">{forced ? "Not computed for staff override runs." : "No attribution available for this run."}</p>
        )
      ) : (
        <div className="space-y-4">
          {(["purpose", "question"] as const).map((field) => {
            const list = units.filter((u) => u.field === field);
            if (!list.length) return null;
            return (
              <div key={field}>
                <p className="mb-1 text-sm font-medium text-slate-600">{field === "purpose" ? "Purpose" : "Question"}</p>
                <ul className="space-y-1.5 text-sm leading-snug text-slate-900">
                  {list.map((u, i) => {
                    const v = mode === "art54" ? u.delta_art54 : (u.delta_need ?? 0);
                    return (
                      // one sentence per row, so its value can never be read as part of the next sentence
                      <li key={i} className="flex items-baseline gap-4">
                        <span className="min-w-0 flex-1">
                          <Tooltip content={deltaText(u, mode)} focusable className="inline">
                            <span className="rounded-sm px-1.5 py-0.5 [box-decoration-break:clone]" style={{ backgroundColor: shade(v, mode) }}>
                              {u.sentence}
                            </span>
                          </Tooltip>
                        </span>
                        <span className="w-16 flex-none text-right font-mono text-xs tabular-nums text-slate-600">{pp(v)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600">
            <span>pp = Percentage-points = Score-with-sentence-included - score-with-sentence-excluded</span>
            <span className="flex min-w-[16rem] flex-1 items-center gap-2">
              <span className="whitespace-nowrap">{mode === "art54" ? "Not rejection causing" : "Weakens need for records"}</span>
              <span className="block h-2 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${shade(-0.5, mode)}, transparent, ${shade(0.5, mode)})` }} aria-hidden />
              <span className="whitespace-nowrap">{mode === "art54" ? "Rejection causing" : "Supports need for records"}</span>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- override ----------
function OverrideModal({ open, onClose, view, isApplication }: { open: boolean; onClose: () => void; view: StaffView; isApplication: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const current = view.decision?.decision;
  const [decision, setDecision] = useState<Decision>(current === "REJECT" ? "APPROVE_STATISTICAL" : "REJECT");
  const [justification, setJustification] = useState("");
  const [touched, setTouched] = useState(false);
  const valid = justification.trim().length >= 10;
  const m = useMutation({
    mutationFn: () => api.override(view.run_id, decision, justification.trim()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["requests"] });
      onClose();
      navigate(`/staff/requests/${r.run_id}`);
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Override decision"
      icon={<Gavel className="h-5 w-5 text-slate-700" aria-hidden />}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              setTouched(true);
              if (valid) m.mutate();
            }}
          >
            Re-run with this decision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-1.5">
          The pipeline re-runs with the decision forced; the original run stays in the audit trail. Current decision: <DecisionText decision={current} />
        </p>
        <div>
          <label htmlFor="ov-decision" className="mb-1 block text-sm font-medium text-slate-800">
            New decision
          </label>
          <select id="ov-decision" value={decision} onChange={(e) => setDecision(e.target.value as Decision)} className="w-full px-3 py-2">
            {DECISION_ORDER.map((d) => (
              <option key={d} value={d} disabled={d === "APPROVE_SPE" && !isApplication}>
                {DECISION_META[d].label}
                {d === "APPROVE_SPE" && !isApplication ? " (not allowed for statistics requests)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ov-just" className="mb-1 block text-sm font-medium text-slate-800">
            Justification <span className="text-red-700" aria-hidden>*</span>
          </label>
          <textarea
            id="ov-just"
            rows={4}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={touched && !valid}
            aria-describedby="ov-just-hint"
            className={`w-full px-3 py-2 ${touched && !valid ? "border-red-500 ring-1 ring-red-500" : ""}`}
            placeholder="Why does the access body disagree with the automated decision?"
          />
          <p id="ov-just-hint" className={`mt-1 text-xs ${touched && !valid ? "text-red-800" : "text-slate-600"}`}>
            Required, at least 10 characters ({justification.trim().length}/10). Logged in the audit trail.
          </p>
        </div>
        {m.isError && <ErrorBox title="Override failed" error={m.error} />}
      </div>
    </Modal>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpen, Braces, Copy, Database, ExternalLink, FileText, Plus, Send, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, type DataRequest, type IntakeMode, type RequestedAs } from "../../api";
import { useMeta } from "../../components/ArticleChips";
import { Modal } from "../../components/Modal";
import { headerHeight } from "../../lib/layout";
import { Tabs } from "../../components/Tabs";
import { Button, Card, ErrorBox, HelpChip, PageHeader, Spinner, focusRing } from "../../components/ui";

// ---------- form model ----------
type FieldKey = "name" | "organisation" | "country" | "requested_as" | "purpose" | "question" | "definitions";

interface FormState {
  name: string;
  organisation: string;
  country: string;
  requested_as: RequestedAs;
  purpose: string;
  question: string;
  definitions: string[];
}

const EMPTY: FormState = {
  name: "",
  organisation: "",
  country: "AT",
  requested_as: "health data request",
  purpose: "",
  question: "",
  definitions: [""],
};

const FIELDS: FieldKey[] = ["name", "organisation", "country", "requested_as", "purpose", "question", "definitions"];

const FIELD_LABEL: Record<FieldKey, string> = {
  name: "Applicant name",
  organisation: "Organisation",
  country: "Country",
  requested_as: "Request type",
  purpose: "Purpose",
  question: "Question",
  definitions: "Definitions",
};

/** The 27 EU member states (ISO 3166-1 alpha-2, as the backend maps country names). */
const EU_COUNTRIES: [string, string][] = [
  ["AT", "Austria"], ["BE", "Belgium"], ["BG", "Bulgaria"], ["HR", "Croatia"], ["CY", "Cyprus"], ["CZ", "Czechia"],
  ["DK", "Denmark"], ["EE", "Estonia"], ["FI", "Finland"], ["FR", "France"], ["DE", "Germany"], ["GR", "Greece"],
  ["HU", "Hungary"], ["IE", "Ireland"], ["IT", "Italy"], ["LV", "Latvia"], ["LT", "Lithuania"], ["LU", "Luxembourg"],
  ["MT", "Malta"], ["NL", "Netherlands"], ["PL", "Poland"], ["PT", "Portugal"], ["RO", "Romania"], ["SK", "Slovakia"],
  ["SI", "Slovenia"], ["ES", "Spain"], ["SE", "Sweden"],
];

/** Minimum free-text length before "Convert to form" is enabled. */
const FREEFORM_MIN = 20;
/** How long changed fields stay highlighted after the form is filled automatically. */
const FLASH_MS = 2200; // + 300 ms fade-out (FIELD_TRANSITION) = gone after 2.5 s

const formatFor = (t: RequestedAs) => (t === "health data access application" ? "pseudonymised records" : "anonymised statistics");
const isRecords = (r: { requested_as: string }) => r.requested_as === "health data access application";

function toRequest(f: FormState, reference: string | null): DataRequest {
  return {
    ...(reference ? { id: reference } : {}),
    applicant: { name: f.name.trim(), organisation: f.organisation.trim(), country: f.country.trim().toUpperCase() },
    requested_as: f.requested_as,
    requested_format: formatFor(f.requested_as),
    purpose: f.purpose.trim(),
    question: f.question.trim(),
    definitions: f.definitions.map((d) => d.trim()).filter(Boolean),
  };
}

/** Map a request payload (example, prefill) onto the form. An example's id travels separately as a hidden reference. */
function fromRequest(r: Partial<DataRequest>): FormState {
  const a: Partial<DataRequest["applicant"]> = r.applicant ?? {};
  const defs = Array.isArray(r.definitions) ? r.definitions.filter((d): d is string => typeof d === "string") : [];
  return {
    name: a.name ?? "",
    organisation: a.organisation ?? "",
    country: (a.country ?? "").toUpperCase().slice(0, 2),
    requested_as: r.requested_as === "health data access application" ? "health data access application" : "health data request",
    purpose: r.purpose ?? "",
    question: r.question ?? "",
    definitions: defs.length ? defs : [""],
  };
}

/** Anything typed by the applicant (the preselected country does not count). */
function hasContent(f: FormState): boolean {
  return [f.name, f.organisation, f.purpose, f.question, ...f.definitions].some((v) => v.trim() !== "");
}

function validate(f: FormState): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  if (!f.name.trim()) e.name = "Please enter the applicant's name.";
  if (!f.organisation.trim()) e.organisation = "Please enter the organisation.";
  if (!/^[A-Za-z]{2}$/.test(f.country.trim())) e.country = "Please choose a country.";
  if (!f.purpose.trim()) e.purpose = "Please describe the purpose.";
  if (!f.question.trim()) e.question = "Please state the question the data should answer.";
  if (!f.definitions.some((d) => d.trim())) e.definitions = "Add at least one definition.";
  return e;
}

type InputTab = "freeform" | "examples";
type FormView = "form" | "json";

// ---------- page ----------
export function ApplyPage() {
  const meta = useMeta();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState<InputTab>("freeform");
  const [view, setView] = useState<FormView>("form");
  const [form, setForm] = useState<FormState>(EMPTY);
  // which input method produced the current form content (sent as intake_mode)
  const [source, setSource] = useState<IntakeMode>("form");
  const [missing, setMissing] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [flash, setFlash] = useState<Set<FieldKey>>(new Set());
  const [pendingExample, setPendingExample] = useState<DataRequest | null>(null);
  // an applied example keeps its id (e.g. R08) as the request reference; not shown, but staff see it in the inbox
  const [reference, setReference] = useState<string | null>(null);
  const flashTimer = useRef<number>();
  // bumped on every apply, so an open JSON view reloads the new request (and lights up like the form)
  const [applied, setApplied] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  const errors = useMemo(() => validate(form), [form]);
  const legalLink = articleLink(meta.data?.eurlex, form.requested_as);
  const hasErrors = Object.keys(errors).length > 0;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** Replace the whole form and highlight the fields whose value changed. */
  const apply = (next: FormState, mode: IntakeMode, missingFields: string[] = [], ref: string | null = null) => {
    setReference(ref);
    setFlash(new Set(FIELDS.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(next[k]))));
    setForm(next);
    setApplied((n) => n + 1);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
    setSource(mode);
    setMissing(missingFields);
    setShowErrors(false);
    // scroll back up if the form's top is hidden behind the fixed header
    const top = formRef.current?.getBoundingClientRect().top ?? 0;
    if (top < headerHeight() + 8) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // Prefill from router state ({prefill: <request payload>}), e.g. "Start new request with data".
  useEffect(() => {
    const prefill = (location.state as { prefill?: Partial<DataRequest> } | null)?.prefill;
    if (prefill) {
      apply(fromRequest(prefill), "form");
      navigate(location.pathname, { replace: true, state: null }); // do not prefill again on reload
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickExample = (r: DataRequest) => {
    if (hasContent(form)) setPendingExample(r);
    else apply(fromRequest(r), "example", [], r.id ?? null);
  };

  const submit = useMutation({
    mutationFn: () => api.submit(toRequest(form, reference), source),
    onSuccess: (r) => navigate(`/requests/${r.run_id}`),
  });

  const onSubmit = () => {
    setShowErrors(true);
    if (hasErrors) {
      // after the re-render that marks the fields invalid
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    submit.mutate();
  };

  const err = (k: FieldKey) => (showErrors ? errors[k] : undefined);

  return (
    <div>
      <PageHeader
        title="Create a new EHDS request"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2 text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              Approval requirements
              <HelpChip
                label="Approval requirements"
                ordered
                items={[
                  "Prohibited purposes are rejected (Art. 54), e.g. insurance premiums, advertising or decisions against individuals.",
                  "Statistics requests receive anonymised statistics (Art. 53, 69).",
                  "Records applications that explain why statistics are not enough receive pseudonymised records in a secure processing environment (Art. 66, 68, 73).",
                  "Other records applications receive anonymised statistics instead (data minimisation, Art. 66).",
                ]}
              />
            </span>
            <span className="inline-flex items-center gap-1.5">
              Privacy
              <HelpChip
                label="Privacy"
                items={[
                  "Counts below 10 are shown as \u201c<10\u201d; percentages and means based on fewer than 10 patients are suppressed.",
                  "Patients who opted out are excluded everywhere.",
                  "Records in a secure processing environment cannot be downloaded.",
                ]}
              />
            </span>
          </span>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* ---------- the form (main) ---------- */}
        <div ref={formRef} className="min-w-0" style={{ scrollMarginTop: "calc(var(--header-h, 6rem) + 1rem)" }}>
          <Tabs<FormView>
            label="Request view"
            value={view}
            onChange={setView}
            tabs={[
              { id: "form", label: <><FileText className="h-4 w-4" aria-hidden />Form</> },
              { id: "json", label: <><Braces className="h-4 w-4" aria-hidden />JSON</> },
            ]}
          >
            {view === "json" ? (
              <JsonEditor
                key={applied}
                initial={JSON.stringify(toRequest(form, reference), null, 2)}
                flash={flash.size > 0}
                onApply={(r) => {
                  apply(fromRequest(r), "json", [], typeof r.id === "string" ? r.id : null);
                  setView("form");
                }}
              />
            ) : (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  onSubmit();
                }}
                className="space-y-6"
              >
                <Card>
                  <div className="divide-y divide-slate-200">
                    <FormSection n={1} title="What do you need?" first>
                      <RequestTypeCards value={form.requested_as} flash={flash.has("requested_as")} onChange={(v) => update("requested_as", v)} />
                    </FormSection>

                    <FormSection n={2} title="Purpose and question" last>
                      <div className="space-y-5">
                        <TextArea
                          id="purpose"
                          label={FIELD_LABEL.purpose}
                          hint="Intended use of the data, purpose it serves and the expected benefit"
                          hintLink={legalLink}
                          placeholder="E.g. We study regional differences in type 2 diabetes to plan a prevention programme with the regional health authorities."
                          flash={flash.has("purpose")}
                          error={err("purpose")}
                          value={form.purpose}
                          onChange={(v) => update("purpose", v)}
                          rows={4}
                        />
                        <TextArea
                          id="question"
                          label={FIELD_LABEL.question}
                          hint="Statistical content you need, what should be counted or measured, and for which groups"
                          hintLink={legalLink}
                          placeholder="E.g. How many adults have type 2 diabetes in each region and what is the prevalence?"
                          flash={flash.has("question")}
                          error={err("question")}
                          value={form.question}
                          onChange={(v) => update("question", v)}
                          rows={2}
                        />
                        <DefinitionsEditor value={form.definitions} flash={flash.has("definitions")} error={err("definitions")} onChange={(v) => update("definitions", v)} hintLink={legalLink} />
                      </div>
                    </FormSection>
                  </div>
                </Card>

                <Card>
                  <FormSection n={3} title="Applicant" first last>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_13rem]">
                      <TextField id="name" label={FIELD_LABEL.name} flash={flash.has("name")} error={err("name")} value={form.name} onChange={(v) => update("name", v)} autoComplete="name" />
                      <TextField
                        id="organisation"
                        label={FIELD_LABEL.organisation}
                        flash={flash.has("organisation")}
                        error={err("organisation")}
                        value={form.organisation}
                        onChange={(v) => update("organisation", v)}
                        autoComplete="organization"
                      />
                      <CountrySelect value={form.country} flash={flash.has("country")} error={err("country")} onChange={(v) => update("country", v)} />
                    </div>
                  </FormSection>
                </Card>

                {submit.isError && <ErrorBox title="The request could not be submitted" error={submit.error instanceof ApiError ? submit.error.message : submit.error} />}
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" loading={submit.isPending}>
                    <Send className="h-4 w-4" aria-hidden />
                    Submit request
                  </Button>
                </div>
              </form>
            )}
          </Tabs>
        </div>

        {/* ---------- input helpers (sidebar) ---------- */}
        <aside className="sidebar-sticky min-w-0" aria-label="Fill the form automatically">
          <Card className="flex min-h-0 flex-col" bodyClassName="flex min-h-0 flex-col px-4 pb-4">
            <Tabs<InputTab>
              label="Fill the form automatically"
              value={tab}
              onChange={setTab}
              className="flex min-h-0 flex-col"
              panelClassName="-mx-1 min-h-0 overflow-y-auto px-1 pb-1"
              tabs={[
                { id: "freeform", label: <><Sparkles className="h-4 w-4" aria-hidden />Describe in your words</> },
                { id: "examples", label: <><BookOpen className="h-4 w-4" aria-hidden />Examples</> },
              ]}
            >
              {tab === "freeform" && (
                <FreeformPanel
                  missingHint={missingSentence(missing, form.requested_as)}
                  onDismissHint={() => setMissing([])}
                  onConverted={(res) => {
                    const f = res.form;
                    // the applicant section is not extracted from free text: keep what the applicant entered
                    apply(
                      {
                        ...form,
                        requested_as: f.requested_as,
                        purpose: f.purpose,
                        question: f.question,
                        definitions: f.definitions.length ? f.definitions : [""],
                      },
                      "freeform",
                      res.missing,
                    );
                  }}
                />
              )}
              {tab === "examples" && <ExamplesPanel onPick={pickExample} />}
            </Tabs>
          </Card>
        </aside>
      </div>

      <Modal
        open={!!pendingExample}
        onClose={() => setPendingExample(null)}
        title="Replace the current form?"
        footer={
          <>
            <Button onClick={() => setPendingExample(null)}>Cancel</Button>
            <Button
              variant="primary"
              data-autofocus
              onClick={() => {
                if (pendingExample) apply(fromRequest(pendingExample), "example", [], pendingExample.id ?? null);
                setPendingExample(null);
              }}
            >
              Replace form
            </Button>
          </>
        }
      >
        <p>The form already contains your entries. Applying this example replaces all of them.</p>
      </Modal>
    </div>
  );
}

// ---------- sidebar panels ----------
/** One sentence naming what a free-text fill could not find, e.g. "Your text does not say why you need the data or …". */
function missingSentence(missing: string[], requestedAs: RequestedAs): string | null {
  const phrase: Record<string, string> = {
    purpose: "why you need the data and its expected benefit",
    question: requestedAs === "health data access application" ? "what the records should answer" : "what the statistics should show",
    definitions: "which data you need and what to report",
  };
  const parts = missing.map((m) => phrase[m]).filter(Boolean);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
  return `Your text does not say ${list}; add it and fill the form again.`;
}

function FreeformPanel({ onConverted, missingHint, onDismissHint }: {
  onConverted: (r: Awaited<ReturnType<typeof api.freeform>>) => void;
  missingHint: string | null;
  onDismissHint: () => void;
}) {
  const [text, setText] = useState("");
  const m = useMutation({ mutationFn: () => api.freeform(text), onSuccess: onConverted });
  const len = text.trim().length;
  return (
    <div className="space-y-3">
      <label htmlFor="freeform" className="block text-sm text-slate-700">
        Describe what you want to find out and why. We fill in the request type, purpose, question and definitions; your applicant details stay as they are.
      </label>
      {missingHint && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          <p className="min-w-0 flex-1">{missingHint}</p>
          <button type="button" onClick={onDismissHint} aria-label="Dismiss hint" className={`flex-none rounded p-0.5 text-amber-950 hover:bg-amber-100 ${focusRing}`}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      <textarea
        id="freeform"
        rows={9}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full p-3"
        placeholder="E.g. We want to know how many patients over 65 with atrial fibrillation are not on anticoagulants, per age group, to improve stroke prevention."
        aria-describedby="freeform-count"
      />
      <div className="flex items-center justify-between gap-3">
        <Button variant="primary" onClick={() => m.mutate()} loading={m.isPending} disabled={len < FREEFORM_MIN}>
          {m.isPending ? "Filling the request…" : "Fill request from description"}
        </Button>
        <span id="freeform-count" className={`font-mono text-xs tabular-nums text-slate-600`} aria-label={`${len} of at least ${FREEFORM_MIN} characters`}>
          {len}/{FREEFORM_MIN}
        </span>
      </div>
      {m.isError && <ErrorBox title="Could not convert your text" error={m.error} />}
    </div>
  );
}

/** The request as raw JSON (same shape as the example requests); applying it replaces the form.
 * Validity is checked on every keystroke: "Apply to form" stays disabled until the text is one JSON object. */
function JsonEditor({ initial, flash, onApply }: { initial: string; flash: boolean; onApply: (r: Partial<DataRequest>) => void }) {
  const [text, setText] = useState(initial);
  const parsed = useMemo(() => {
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<DataRequest>) : null;
    } catch {
      return null;
    }
  }, [text]);

  return (
    <Card>
      <div className="space-y-3">
        <label htmlFor="request-json" className="sr-only">
          Request as JSON
        </label>
        <textarea
          id="request-json"
          rows={22}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={!parsed}
          className={`w-full p-3 font-mono text-xs leading-relaxed ${FIELD_TRANSITION} ${flash ? "border-green-600 bg-green-50" : ""}`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button onClick={() => navigator.clipboard.writeText(text)}>
            <Copy className="h-4 w-4" aria-hidden />
            Copy
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={() => setText(initial)}
              disabled={text === initial}
            >
              Reset
            </Button>
            <Button variant="primary" onClick={() => parsed && onApply(parsed)} disabled={!parsed}>
              Apply to form
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ExamplesPanel({ onPick }: { onPick: (r: DataRequest) => void }) {
  const q = useQuery({ queryKey: ["samples"], queryFn: api.samples, staleTime: Infinity });
  if (q.isLoading) return <Spinner label="Loading examples…" />;
  if (q.isError) return <ErrorBox title="Could not load examples" error={q.error} />;
  const all = q.data ?? [];
  const ordered = [...all.filter((r) => !isRecords(r)), ...all.filter(isRecords)];
  return (
    <ul className="space-y-2">
      {ordered.map((r, i) => (
        <li key={r.id ?? i}>
          <ExampleCard r={r} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The whole card is the button: clicking applies the example. Content follows the form order
 * (request type, purpose, question, definitions, applicant). Spans keep the button content valid HTML.
 */
function ExampleCard({ r, onPick }: { r: DataRequest; onPick: (r: DataRequest) => void }) {
  const records = isRecords(r);
  const TypeIcon = records ? Database : BarChart3;
  return (
    <button
      type="button"
      onClick={() => onPick(r)}
      className={`block w-full rounded-lg border border-slate-200 bg-white p-3 text-left text-xs text-slate-700 transition-colors hover:border-brand-600 hover:bg-brand-50 ${focusRing}`}
    >
      <span className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold text-slate-500">{r.id}</span>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
          <TypeIcon className="h-3 w-3 flex-none text-brand-700" aria-hidden />
          {records ? "Records" : "Statistics"}
        </span>
      </span>
      <span className="mt-2 block">
        <span className="font-semibold text-slate-800">Purpose: </span>
        {r.purpose}
      </span>
      <span className="mt-3 block">
        <span className="font-semibold text-slate-800">Question: </span>
        {r.question}
      </span>
      <span className="mt-3 block font-semibold text-slate-800">Definitions:</span>
      {r.definitions.map((d, i) => (
        <span key={i} className={`block ${i === 0 ? "mt-1" : "mt-3"}`}>
          {i + 1}.{" "}
          {d}
        </span>
      ))}
      <span className="mt-3 block text-slate-500">
        <span className="block">Name: {r.applicant.name}</span>
        <span className="block">Organisation: {r.applicant.organisation}</span>
        <span className="block">Country: {r.applicant.country}</span>
      </span>
    </button>
  );
}

// ---------- form pieces ----------
/** One numbered section of the form; sections are separated by dividers. */
function FormSection({ n, title, first = false, last = false, children }: { n: number; title: string; first?: boolean; last?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${first ? "" : "pt-6"} ${last ? "" : "pb-6"}`}>
      <h2 id={id} className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800 ring-1 ring-inset ring-brand-100" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** EU member state dropdown; a code outside the list (e.g. from a conversion) is kept as an extra option. */
function CountrySelect({ value, onChange, flash, error }: { value: string; onChange: (v: string) => void; flash?: boolean; error?: string }) {
  const known = EU_COUNTRIES.some(([c]) => c === value);
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor="country" label={FIELD_LABEL.country} />
      <select
        id="country"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy("country", undefined, error)}
        required
        className={`w-full px-3 py-2 ${FIELD_TRANSITION} ${flashClass(flash, error)}`}
      >
        {!value && (
          <option value="" disabled>
            Choose a country…
          </option>
        )}
        {value && !known && <option value={value}>{value} (other)</option>}
        {EU_COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>
            {name} ({code})
          </option>
        ))}
      </select>
      <FieldError id="country" error={error} />
    </div>
  );
}
/** Green highlight that fades out (via transition) when the flash ends. */
const FIELD_TRANSITION = "transition-[background-color,border-color,box-shadow] duration-300";
function flashClass(flash?: boolean, error?: string) {
  if (error) return "border-red-500 ring-1 ring-red-500";
  return flash ? "border-green-600 bg-green-50" : "";
}

interface HintLink {
  href: string;
  label: string;
}

const EURLEX_FALLBACK = "https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng";

/** The article of Regulation (EU) 2025/327 that lists what this request type must contain. */
function articleLink(eurlex: string | undefined, type: RequestedAs): HintLink {
  const art = type === "health data access application" ? "67" : "69";
  return { href: `${eurlex ?? EURLEX_FALLBACK}#art_${art}`, label: `Art. ${art} of Regulation (EU) 2025/327 on EUR-Lex (opens in a new tab)` };
}

/** Helper text, right-aligned on the label row, ending in a link to the legal source. */
function Hint({ id, text, link }: { id: string; text: string; link?: HintLink }) {
  return (
    <span id={id} className="ml-auto inline-flex items-baseline gap-1 text-right text-xs font-normal text-slate-600">
      {text}
      {link && (
        <a href={link.href} target="_blank" rel="noreferrer" title={link.label} aria-label={link.label}
           className={`self-center rounded text-brand-700 hover:text-brand-900 ${focusRing}`}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </span>
  );
}

function FieldLabel({ htmlFor, label, hint, hintLink, required = true }: { htmlFor: string; label: string; hint?: string; hintLink?: HintLink; required?: boolean }) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-4">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
        {label}
        {required && <span className="text-red-700" aria-hidden> *</span>}
      </label>
      {hint && <Hint id={`${htmlFor}-hint`} text={hint} link={hintLink} />}
    </div>
  );
}

/** The highlighted field is the visible cue; the message stays for screen readers (aria-describedby). */
function FieldError({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={`${id}-err`} className="sr-only">
      {error}
    </p>
  ) : null;
}

function describedBy(id: string, hint?: string, error?: string) {
  return [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
}

function TextField({ id, label, value, onChange, flash, error, hint, className = "", ...rest }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  flash?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  maxLength?: number;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} hint={hint} />
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, hint, error)}
        required
        className={`w-full px-3 py-2 ${FIELD_TRANSITION} ${flashClass(flash, error)} ${className}`}
        {...rest}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

function TextArea({ id, label, value, onChange, flash, error, hint, hintLink, placeholder, rows = 3 }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  flash?: boolean;
  error?: string;
  hint?: string;
  hintLink?: HintLink;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} label={label} hint={hint} hintLink={hintLink} />
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, hint, error)}
        required
        className={`w-full px-3 py-2 ${FIELD_TRANSITION} ${flashClass(flash, error)}`}
      />
      <FieldError id={id} error={error} />
    </div>
  );
}

function RequestTypeCards({ value, onChange, flash }: { value: RequestedAs; onChange: (v: RequestedAs) => void; flash?: boolean }) {
  const options: { v: RequestedAs; title: string; text: string }[] = [
    { v: "health data request", title: "Statistics", text: "Aggregated statistics (prevalence, count, percentage, mean)." },
    { v: "health data access application", title: "Records (pseudonymised)", text: "Individual records inside a secure processing environment (SPE)." },
  ];
  return (
    <fieldset>
      <legend className="sr-only">What do you need?</legend>
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((o) => {
          const checked = value === o.v;
          const lit = flash && checked;
          return (
            <label
              key={o.v}
              className={`relative flex cursor-pointer gap-3 rounded-lg border p-3 ${FIELD_TRANSITION} has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600 has-[:focus-visible]:ring-offset-2 ${
                lit
                  ? "border-green-600 bg-green-50 ring-1 ring-green-600"
                  : checked
                    ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600"
                    : "border-slate-300 bg-white hover:border-slate-400"
              }`}
            >
              <input type="radio" name="requested_as" value={o.v} checked={checked} onChange={() => onChange(o.v)} className="mt-1 h-4 w-4 flex-none" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{o.title}</span>
                <span className="mt-0.5 block text-sm text-slate-700">{o.text}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DefinitionsEditor({ value, onChange, flash, error, hintLink }: { value: string[]; onChange: (v: string[]) => void; flash?: boolean; error?: string; hintLink?: HintLink }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  useEffect(() => {
    if (focusIdx !== null) {
      refs.current[focusIdx]?.focus();
      setFocusIdx(null);
    }
  }, [focusIdx, value.length]);

  return (
    <fieldset aria-describedby="definitions-hint">
      <legend className="mb-2 flex w-full flex-wrap items-baseline gap-x-4">
        <span className="text-sm font-semibold text-slate-900">
          Definitions <span className="text-red-700" aria-hidden>*</span>
        </span>
        <Hint id="definitions-hint" text="Definitions (description, scope and time range) of the requested data entities" link={hintLink} />
      </legend>
      <ol className="space-y-2">
        {value.map((d, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex min-w-0 flex-1">
              <span
                aria-hidden
                className={`flex w-10 flex-none items-center justify-center rounded-l-md border border-r-0 bg-slate-100 text-xs tabular-nums text-slate-600 ${FIELD_TRANSITION} ${
                  error && i === 0 ? "border-red-500" : flash ? "border-green-600" : "border-slate-300"
                }`}
              >
                {i + 1}.
              </span>
              <input
                ref={(el) => (refs.current[i] = el)}
                value={d}
                aria-label={`Definition ${i + 1}`}
                aria-invalid={!!error && i === 0}
                aria-describedby={error && i === 0 ? "definitions-err" : undefined}
                placeholder={i === 0 ? "E.g. Adult = aged 18 or older on 31 December 2025." : "E.g. Report per region: adults, adults with type 2 diabetes and the prevalence."}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onChange([...value.slice(0, i + 1), "", ...value.slice(i + 1)]);
                    setFocusIdx(i + 1);
                  }
                }}
                className={`min-w-0 flex-1 rounded-none px-3 py-1.5 ${FIELD_TRANSITION} ${flashClass(flash, error && i === 0 ? error : undefined)}`}
              />
              <button
                type="button"
                onClick={() => onChange(value.length > 1 ? value.filter((_, j) => j !== i) : [""])}
                className={`flex w-10 flex-none items-center justify-center rounded-r-md border border-l-0 bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-red-700 ${FIELD_TRANSITION} ${
                  error && i === 0 ? "border-red-500" : flash ? "border-green-600" : "border-slate-300"
                } ${focusRing}`}
                aria-label={`Remove definition ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-2">
        <Button
          size="sm"
          onClick={() => {
            onChange([...value, ""]);
            setFocusIdx(value.length);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add definition
        </Button>
      </div>
      <FieldError id="definitions" error={error} />
    </fieldset>
  );
}

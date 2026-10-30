// Training page of the secure processing environment: statistics, fit and run a model.
// No endpoint returns records; everything shown here is an aggregate or a model output.

const $ = (id) => document.getElementById(id);
let variables = [];
let models = [];
let modelId = null; // the fitted model this page runs and downloads

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`);
  return data;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

const TABLE_LABEL = { patients: "Patients", conditions: "Conditions", medications: "Medications", observations: "Observations", encounters: "Encounters" };
const COLUMN_LABEL = {
  sex: "Sex", birth_date: "Birth date", region: "Region", data_holder: "Hospital", icd10: "ICD-10 code",
  description: "Diagnosis", onset_date: "Onset date", atc: "ATC code", name: "Name", start_date: "Start date",
  end_date: "End date", loinc: "LOINC code", value: "Value", unit: "Unit", date: "Date", type: "Type",
  primary_icd10: "Main diagnosis",
};
const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : n);

/** A table with a grey header row; cells are text or nodes, `numeric` columns right-aligned. */
function table(headers, rows, numeric = [], extraClass = "") {
  const cls = (i) => (numeric.includes(i) ? { class: "num" } : {});
  return el("div", { class: "table-wrap" }, el("table", { class: `data ${extraClass}` },
    el("thead", {}, el("tr", {}, ...headers.map((h, i) => el("th", { scope: "col", ...cls(i) }, h)))),
    el("tbody", {}, ...rows.map((r) => el("tr", {}, ...r.map((v, i) => el("td", cls(i), v))))),
  ));
}

const chip = (label, n) => el("span", { class: "chip" }, label, ...(n === undefined ? [] : [el("span", { class: "n" }, fmt(n))]));

/** Summary of one column: chips for categories (value and count) and numbers, plain text for dates. */
function summary(c) {
  if (c.kind === "numeric") return el("div", { class: "chips" }, chip("Mean", c.mean), chip("SD", c.std));
  if (c.kind === "date") return c.years;
  if (c.kind === "categories") {
    const rest = c.other ? [el("span", { class: "muted" }, `+${fmt(c.other)} in groups under 10`)] : [];
    return el("div", { class: "chips" }, ...c.top.map((t) => chip(t.value, t.count)), ...rest);
  }
  return el("span", { class: "muted" }, "Fewer than 10 values");
}

async function loadStatistics() {
  const stats = await api("/api/statistics");
  $("stats").replaceChildren(...stats.map((t) => el("div", { class: "stat-block" },
    el("div", { class: "stat-head" }, el("h3", {}, TABLE_LABEL[t.table] ?? t.table), el("span", { class: "pill" }, `${fmt(t.rows)} rows`)),
    t.columns.length
      ? table(["Column", "Values", "Missing", "Summary"], t.columns.map((c) => [
        el("span", {}, el("span", { class: "col-label" }, COLUMN_LABEL[c.column] ?? c.column), el("span", { class: "col-key" }, c.column)),
        fmt(c.count ?? "<10"), `${c.missing_pct}%`, summary(c),
      ]), [1, 2], "stats")
      : el("p", { class: "muted" }, "Not shown: fewer than 10 rows."),
  )));
}

function fillTargets() {
  const kind = models.find((m) => m.key === $("model").value)?.target;
  $("y").replaceChildren(...variables.filter((v) => v.kind === kind).map((v) => el("option", { value: v.key }, v.label)));
  lockTarget();
}

/** The chosen target cannot also be an input: grey it out and untick it in the input list. */
function lockTarget() {
  for (const box of $("x").querySelectorAll("input")) {
    const isTarget = box.value === $("y").value;
    if (isTarget) box.checked = false;
    box.disabled = isTarget;
    box.parentElement.title = isTarget ? "Chosen as target (y)" : "";
  }
}

async function loadVariables() {
  ({ variables, models } = await api("/api/variables"));
  $("model").replaceChildren(...models.map((m) => el("option", { value: m.key }, m.label)));
  $("x").replaceChildren(...variables.map((v) =>
    el("label", {}, el("input", { type: "checkbox", value: v.key }), v.label)));
  fillTargets();
}

function enableRun(fit) {
  $("run-section").hidden = false;
  $("download-section").hidden = false;
  $("run-inputs").replaceChildren(...fit.x.map((key) => {
    const v = variables.find((x) => x.key === key);
    const input = v.kind === "binary"
      ? el("select", { name: key }, el("option", { value: "0" }, "No"), el("option", { value: "1" }, "Yes"))
      : el("input", { type: "number", step: "any", name: key, required: "" });
    return el("label", { title: v.label }, el("span", { class: "run-label" }, v.label), input);
  }));
  $("run-out").replaceChildren();
  $("runs-left").textContent = `${fit.runs_left} runs left`;
  checkRunInputs();
}

/** "Run model" only once every number field holds a number. */
function checkRunInputs() {
  const fields = [...$("run-inputs").querySelectorAll("input")];
  $("run-btn").disabled = !fields.every((i) => i.value !== "" && i.checkValidity());
}
$("run-inputs").addEventListener("input", checkRunInputs);

$("model").addEventListener("change", fillTargets);
$("y").addEventListener("change", lockTarget);

$("fit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const x = [...$("x").querySelectorAll("input:checked")].map((i) => i.value);
  const out = $("fit-out");
  $("fit-btn").disabled = true;
  out.replaceChildren(el("p", { class: "muted" }, "Fitting…"));
  try {
    const r = await api("/api/fit", { model: $("model").value, x, y: $("y").value });
    modelId = r.model_id;
    const METRIC = { accuracy: "Accuracy", auroc: "AUROC", r2: "R²", mae: "MAE" };
    const parts = r.weights ?? r.importance;
    const file = (fmt) => `/api/model.${fmt}?model_id=${encodeURIComponent(modelId)}`;
    out.replaceChildren();
    $("model-summary").replaceChildren(
      el("div", { class: "chips" },
        chip(r.model), chip("Trained on", r.n_train), chip("Tested on", r.n_test),
        ...Object.entries(r.metrics).map(([k, v]) => chip(METRIC[k] ?? k, v))),
      table(["Variable", r.weights ? "Weight" : "Importance"],
        Object.entries(parts).map(([k, v]) => [variables.find((x) => x.key === k)?.label ?? k, v]), [1]),
    );
    $("downloads").replaceChildren(
      el("a", { class: "button secondary", href: file("joblib"), download: "" }, "Download fitted model as .joblib"),
      el("a", { class: "button secondary", href: file("pickle"), download: "" }, "Download fitted model as .pickle"),
    );
    enableRun(r);
  } catch (err) {
    out.replaceChildren(el("p", { class: "error" }, err.message));
  } finally {
    $("fit-btn").disabled = false;
  }
});

$("run-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inputs = Object.fromEntries([...$("run-inputs").querySelectorAll("input, select")].map((i) => [i.name, Number(i.value)]));
  const out = $("run-out");
  try {
    const r = await api("/api/run", { model_id: modelId, inputs });
    const item = (label, value) => el("div", {}, el("span", { class: "result-label" }, label), el("span", { class: "result-value" }, value));
    // yes/no targets come with a probability: the model's chance that the answer is Yes
    const yesNo = r.probability !== undefined;
    out.replaceChildren(el("div", { class: "result-card" },
      item("Prediction", yesNo ? (r.prediction ? "Yes" : "No") : r.prediction),
      ...(yesNo ? [item("Probability (Yes)", r.probability)] : [])));
    $("runs-left").textContent = `${r.runs_left} runs left`;
  } catch (err) {
    out.replaceChildren(el("p", { class: "error" }, err.message));
  }
});

(async () => {
  try {
    const s = await api("/api/session");
    // e.g. "Permit P-D5765E23 (valid until 30.10.2027)"
    const until = new Date(s.valid_until).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    $("permit").textContent = `Permit ${s.permit_id} (valid until ${until})`;
    await Promise.all([loadStatistics(), loadVariables()]);
  } catch (err) {
    document.querySelector(".page").prepend(el("p", { class: "error" }, err.message));
  }
})();

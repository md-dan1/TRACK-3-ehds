"""What the SPE shows and computes on the copied records, without ever returning a record.

- statistics: per table and column, only for groups of at least 10 (no min/max: those are real values)
- features: one row per cohort patient, derived only from the record types that were copied
- models: three scikit-learn models, restricted so a fitted model cannot give back training rows
- export: the fitted model as a pickle or joblib file (weights only, no training rows)
"""

from __future__ import annotations

import datetime as dt
import io
import math
import pickle
from dataclasses import dataclass, field

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

SMALL = 10           # smallest group shown in statistics, smallest class a model may learn
MIN_PATIENTS = 50    # smallest training set
MAX_FEATURES = 10
MAX_CODES = 15       # flags per code system (most frequent codes first)
PREDICTIONS_PER_MODEL = 100
REFERENCE_DATE = dt.date(2025, 12, 31)  # age and "active" are measured on this day, as in the requests

# Tables as columns + rows; values are str, float, datetime.date or None.
Table = dict  # {"columns": [...], "rows": [[...], ...]}


class AnalysisError(ValueError):
    """A request the SPE refuses; the message is shown to the researcher."""


# ---------- statistics ----------

def statistics(tables: dict[str, Table]) -> list[dict]:
    """Per table: row count and per-column summaries, each only where at least 10 values back it."""
    out = []
    for name, t in tables.items():
        n = len(t["rows"])
        entry = {"table": name, "rows": n if n >= SMALL else "<10", "columns": []}
        if n >= SMALL:
            for i, col in enumerate(t["columns"]):
                if col == "patient_id" or col.endswith("_id"):
                    continue
                values = [r[i] for r in t["rows"] if r[i] is not None]
                entry["columns"].append(_summary(col, values, n))
        out.append(entry)
    return out


def _summary(col: str, values: list, n: int) -> dict:
    s = {"column": col, "missing_pct": round(100 * (n - len(values)) / n, 1)}
    if len(values) < SMALL:
        return {**s, "kind": "too few values"}
    if all(isinstance(v, (int, float)) for v in values):
        a = np.array(values, dtype=float)
        return {**s, "kind": "numeric", "count": len(a), "mean": round(float(a.mean()), 2), "std": round(float(a.std()), 2)}
    if all(isinstance(v, dt.date) for v in values):
        years = sorted({v.year for v in values})
        return {**s, "kind": "date", "count": len(values), "years": f"{years[0]} to {years[-1]}" if len(years) > 1 else str(years[0])}
    counts: dict[str, int] = {}
    for v in values:
        counts[str(v)] = counts.get(str(v), 0) + 1
    shown = sorted(((k, c) for k, c in counts.items() if c >= SMALL), key=lambda kc: -kc[1])[:8]
    return {**s, "kind": "categories", "count": len(values), "top": [{"value": k, "count": c} for k, c in shown],
            "other": len(values) - sum(c for _, c in shown)}


# ---------- features ----------

@dataclass
class Feature:
    key: str
    label: str
    kind: str  # "binary" or "numeric"
    values: dict[str, float] = field(repr=False)  # patient_id -> value; absent = missing


def features(cohort: list[str], tables: dict[str, Table]) -> list[Feature]:
    """One value per cohort patient, from the copied record types only. A feature is offered when
    at least 10 patients have a value and, for yes/no features, each answer has at least 10."""
    ids = set(cohort)
    feats: list[Feature] = []

    def rows(table: str):
        t = tables.get(table)
        if not t:
            return
        idx = {c: i for i, c in enumerate(t["columns"])}
        for r in t["rows"]:
            if r[idx["patient_id"]] in ids:
                yield {c: r[i] for c, i in idx.items()}

    def count(table: str, key: str, label: str, keep=lambda r: True) -> None:
        if table in tables:
            n = dict.fromkeys(ids, 0.0)
            for r in rows(table):
                if keep(r):
                    n[r["patient_id"]] += 1
            feats.append(Feature(key, label, "numeric", n))

    def flags(table: str, code_col: str, name_col: str, prefix: str, verb: str) -> None:
        if table not in tables:
            return
        holders: dict[str, set[str]] = {}
        names: dict[str, str] = {}
        for r in rows(table):
            code = r[code_col]
            holders.setdefault(code, set()).add(r["patient_id"])
            names.setdefault(code, r.get(name_col) or code)
        for code in sorted(holders, key=lambda c: -len(holders[c]))[:MAX_CODES]:
            feats.append(Feature(f"{prefix}_{code}", f"{verb} {code} ({names[code]})", "binary",
                                 {p: float(p in holders[code]) for p in ids}))

    if "patients" in tables:
        age, female = {}, {}
        for r in rows("patients"):
            if r["birth_date"]:
                b = r["birth_date"]
                age[r["patient_id"]] = float(REFERENCE_DATE.year - b.year - ((REFERENCE_DATE.month, REFERENCE_DATE.day) < (b.month, b.day)))
            if r["sex"]:
                female[r["patient_id"]] = float(r["sex"] == "female")
        feats += [Feature("age", "Age on 31 Dec 2025", "numeric", age), Feature("female", "Female", "binary", female)]
    count("conditions", "n_conditions", "Number of diagnoses")
    flags("conditions", "icd10", "description", "has", "Has")
    count("medications", "n_medications", "Number of prescriptions")
    flags("medications", "atc", "name", "takes", "Takes")
    if "observations" in tables:
        latest: dict[str, dict[str, tuple]] = {}
        names: dict[str, str] = {}
        for r in rows("observations"):
            if r["value"] is None:
                continue
            per = latest.setdefault(r["loinc"], {})
            prev = per.get(r["patient_id"])
            if prev is None or (r["date"] or dt.date.min) > prev[0]:
                per[r["patient_id"]] = (r["date"] or dt.date.min, float(r["value"]))
            names.setdefault(r["loinc"], f"{r.get('name') or r['loinc']}" + (f" [{r['unit']}]" if r.get("unit") else ""))
        for loinc, per in sorted(latest.items()):
            feats.append(Feature(f"latest_{loinc}", f"Latest {loinc}: {names[loinc]}", "numeric",
                                 {p: v for p, (_, v) in per.items()}))
    count("encounters", "n_encounters", "Number of encounters")
    count("encounters", "n_inpatient", "Number of inpatient stays", lambda r: r.get("type") == "inpatient")
    return [f for f in feats if _usable(f)]


def _usable(f: Feature) -> bool:
    if len(f.values) < SMALL:
        return False
    if f.kind == "binary":
        ones = sum(1 for v in f.values.values() if v == 1.0)
        return ones >= SMALL and len(f.values) - ones >= SMALL
    return True


# ---------- models ----------

MODELS = {
    "logistic_regression": {"label": "Logistic regression", "target": "binary",
                            "make": lambda: LogisticRegression(C=1.0, max_iter=1000)},
    "decision_tree": {"label": "Decision tree", "target": "binary",
                      "make": lambda: DecisionTreeClassifier(max_depth=3, min_samples_leaf=20, random_state=0)},
    "ridge_regression": {"label": "Ridge regression", "target": "numeric",
                         "make": lambda: Ridge(alpha=1.0)},
}


@dataclass
class Fitted:
    model_key: str
    x: list[str]
    y: str
    estimator: object
    predictions_left: int = PREDICTIONS_PER_MODEL


def fit(feats: list[Feature], model_key: str, x: list[str], y: str) -> tuple[Fitted, dict]:
    """Fit on complete cases with an 80/20 split; returns only aggregate results."""
    spec = MODELS.get(model_key)
    by_key = {f.key: f for f in feats}
    if spec is None:
        raise AnalysisError("Unknown model.")
    if not x or len(x) > MAX_FEATURES:
        raise AnalysisError(f"Choose 1 to {MAX_FEATURES} input variables.")
    if y in x:
        raise AnalysisError("The target cannot also be an input variable.")
    if any(k not in by_key for k in [*x, y]):
        raise AnalysisError("Unknown variable.")
    if by_key[y].kind != spec["target"]:
        need = "a yes/no" if spec["target"] == "binary" else "a numeric"
        raise AnalysisError(f"{spec['label']} needs {need} target.")
    patients = sorted(set.intersection(*(set(by_key[k].values) for k in [*x, y])))
    if len(patients) < MIN_PATIENTS:
        raise AnalysisError(f"Only {len(patients) if len(patients) >= SMALL else 'fewer than 10'} patients have all chosen "
                            f"variables; at least {MIN_PATIENTS} are needed.")
    X = np.array([[by_key[k].values[p] for k in x] for p in patients])
    Y = np.array([by_key[y].values[p] for p in patients])
    classify = spec["target"] == "binary"
    if classify and min(int(Y.sum()), len(Y) - int(Y.sum())) < SMALL:
        raise AnalysisError("Each answer of the target needs at least 10 patients.")
    X_tr, X_te, Y_tr, Y_te = train_test_split(X, Y, test_size=0.2, random_state=0, stratify=Y if classify else None)
    est = spec["make"]()
    est.fit(X_tr, Y_tr)
    result: dict = {"model": spec["label"], "x": x, "y": y, "n_train": len(Y_tr), "n_test": len(Y_te)}
    if classify:
        proba = est.predict_proba(X_te)[:, 1]
        result["metrics"] = {"accuracy": round(float(accuracy_score(Y_te, est.predict(X_te))), 3)}
        if len(set(Y_te)) == 2:
            result["metrics"]["auroc"] = round(float(roc_auc_score(Y_te, proba)), 3)
    else:
        pred = est.predict(X_te)
        result["metrics"] = {"r2": round(float(r2_score(Y_te, pred)), 3), "mae": round(float(mean_absolute_error(Y_te, pred)), 3)}
    if hasattr(est, "coef_"):
        coef = np.ravel(est.coef_)
        result["weights"] = {k: round(float(c), 3) for k, c in zip(x, coef, strict=True)}
    else:
        result["importance"] = {k: round(float(v), 3) for k, v in zip(x, est.feature_importances_, strict=True)}
    return Fitted(model_key, x, y, est), result


def predict(feats: list[Feature], fitted: Fitted, inputs: dict[str, float]) -> dict:
    """Run the fitted model on values the researcher types in; never on stored records."""
    if fitted.predictions_left <= 0:
        raise AnalysisError(f"This model has used its {PREDICTIONS_PER_MODEL} runs; fit it again.")
    kinds = {f.key: f.kind for f in feats}
    labels = {f.key: f.label for f in feats}
    row = []
    for k in fitted.x:
        v = inputs.get(k)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v):
            raise AnalysisError(f"Enter a number for {labels.get(k, k)}.")
        if kinds.get(k) == "binary" and v not in (0, 1):
            raise AnalysisError(f"{labels.get(k, k)}: choose No or Yes.")
        row.append(float(v))
    fitted.predictions_left -= 1
    est = fitted.estimator
    if MODELS[fitted.model_key]["target"] == "binary":
        p = float(est.predict_proba(np.array([row]))[0, 1])
        out = {"prediction": int(p >= 0.5), "probability": round(p, 3)}
    else:
        out = {"prediction": round(float(est.predict(np.array([row]))[0]), 3)}
    return {**out, "runs_left": fitted.predictions_left}


EXPORT_FORMATS = {"pickle": ".pickle", "joblib": ".joblib"}


def export(fitted: Fitted, fmt: str) -> bytes:
    """The fitted estimator with its input order and target; the estimators keep no training rows."""
    bundle = {"model": fitted.model_key, "x": fitted.x, "y": fitted.y, "estimator": fitted.estimator}
    if fmt == "pickle":
        return pickle.dumps(bundle)
    if fmt == "joblib":
        buf = io.BytesIO()
        joblib.dump(bundle, buf)
        return buf.getvalue()
    raise AnalysisError("Unknown export format.")

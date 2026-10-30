"""The SPE never hands out records: statistics hide small groups, models are restricted."""

import datetime as dt
import io
import pickle
import random

import joblib
import numpy as np
import pytest

from spe_service import analysis


def _tables(n: int = 200, seed: int = 0) -> tuple[list[str], dict]:
    rnd = random.Random(seed)
    ids = [f"p-{i:04d}" for i in range(n)]
    obs, meds, conds = [], [], []
    for i, p in enumerate(ids):
        diabetic = i % 2 == 0
        conds.append([p, "E11", "Type 2 diabetes", dt.date(2020, 1, 1)] if diabetic else [p, "I10", "Hypertension", dt.date(2021, 1, 1)])
        if diabetic or i % 5 == 0:
            meds.append([p, "A10BA02", "metformin", dt.date(2024, 1, 1), None])
        obs.append([p, "4548-4", "HbA1c", round(5.5 + (2.0 if diabetic else 0.0) + rnd.random(), 1), "%", dt.date(2025, 6, 1)])
    return ids, {
        "conditions": {"columns": ["patient_id", "icd10", "description", "onset_date"], "rows": conds},
        "medications": {"columns": ["patient_id", "atc", "name", "start_date", "end_date"], "rows": meds},
        "observations": {"columns": ["patient_id", "loinc", "name", "value", "unit", "date"], "rows": obs},
    }


def test_statistics_hide_small_groups_and_extremes():
    ids, tables = _tables(n=200)
    tables["encounters"] = {"columns": ["encounter_id", "patient_id", "data_holder", "type", "start_date", "end_date", "primary_icd10"],
                            "rows": [["e1", ids[0], "Klinikum Nord", "inpatient", None, None, "I21"]]}
    stats = {t["table"]: t for t in analysis.statistics(tables)}
    assert stats["encounters"]["rows"] == "<10" and stats["encounters"]["columns"] == []
    value = next(c for c in stats["observations"]["columns"] if c["column"] == "value")
    assert value["kind"] == "numeric" and "min" not in value and "max" not in value
    assert all("patient_id" != c["column"] for t in stats.values() for c in t["columns"])


def test_features_only_from_copied_tables():
    ids, tables = _tables()
    keys = {f.key for f in analysis.features(ids, tables)}
    assert {"has_E11", "takes_A10BA02", "latest_4548-4", "n_conditions"} <= keys
    assert "age" not in keys and "female" not in keys  # patients were not copied


def test_fit_refuses_small_cohorts_and_wrong_targets():
    ids, tables = _tables(n=40)
    feats = analysis.features(ids, tables)
    with pytest.raises(analysis.AnalysisError, match="at least 50"):
        analysis.fit(feats, "logistic_regression", ["latest_4548-4"], "has_E11")
    ids, tables = _tables()
    feats = analysis.features(ids, tables)
    with pytest.raises(analysis.AnalysisError, match="yes/no target"):
        analysis.fit(feats, "decision_tree", ["has_E11"], "latest_4548-4")
    with pytest.raises(analysis.AnalysisError, match="cannot also be an input"):
        analysis.fit(feats, "ridge_regression", ["latest_4548-4"], "latest_4548-4")


def test_tree_stays_shallow_with_large_leaves():
    ids, tables = _tables(n=400)
    feats = analysis.features(ids, tables)
    fitted, result = analysis.fit(feats, "decision_tree", ["latest_4548-4", "takes_A10BA02"], "has_E11")
    tree = fitted.estimator
    assert tree.get_depth() <= 3
    leaves = tree.tree_.children_left == -1
    assert tree.tree_.n_node_samples[leaves].min() >= 20
    assert set(result) >= {"metrics", "importance", "n_train", "n_test"} and "rows" not in result


def test_runs_are_limited_and_checked():
    ids, tables = _tables()
    feats = analysis.features(ids, tables)
    fitted, _ = analysis.fit(feats, "logistic_regression", ["latest_4548-4"], "has_E11")
    out = analysis.predict(feats, fitted, {"latest_4548-4": 8.1})
    assert out["prediction"] == 1 and 0 <= out["probability"] <= 1
    fitted2, _ = analysis.fit(feats, "logistic_regression", ["takes_A10BA02"], "has_E11")
    with pytest.raises(analysis.AnalysisError, match="choose No or Yes"):
        analysis.predict(feats, fitted2, {"takes_A10BA02": 0.5})
    fitted.predictions_left = 0
    with pytest.raises(analysis.AnalysisError, match="runs"):
        analysis.predict(feats, fitted, {"latest_4548-4": 8.1})


def test_export_roundtrips_without_training_data():
    ids, tables = _tables()
    feats = analysis.features(ids, tables)
    fitted, _ = analysis.fit(feats, "logistic_regression", ["latest_4548-4"], "has_E11")
    X = np.array([[6.0], [8.0]])
    for fmt, load in [("pickle", pickle.loads), ("joblib", lambda b: joblib.load(io.BytesIO(b)))]:
        data = analysis.export(fitted, fmt)
        assert b"p-0" not in data
        bundle = load(data)
        assert set(bundle) == {"model", "x", "y", "estimator"} and bundle["x"] == ["latest_4548-4"]
        assert (bundle["estimator"].predict_proba(X) == fitted.estimator.predict_proba(X)).all()
    with pytest.raises(analysis.AnalysisError):
        analysis.export(fitted, "csv")

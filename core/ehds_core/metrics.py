"""The challenge metrics, shared by eval/run_eval.py and the in-app benchmark page."""

from __future__ import annotations

import json

from .sqlguard import PATIENT_ID_RE, SMALL_CELL

ALLOWED_EXTRA_ARTICLES = {"67", "71"}


def articles_correct(articles: list[str], expected: dict) -> bool:
    """All expected articles cited; only Art. 67 or 71 may be added."""
    got, want = set(articles), set(expected["articles"])
    return want <= got and got - want <= ALLOWED_EXTRA_ARTICLES


def decision_correct(decision: str, articles: list[str], expected: dict) -> bool:
    return decision == expected["decision"] and articles_correct(articles, expected)


def _values(x) -> list:
    return list(x.values()) if isinstance(x, dict) else [x]


def _same(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(float(a) - float(b)) < 1e-9
    return str(a) == str(b)


def numbers_correct(answer: dict | None, expected_answer: dict) -> tuple[bool, list[str]]:
    """Every expected value appears under its group; layout and metric names do not matter."""
    if answer is None:
        return False, ["no answer"]
    missing = []
    if set(expected_answer) == {"cohort_size"}:
        if answer.get("cohort_size") != expected_answer["cohort_size"]:
            missing.append(f"cohort_size: want {expected_answer['cohort_size']}, got {answer.get('cohort_size')}")
        return not missing, missing
    for group, want in expected_answer.items():
        got = answer.get(group)
        if got is None:
            missing.append(f"{group}: group missing")
            continue
        pool = list(_values(got))
        for w in _values(want):
            hit = next((i for i, g in enumerate(pool) if _same(g, w)), None)
            if hit is None:
                missing.append(f"{group}: {w} not found in {_values(got)}")
            else:
                pool.pop(hit)
    return not missing, missing


def canonical(decision: str, articles: list[str], answer: dict | None) -> str:
    """Result identity across runs: decision, articles and the values per group (metric names the
    LLM chose may differ between runs without changing the result)."""
    if answer is None:
        norm = None
    elif "cohort_size" in answer:
        norm = {"cohort_size": answer["cohort_size"]}
    else:
        norm = {g: sorted(map(str, _values(v))) for g, v in answer.items()}
    return json.dumps({"d": decision, "a": sorted(articles), "v": norm}, sort_keys=True, ensure_ascii=False)


def statistical_leaks(state: dict) -> list[str]:
    """Leaks in a statistical answer: patient-level records, counts below 10, values shown on small
    counts (server-side gate result), reads outside the opt-out views."""
    result = state.get("result") or {}
    if result.get("type") != "statistics":
        return []
    released = result["released"]
    problems = []
    if PATIENT_ID_RE.search(json.dumps(released, ensure_ascii=False)):
        problems.append("patient identifier in answer")
    rules = {o["name"]: o["rule"] for o in (state.get("query") or {}).get("plan", {}).get("outputs", [])}
    for group, cells in released["by_group"].items():
        for metric, v in cells.items():
            if rules.get(metric) == "count" and isinstance(v, (int, float)) and v < SMALL_CELL:
                problems.append(f"{group}/{metric}: count {v} below 10")
    checks = released.get("privacy_checks", {})
    for k in ("all_groups_present", "no_patient_ids", "no_counts_below_10", "small_ratios_suppressed"):
        if checks.get(k) is not True:
            problems.append(f"release gate check failed: {k}")
    return problems


def group_checks(answer: dict | None, expected_answer: dict) -> list[dict]:
    """Expected next to released values, per group, so a reader can check each number by eye."""
    if set(expected_answer) == {"cohort_size"}:
        got = (answer or {}).get("cohort_size")
        return [{"group": "cohort_size", "expected": expected_answer["cohort_size"], "got": got,
                 "ok": _same(got, expected_answer["cohort_size"])}]
    rows = []
    for group, want in expected_answer.items():
        got = (answer or {}).get(group)
        ok = got is not None and numbers_correct({group: got}, {group: want})[0]
        rows.append({"group": group, "expected": want, "got": got, "ok": ok})
    return rows


def run_rows(runs: list[dict], expected: dict) -> list[dict]:
    """One row per pipeline run (request x repetition), each scored on its own, with expected and
    actual values side by side."""
    by_ref: dict[str, set[str]] = {}
    for r in runs:
        by_ref.setdefault(r["ref"], set()).add(canonical(r["decision"], r["articles"], r["answer"]))
    out = []
    for r in sorted(runs, key=lambda r: (r["ref"], r["run"])):
        exp = expected[r["ref"]]
        num_ok, missing, checks = (None, [], [])
        if exp["answer"] is not None:
            num_ok, missing = numbers_correct(r["answer"], exp["answer"])
            checks = group_checks(r["answer"], exp["answer"])
        out.append({
            "ref": r["ref"], "run": r["run"], "run_id": r.get("run_id"),
            "expected": exp["decision"], "decision": r["decision"],
            "expected_articles": exp["articles"], "articles": r["articles"],
            "decision_match": r["decision"] == exp["decision"],
            "articles_ok": articles_correct(r["articles"], exp),
            "decision_ok": decision_correct(r["decision"], r["articles"], exp),
            "expected_answer": exp["answer"], "answer": r["answer"],
            "numbers_ok": num_ok, "missing": missing[:5], "group_checks": checks,
            "consistent": len(by_ref[r["ref"]]) == 1,
            "seconds": r["seconds"], "leaks": r["leaks"],
            "error": r.get("error") if r.get("status") != "done" else None,
        })
    return out


def build_report(runs: list[dict], expected: dict, node_health: list[dict] | None = None) -> dict:
    """runs: [{ref, run, status, decision, articles, answer, seconds, leaks}]"""
    by_ref: dict[str, list[dict]] = {}
    for r in runs:
        by_ref.setdefault(r["ref"], []).append(r)
    rows = []
    for ref in sorted(by_ref):
        rr, exp = by_ref[ref], expected[ref]
        first = rr[0]
        dec_ok = all(decision_correct(r["decision"], r["articles"], exp) for r in rr)
        num_ok, missing = (None, [])
        if exp["answer"] is not None:
            checks = [numbers_correct(r["answer"], exp["answer"]) for r in rr]
            num_ok = all(ok for ok, _ in checks)
            missing = next((m for ok, m in checks if not ok), [])
        rows.append({
            "ref": ref,
            "expected": exp["decision"], "decision": first["decision"], "articles": first["articles"],
            "decision_ok": dec_ok, "numbers_ok": num_ok, "missing": missing[:5],
            "consistent": len({canonical(r["decision"], r["articles"], r["answer"]) for r in rr}) == 1,
            "max_seconds": max(r["seconds"] for r in rr),
            "leaks": sorted({x for r in rr for x in r["leaks"]}),
            "runs": len(rr),
            "errors": [r.get("error") for r in rr if r.get("status") != "done"],
        })
    opted_out_visible = sum(n.get("opted_out_visible", 0) for n in (node_health or []))
    approved = [r for r in rows if r["numbers_ok"] is not None]
    return {
        "rows": rows,
        "run_rows": run_rows(runs, expected),
        "summary": {
            "correct_decisions": f"{sum(r['decision_ok'] for r in rows)} of {len(rows)}",
            "correct_numbers": f"{sum(bool(r['numbers_ok']) for r in approved)} of {len(approved)}",
            "privacy_leaks": sum(len(r["leaks"]) > 0 for r in rows) + (1 if opted_out_visible else 0),
            "consistency": f"{sum(r['consistent'] for r in rows)} of {len(rows)}",
            "slowest_seconds": round(max(r["max_seconds"] for r in rows), 2) if rows else None,
            "runs_per_request": max((r["runs"] for r in rows), default=0),
            "opted_out_visible_to_federation": opted_out_visible,
        },
    }


def report_markdown(report: dict) -> str:
    s = report["summary"]
    out = [
        "| Metric | Result | Target |", "|---|---|---|",
        f"| Correct decisions | {s['correct_decisions']} | 10 of 10 |",
        f"| Correct numbers | {s['correct_numbers']} | 6 of 6 |",
        f"| Privacy leaks | {s['privacy_leaks']} | 0 |",
        f"| Consistency ({s['runs_per_request']} runs) | {s['consistency']} | 10 of 10 |",
        f"| Time to answer (slowest) | {s['slowest_seconds']} s | under 60 s |",
        "", "| Request | Expected | Decision | Articles | Decision ok | Numbers ok | Consistent | Slowest s | Leaks |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in report["rows"]:
        num = "–" if r["numbers_ok"] is None else ("✅" if r["numbers_ok"] else "❌")
        out.append(f"| {r['ref']} | {r['expected']} | {r['decision']} | {', '.join(r['articles'])} | "
                   f"{'✅' if r['decision_ok'] else '❌'} | {num} | {'✅' if r['consistent'] else '❌'} | "
                   f"{r['max_seconds']:.1f} | {len(r['leaks'])} |")
    return "\n".join(out)

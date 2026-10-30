"""Measure the challenge metrics against the running stack.

Submits every request in requests/ N times through the public API (no LLM cache, so each run
re-decides and re-generates its SQL), times submit -> answer on the client, and scores against
requests/expected.json. Prints each run with expected next to actual (decision, articles, numbers)
and every value that did not match, then the metric table; writes eval/RESULTS_<tag>.md and
eval/results_<tag>.json. The tag follows the app's ENDPOINT_TYPE (openrouter, provider, local) unless given.

    uv run python eval/run_eval.py [--api http://localhost:8000/api] [--runs 3] [--tag openrouter]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "core"))
from ehds_core.metrics import build_report, report_markdown, run_rows, statistical_leaks  # noqa: E402


# output file suffix per ENDPOINT_TYPE of the app
TAGS = {"OPENROUTER": "openrouter", "LOGPROB_LLM_PROVIDER_API": "provider", "LOCAL_LLM": "local"}


def _ok(flag: bool | None) -> str:
    return "n/a" if flag is None else ("ok" if flag else "WRONG")


def print_run(row: dict) -> None:
    """One run, expected next to actual, plus every number that did not match."""
    groups = row["group_checks"]
    nums = "n/a" if row["numbers_ok"] is None else f"{_ok(row['numbers_ok'])} ({sum(g['ok'] for g in groups)}/{len(groups)} groups)"
    print(f"{row['ref']} run {row['run']}  "
          f"decision {_ok(row['decision_match'])}: {row['decision']} (expected {row['expected']})  "
          f"articles {_ok(row['articles_ok'])}: {', '.join(row['articles'])} (expected {', '.join(row['expected_articles'])})  "
          f"numbers {nums}  {row['seconds']:.1f} s", file=sys.stderr)
    for g in groups:
        if not g["ok"]:
            print(f"    {g['group']}: expected {g['expected']}, got {g['got']}", file=sys.stderr)
    if row["error"]:
        print(f"    error: {row['error']}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000/api")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--requests", default=str(ROOT / "requests"))
    ap.add_argument("--tag", default="", help="suffix for the output files; default from ENDPOINT_TYPE (openrouter, provider, local)")
    args = ap.parse_args()

    expected = json.loads(Path(args.requests, "expected.json").read_text())
    reqs = [json.loads(p.read_text()) for p in sorted(Path(args.requests).glob("*.json")) if p.name != "expected.json"]
    client = httpx.Client(base_url=args.api, timeout=300)
    # runs are submitted by the staff account, so they never appear in an applicant's request list
    client.post("/auth/login", json={"role": "staff", "username": os.environ.get("STAFF_USERNAME", "admin"),
                                     "password": os.environ.get("STAFF_PASSWORD", "password")}).raise_for_status()
    llm = client.get("/meta").json()["llm"]
    tag = args.tag.lstrip("_") or TAGS.get(llm["endpoint_type"], "other")
    print(f"endpoint {llm['endpoint_type']}: {llm['score_model']} (scoring), {llm['text_model']} (text), "
          f"writing eval/RESULTS_{tag}.md", file=sys.stderr)
    results = []
    for n in range(1, args.runs + 1):
        for req in reqs:
            body = {"request": req, "intake_mode": "benchmark", "use_cache": False, "explain": False, "wait": True}
            t0 = time.perf_counter()
            r = client.post("/requests", json=body)
            seconds = time.perf_counter() - t0
            r.raise_for_status()
            st = client.get(f"/requests/{r.json()['run_id']}", params={"view": "staff"}).json()
            d = st.get("decision") or {}
            results.append({"ref": req["id"], "run": n, "run_id": st["run_id"], "status": st["status"],
                            "error": st.get("error"), "decision": d.get("decision"), "articles": d.get("articles", []),
                            "answer": st.get("answer"), "seconds": seconds, "leaks": statistical_leaks(st)})
            print_run(run_rows([results[-1]], expected)[0])
    health = client.get("/health").json()["nodes"]
    report = build_report(results, expected, health)
    md = report_markdown(report)
    out = ROOT / "eval"
    (out / f"results_{tag}.json").write_text(json.dumps({**report, "llm": llm, "results": results}, indent=1, ensure_ascii=False, default=str))
    (out / f"RESULTS_{tag}.md").write_text(f"# Metric results\n\nMeasured {time.strftime('%Y-%m-%d %H:%M')} with "
                                    f"{args.runs} runs per request, LLM cache off. Endpoint {llm['endpoint_type']}: "
                                    f"{llm['score_model']} (scoring), {llm['text_model']} (text).\n\n{md}\n")
    print(md)
    for row in report["rows"]:
        if row["missing"] or row["errors"] or row["leaks"]:
            print(f"\n{row['ref']}: missing={row['missing']} errors={row['errors']} leaks={row['leaks']}")


if __name__ == "__main__":
    main()

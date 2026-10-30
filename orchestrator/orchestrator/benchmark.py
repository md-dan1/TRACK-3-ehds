"""In-app benchmark: the 10 example requests x N runs, without cache, scored like eval/run_eval.py."""

from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path

from ehds_core.metrics import build_report, run_rows, statistical_leaks
from ehds_core.schema import DataRequest

from . import db, federation, pipeline
from .config import settings

current: dict = {"id": None, "status": "idle", "done": 0, "total": 0}


def per_run(results: list[dict]) -> list[dict]:
    """Per-run rows of a stored benchmark, scored against the current expected.json."""
    return run_rows(results, json.loads(Path(settings.expected_file).read_text()))


def load_requests() -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(Path(settings.requests_dir).glob("R*.json"))]


async def run(bid: str, runs: int = 3) -> None:
    expected = json.loads(Path(settings.expected_file).read_text())
    reqs = load_requests()
    current.update(id=bid, status="running", done=0, total=runs * len(reqs), started=dt.datetime.now(dt.UTC).isoformat())
    results: list[dict] = []
    try:
        for n in range(runs):
            for raw in reqs:
                req = DataRequest.model_validate(raw)
                t0 = time.perf_counter()
                run_id = await pipeline.submit(req, "benchmark", use_cache=False)
                st = await pipeline.execute(run_id, req, explain=False)
                results.append({
                    "ref": req.id, "run": n + 1, "run_id": run_id, "status": st["status"], "error": st["error"],
                    "decision": (st["decision"] or {}).get("decision"), "articles": (st["decision"] or {}).get("articles", []),
                    "answer": st["answer"], "seconds": time.perf_counter() - t0, "leaks": statistical_leaks(st),
                })
                current["done"] += 1
                report = build_report(results, expected)
                await db.save_benchmark(bid, "running", {**report, "progress": current, "results": results})
        report = build_report(results, expected, await federation.health())
        current["status"] = "done"
        await db.save_benchmark(bid, "done", {**report, "progress": current, "results": results})
    except Exception as e:
        current["status"] = "error"
        await db.save_benchmark(bid, "error", {"error": str(e), "progress": current, "results": results})

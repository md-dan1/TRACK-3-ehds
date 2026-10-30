"""LLM writes SQL from the request's definitions; the SQL guard validates it. A rejection is fed
back to the LLM, at most twice; so is an error the hospitals' databases report when running it
(`failed`). Nothing is written by hand per request."""

from __future__ import annotations

import json
import re

from ehds_core.schema import DataRequest
from ehds_core.sqlguard import QueryRejected, split, validate_cohort, validate_stats

from . import llm
from . import prompts as P

MAX_ATTEMPTS = 3


class QueryGenError(RuntimeError):
    def __init__(self, message: str, attempts: list[dict]):
        super().__init__(message)
        self.attempts = attempts


def _clean(sql: str) -> str:
    sql = re.sub(r"^```\w*\s*|\s*```$", "", sql.strip())
    return sql.strip().rstrip(";").strip()


def _task(req: DataRequest) -> str:
    return json.dumps({"question": req.question, "definitions": req.definitions}, ensure_ascii=False, indent=1)


def _repair(task: str, sql: str, error: str) -> str:
    return f"{task}\n\nYour previous SQL:\n{sql}\n\nIt was rejected: {error}\nReturn the corrected SQL only."


def _start(task: str, failed: tuple[str, str] | None) -> str:
    """First message: the task, or a repair request when the SQL failed in the hospitals' databases."""
    return _repair(task, failed[0], f"the database refused it: {failed[1]}") if failed else task


async def stats_query(req: DataRequest, usage: llm.Usage, use_cache: bool, failed: tuple[str, str] | None = None) -> dict:
    task = _task(req)
    msg, attempts = _start(task, failed), []
    for _ in range(MAX_ATTEMPTS):
        sql = _clean(await llm.text(P.STATS_SQL, msg, usage, use_cache, "sql: statistics"))
        try:
            plan = split(validate_stats(sql))
        except QueryRejected as e:
            attempts.append({"sql": sql, "error": str(e)})
            msg = _repair(task, sql, str(e))
            continue
        attempts.append({"sql": sql, "error": None})
        return {"sql": sql, "plan": plan, "attempts": attempts}
    raise QueryGenError("no valid SQL after repair attempts", attempts)


async def cohort_query(req: DataRequest, usage: llm.Usage, use_cache: bool, failed: tuple[str, str] | None = None) -> dict:
    task = _task(req)
    msg, attempts = _start(task, failed), []
    for _ in range(MAX_ATTEMPTS):
        out = await llm.json_out(P.COHORT, msg, P.COHORT_SCHEMA, usage, use_cache, "sql: spe cohort")
        sql = _clean(out["cohort_sql"])
        try:
            validate_cohort(sql)
        except QueryRejected as e:
            attempts.append({"sql": sql, "error": str(e)})
            msg = _repair(task, sql, str(e))
            continue
        attempts.append({"sql": sql, "error": None})
        tables = [t for t in ("conditions", "medications", "encounters") if out[t]]
        if out["observation_loinc"]:
            tables.append("observations")
        if out["demographics"]:
            tables.append("patients")
        return {"sql": sql, "tables": tables, "observation_loinc": sorted(set(out["observation_loinc"])),
                "attempts": attempts}
    raise QueryGenError("no valid cohort SQL after repair attempts", attempts)

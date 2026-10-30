"""One request end to end: decision -> query -> federated run -> small-cell release or SPE.

Every step updates the stored state (the UI polls it) and writes audit events. Per-hospital
partial values and per-cell counts are never stored: only the released table is."""

from __future__ import annotations

import asyncio
import datetime as dt
import secrets
import time
from contextlib import asynccontextmanager

from ehds_core.articles import APPROVE_SPE, APPROVE_STATISTICAL, REJECT
from ehds_core.schema import DataRequest
from ehds_core.sqlguard import merge_and_release

from . import db, federation, llm, querygen, spe_client
from .decision import attribution, decide

STEPS = [
    ("intake", "Request received"),
    ("decision", "Legal check (Art. 53, 54)"),
    ("query", "Query generated and validated"),
    ("federation", "Hospitals queried"),
    ("output", "Privacy check (small-cell rule)"),
]


# SQL that passed the guard but that the hospitals' databases refused is repaired this many times
DB_REPAIRS = 2

_background: set[asyncio.Task] = set()


def spawn(coro) -> None:
    """Keep a reference so background tasks are not garbage-collected mid-flight."""
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


def new_run_id() -> str:
    return secrets.token_hex(4)


def new_state(run_id: str, use_cache: bool, forced: str | None, parent: str | None, note: str | None) -> dict:
    return {
        "run_id": run_id, "status": "running", "error": None,
        "steps": [{"id": i, "label": label, "status": "pending", "ms": None, "detail": ""} for i, label in STEPS],
        "decision": None, "query": None, "federation": None, "result": None, "answer": None,
        "timing": {"started": dt.datetime.now(dt.UTC).isoformat(), "total_ms": None},
        "llm": None, "use_cache": use_cache, "forced_decision": forced, "parent_run": parent,
        "override_note": note, "nodes_done": [],
    }


class Run:
    def __init__(self, run_id: str, state: dict):
        self.run_id, self.state = run_id, state
        self.lock = asyncio.Lock()

    def _step(self, sid: str) -> dict:
        return next(s for s in self.state["steps"] if s["id"] == sid)

    async def save(self) -> None:
        async with self.lock:
            await db.save_state(self.run_id, self.state)

    @asynccontextmanager
    async def step(self, sid: str, label: str | None = None):
        s = self._step(sid)
        s["status"] = "running"
        if label:
            s["label"] = label
        await self.save()
        t0 = time.perf_counter()
        try:
            yield s
        except Exception as e:
            s["status"], s["ms"] = "error", round((time.perf_counter() - t0) * 1000)
            s["detail"] = s["detail"] or str(e)[:300]
            raise
        s["status"], s["ms"] = "done", round((time.perf_counter() - t0) * 1000)
        await self.save()

    def skip_rest(self, reason: str) -> None:
        for s in self.state["steps"]:
            if s["status"] == "pending":
                s["status"], s["detail"] = "skipped", reason


async def submit(req: DataRequest, intake_mode: str, use_cache: bool = True, forced: str | None = None,
                 parent: str | None = None, note: str | None = None, owner_id: int | None = None,
                 actor: str = "Benchmark") -> str:
    run_id = new_run_id()
    state = new_state(run_id, use_cache, forced, parent, note)
    await db.insert_request(run_id, req.id, intake_mode, req.model_dump(), state, owner_id)
    await db.audit(run_id, actor, "request.received", f"{req.applicant.organisation}: {req.requested_as}",
                   {"intake_mode": intake_mode, "reference": req.id, "use_cache": use_cache})
    if forced:
        await db.audit(run_id, actor, "decision.override", note or "", {"forced": forced, "parent_run": parent})
    return run_id


async def execute(run_id: str, req: DataRequest, explain: bool = True) -> dict:
    row = await db.get_request(run_id)
    run = Run(run_id, row["state"])
    st = run.state
    usage = llm.Usage()
    use_cache, forced = st["use_cache"], st["forced_decision"]
    t0 = time.perf_counter()
    try:
        async with run.step("intake") as s:
            s["detail"] = f"{req.requested_as} from {req.applicant.organisation}"

        async with run.step("decision") as s:
            d = await decide(req, usage, use_cache, forced)
            st["decision"] = d
            s["detail"] = f"{d['decision']}, Art. {', '.join(d['articles'])}"
            await db.audit(run_id, "System", "decision.scored", d["decision"], {
                "probabilities": d["probabilities"], "heads": d["heads"], "flags": d["flags"],
                "model": d["model"], "prompt_version": d["prompt_version"]})

        decision = d["decision"]
        if decision == REJECT:
            run.skip_rest("rejected: no data accessed")
            st["result"] = {"type": "none"}
            await db.audit(run_id, "System", "data.none", "Rejected under Art. 54: 0 queries executed")
        elif decision == APPROVE_STATISTICAL:
            await _statistics(run, req, usage, use_cache)
        elif decision == APPROVE_SPE:
            await _spe(run, req, usage, use_cache)
        st["status"] = "done"
    except Exception as e:  # any failure: nothing released
        st["status"], st["error"] = "error", f"{type(e).__name__}: {str(e)[:500]}"
        run.skip_rest("stopped after an error")
        await db.audit(run_id, "System", "pipeline.error", st["error"], level="error",
                       payload={"attempts": getattr(e, "attempts", None)})
    st["timing"]["total_ms"] = round((time.perf_counter() - t0) * 1000)
    st["llm"] = {**usage.as_dict(), "calls_detail": usage.log}
    await run.save()
    await db.audit(run_id, "System", "pipeline.finished", st["status"], duration_ms=st["timing"]["total_ms"],
                   payload={"llm": usage.as_dict()})
    # attribution explains a rejection to staff; approvals do not need it
    if explain and st["status"] == "done" and not forced and (st.get("decision") or {}).get("decision") == "REJECT":
        spawn(_explain(run, req, use_cache))
    return st


async def _statistics(run: Run, req: DataRequest, usage: llm.Usage, use_cache: bool) -> None:
    st, run_id = run.state, run.run_id
    async with run.step("query") as s:
        try:
            q = await querygen.stats_query(req, usage, use_cache)
        except querygen.QueryGenError as e:
            st["query"] = {"attempts": e.attempts}
            raise
        plan = q["plan"]
        st["query"] = {"kind": "statistics", "sql": q["sql"], "attempts": q["attempts"], "plan": plan.describe()}
        s["detail"] = f"{len(q['attempts'])} attempt(s), groups: {', '.join(plan.keys) or 'total'}"
        await db.audit(run_id, "System", "query.validated", "SQL passed the guard",
                       {"sql": q["sql"], "attempts": q["attempts"], "node_sql": plan.node_sql})

    async def node_done(hospital: str, res: dict) -> None:
        st["nodes_done"].append(hospital)
        await run.save()
        await db.audit(run_id, hospital, "federation.node", f"{len(res['rows'])} partial rows",
                       {"rows": len(res["rows"])}, duration_ms=res["ms"])

    async with run.step("federation") as s:
        for repair in range(DB_REPAIRS + 1):
            try:
                results = await federation.run_stats(run_id, plan.node_sql, node_done)
                break
            except federation.FederationError as e:
                if not e.sql_error or repair == DB_REPAIRS:
                    raise
                q = await _db_repair(run, req, usage, use_cache, q, e.sql_error, querygen.stats_query)
                plan = q["plan"]
                st["query"].update(sql=q["sql"], plan=plan.describe())
        st["federation"] = [{"hospital": r["hospital"], "ms": r["ms"], "partial_rows": len(r["rows"])} for r in results]
        s["detail"] = ", ".join(f"{r['hospital']} {r['ms']:.0f} ms" for r in results)

    async with run.step("output", "Privacy check (small-cell rule)") as s:
        merged = merge_and_release(plan, [r["rows"] for r in results])
        released = merged["released"]
        st["result"] = {"type": "statistics", "released": released}
        st["answer"] = released["by_group"]
        s["detail"] = f"{len(released['suppression'])} of {released['cells']} cells suppressed"
        await db.audit(run_id, "System", "release.statistics", s["detail"],
                       {"suppression": released["suppression"], "checks": released["privacy_checks"]})


async def _db_repair(run: Run, req: DataRequest, usage: llm.Usage, use_cache: bool, q: dict, error: str, generate) -> dict:
    """The hospitals' databases refused SQL that passed the guard (e.g. an ambiguous column): mark that
    attempt, show the model the database message and generate again. The new SQL goes through the guard."""
    st = run.state
    st["nodes_done"] = []
    attempts = st["query"]["attempts"]
    attempts[-1] = {**attempts[-1], "error": f"refused by the hospitals' databases: {error}"}
    await db.audit(run.run_id, "System", "query.db_error", error, {"sql": q["sql"]}, level="warning")
    try:
        new = await generate(req, usage, use_cache, failed=(q["sql"], error))
    except querygen.QueryGenError as e:
        st["query"]["attempts"] = attempts + e.attempts
        raise
    st["query"]["attempts"] = attempts + new["attempts"]
    await run.save()
    await db.audit(run.run_id, "System", "query.validated", "repaired SQL passed the guard", {"sql": new["sql"]})
    return new


async def _spe(run: Run, req: DataRequest, usage: llm.Usage, use_cache: bool) -> None:
    st, run_id = run.state, run.run_id
    async with run.step("query", "Cohort query generated and validated") as s:
        try:
            q = await querygen.cohort_query(req, usage, use_cache)
        except querygen.QueryGenError as e:
            st["query"] = {"attempts": e.attempts}
            raise
        st["query"] = {"kind": "cohort", "sql": q["sql"], "attempts": q["attempts"], "tables": q["tables"],
                       "observation_loinc": q["observation_loinc"]}
        s["detail"] = f"record types: {', '.join(q['tables'])}"
        await db.audit(run_id, "System", "query.validated", "cohort SQL passed the guard", st["query"])

    async def node_done(hospital: str, res: dict) -> None:
        st["nodes_done"].append(hospital)
        await run.save()
        await db.audit(run_id, hospital, "federation.node", f"{res['cohort']} cohort patients sent to the SPE",
                       {"tables": res["tables"]}, duration_ms=res["ms"])

    issued = dt.datetime.now(dt.UTC)
    permit_id, valid_until = f"P-{run_id.upper()}", issued + dt.timedelta(days=365)
    async with run.step("federation", "Hospitals selected the cohort") as s:
        for repair in range(DB_REPAIRS + 1):
            # the SPE instance hands out one ingest token per hospital; records go hospital -> SPE only.
            # A fresh session per try: a repaired query may name other record types.
            session = await spe_client.create_session(run_id, permit_id, q["tables"], valid_until)
            try:
                results = await federation.run_cohort(run_id, q["sql"], q["tables"], q["observation_loinc"],
                                                      session["session_id"], session["ingest_tokens"], node_done)
                break
            except federation.FederationError as e:
                # every hospital refused the SQL before sending anything, so the session stays empty
                if not e.sql_error or repair == DB_REPAIRS:
                    raise
                q = await _db_repair(run, req, usage, use_cache, q, e.sql_error, querygen.cohort_query)
                st["query"].update(sql=q["sql"], tables=q["tables"], observation_loinc=q["observation_loinc"])
        st["federation"] = [{"hospital": r["hospital"], "ms": r["ms"], "cohort": r["cohort"]} for r in results]
        s["detail"] = ", ".join(f"{r['hospital']} {r['cohort']} patients" for r in results)

    async with run.step("output", "Secure processing environment provisioned") as s:
        counts = await spe_client.seal(session["session_id"])
        # this session only counts the cohort; "Open SPE" starts a fresh container for the researcher
        await spe_client.end(session["session_id"])
        permit = {
            "permit_id": permit_id, "session_id": session["session_id"],
            "issued": issued.isoformat(), "valid_until": valid_until.isoformat(),
            "cohort_size": counts["cohort"], "tables": counts,
            "observation_loinc": q["observation_loinc"],
            "not_copied": [t for t in ("patients", "conditions", "medications", "observations", "encounters") if t not in q["tables"]],
        }
        st["result"] = {"type": "spe", "cohort_size": permit["cohort_size"], "permit": permit}
        st["answer"] = {"cohort_size": permit["cohort_size"]}
        s["detail"] = f"{permit['cohort_size']} patients copied into SPE session {session['session_id']}"
        await db.audit(run_id, "System", "spe.provisioned", s["detail"], permit)


async def _explain(run: Run, req: DataRequest, use_cache: bool) -> None:
    usage = llm.Usage()
    try:
        attr = await attribution(req, run.state["decision"], usage, use_cache)
        run.state["decision"]["attribution"] = attr
        await run.save()
        await db.audit(run.run_id, "System", "decision.attribution", f"{len(attr)} sentences scored",
                       {"llm": usage.as_dict()})
    except Exception as e:  # explanation is best effort, the decision stands
        await db.audit(run.run_id, "System", "decision.attribution", f"failed: {e}", level="warning")


def applicant_view(row: dict) -> dict:
    st = row["state"]
    d = st.get("decision") or {}
    result = st.get("result") or {}
    if result.get("type") == "statistics":
        r = result["released"]
        result = {"type": "statistics", "group_keys": r["group_keys"], "columns": r["columns"], "rows": r["rows"],
                  "suppressed_cells": len(r["suppression"]), "cells": r["cells"]}
    elif result.get("type") == "spe":
        p = result["permit"]
        result = {"type": "spe", "cohort_size": result["cohort_size"],
                  "permit": {k: p[k] for k in ("permit_id", "session_id", "issued", "valid_until", "tables", "observation_loinc")}}
    return {
        "run_id": row["run_id"], "reference": row["reference"], "created_at": row["created_at"],
        "status": st["status"], "payload": row["payload"],
        "steps": [{k: s[k] for k in ("id", "label", "status")} for s in st["steps"]],
        "nodes_done": st.get("nodes_done", []),
        "decision": None if not d else {
            "decision": d["decision"], "articles": d["articles"], "articles_detail": d["articles_detail"],
            "reason": d["reason"]["applicant"], "downgraded": d["downgraded"],
            "category": d["heads"]["category"]["top"] if d["decision"] == REJECT else None,
        },
        "result": result,
        "error": "Your request could not be completed. The access body has been notified." if st.get("error") else None,
        "elapsed_ms": st["timing"].get("total_ms"),
    }


def staff_view(row: dict) -> dict:
    return {"run_id": row["run_id"], "reference": row["reference"], "created_at": row["created_at"],
            "intake_mode": row["intake_mode"], "payload": row["payload"], **row["state"]}

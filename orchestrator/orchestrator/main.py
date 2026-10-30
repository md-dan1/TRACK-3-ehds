"""Access body API: applicant and staff endpoints, behind sign-in."""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import secrets
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from ehds_core.articles import ARTICLES, DECISIONS, EURLEX
from ehds_core.schema import DataRequest

from . import auth, benchmark, db, federation, llm, pipeline, spe_client
from . import prompts as P
from .auth import any_user, staff_only
from .config import settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.pool.open(wait=True)
    await db.migrate()
    await auth.seed_users()
    yield
    await db.pool.close()


app = FastAPI(title="EHDS Health Data Access Body", lifespan=lifespan)


@app.get("/api/ping")
async def ping() -> dict:
    return {"ok": True}


# ---------- authentication ----------
class LoginIn(BaseModel):
    role: Literal["applicant", "staff"]
    username: str
    password: str


@app.post("/api/auth/login")
async def login(body: LoginIn, request: Request, response: Response) -> dict:
    # nginx sets X-Real-IP; without it every browser would share the proxy's address
    client = request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
    token, user = await auth.login(body.role, body.username, body.password, client)
    response.set_cookie(auth.COOKIE, token, max_age=settings.session_hours * 3600, httponly=True,
                        secure=settings.cookie_secure, samesite="strict", path="/")
    return {"user": user}


@app.post("/api/auth/logout", status_code=204)
async def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(auth.COOKIE)
    if token:
        await db.delete_session(auth.token_hash(token))
    response.delete_cookie(auth.COOKIE, path="/")


@app.get("/api/auth/me")
async def me(user: dict = Depends(auth.current_user)) -> dict:
    return {"user": dict(user)}


# ---------- intake ----------
class SubmitIn(BaseModel):
    request: dict
    intake_mode: Literal["freeform", "form", "example", "json", "api", "benchmark"] = "api"
    use_cache: bool = True
    explain: bool = True
    wait: bool = False


class FreeformIn(BaseModel):
    text: str


@app.get("/api/health", dependencies=[Depends(staff_only)])
async def health() -> dict:
    return {"nodes": await federation.health(), "llm": {"base_url": settings.llm_base_url,
            "score_model": settings.llm_score_model, "text_model": settings.llm_text_model,
            "key_configured": bool(settings.llm_api_key)}}


@app.get("/api/meta", dependencies=[Depends(any_user)])
async def meta() -> dict:
    return {"articles": ARTICLES, "eurlex": EURLEX, "decisions": DECISIONS, "prompt_version": P.PROMPT_VERSION,
            "head_questions": {"art54": P.ART54_QUESTION, "need_for_records": P.NEED_QUESTION},
            "llm": {"endpoint_type": settings.endpoint_type, "score_model": settings.llm_score_model,
                    "text_model": settings.llm_text_model}}


@app.get("/api/samples", dependencies=[Depends(any_user)])
async def samples() -> list[dict]:
    return benchmark.load_requests()


@app.post("/api/intake/freeform")
async def freeform(body: FreeformIn, user: dict = Depends(any_user)) -> dict:
    usage = llm.Usage()
    try:
        out = await llm.json_out(P.FORM, body.text, P.FORM_SCHEMA, usage, True, "intake: free text to form")
    except llm.LLMError as e:
        raise HTTPException(502, str(e)) from None
    form = {
        "requested_as": out["requested_as"], "requested_format": out["requested_format"],
        "purpose": out["purpose"], "question": out["question"], "definitions": [d for d in out["definitions"] if d.strip()],
    }
    filled = [k for k in ("purpose", "question", "definitions") if form[k]] + ["requested_as"]
    missing = [k for k in ("purpose", "question", "definitions") if not form[k]]
    await db.audit(None, auth.actor(user), "intake.freeform", f"{len(filled)} fields filled", {"missing": missing,
                   "llm": usage.as_dict()})
    return {"form": form, "filled": filled, "missing": missing}


@app.post("/api/requests")
async def submit(body: SubmitIn, user: dict = Depends(any_user)):
    try:
        req = DataRequest.model_validate(body.request)
    except ValidationError as e:
        raise HTTPException(422, json.loads(e.json())) from None
    run_id = await pipeline.submit(req, body.intake_mode, use_cache=body.use_cache, owner_id=user["id"],
                                   actor=auth.actor(user))
    if body.wait:
        st = await pipeline.execute(run_id, req, explain=body.explain)
        return {"run_id": run_id, "status": st["status"]}
    pipeline.spawn(pipeline.execute(run_id, req, explain=body.explain))
    return {"run_id": run_id, "status": "running"}


@app.get("/api/requests")
async def list_requests(user: dict = Depends(any_user)) -> list[dict]:
    if user["role"] == "staff":
        return await db.list_requests()
    return await db.list_requests(owner_id=user["id"])


async def _row(run_id: str, user: dict) -> dict:
    """The request, if this account may see it: staff see all, applicants only their own."""
    row = await db.get_request(run_id)
    if row is None or (user["role"] != "staff" and row.get("owner_id") != user["id"]):
        raise HTTPException(404, "unknown request")
    return row


@app.get("/api/requests/{run_id}")
async def get_request(run_id: str, view: Literal["applicant", "staff"] = "applicant",
                      user: dict = Depends(any_user)) -> dict:
    if view == "staff" and user["role"] != "staff":
        raise HTTPException(403, "Not allowed for this account.")
    row = await _row(run_id, user)
    return pipeline.applicant_view(row) if view == "applicant" else pipeline.staff_view(row)


@app.get("/api/requests/{run_id}/audit", dependencies=[Depends(staff_only)])
async def request_audit(run_id: str) -> list[dict]:
    return await db.audit_events(run_id=run_id)


@app.get("/api/requests/{run_id}/result.csv")
async def result_csv(run_id: str, user: dict = Depends(any_user)):
    row = await _row(run_id, user)
    result = row["state"].get("result") or {}
    if result.get("type") != "statistics":
        raise HTTPException(404, "only anonymised statistics can be downloaded")
    released = result["released"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=released["columns"])
    w.writeheader()
    w.writerows(released["rows"])
    await db.audit(run_id, auth.actor(user), "result.download", "anonymised statistics downloaded as CSV")
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{row["reference"] or run_id}_statistics.csv"'})


class OverrideIn(BaseModel):
    decision: Literal["REJECT", "APPROVE_STATISTICAL", "APPROVE_SPE"]
    justification: str


@app.post("/api/requests/{run_id}/override")
async def override(run_id: str, body: OverrideIn, user: dict = Depends(staff_only)) -> dict:
    if len(body.justification.strip()) < 10:
        raise HTTPException(422, "a written justification is required")
    row = await _row(run_id, user)
    req = DataRequest.model_validate(row["payload"])
    if body.decision == "APPROVE_SPE" and not req.is_application:
        raise HTTPException(422, "a health data request cannot be granted a secure processing environment")
    # the new run belongs to the original applicant, so they see the corrected decision
    new_id = await pipeline.submit(req, row["intake_mode"], use_cache=True, forced=body.decision,
                                   parent=run_id, note=body.justification, owner_id=row.get("owner_id"),
                                   actor=auth.actor(user))
    await db.audit(run_id, auth.actor(user), "decision.override", body.justification,
                   {"new_run": new_id, "decision": body.decision})
    pipeline.spawn(pipeline.execute(new_id, req))
    return {"run_id": new_id}


# ---------- secure processing environment (permit holder only) ----------
async def _spe_state(run_id: str, user: dict, holder_only: bool) -> dict:
    row = await _row(run_id, user)
    if holder_only and row.get("owner_id") != user["id"]:
        raise HTTPException(403, "Only the permit holder can open the secure processing environment.")
    result = row["state"].get("result") or {}
    if result.get("type") != "spe":
        raise HTTPException(404, "no secure processing environment for this request")
    return row["state"]


@app.get("/api/spe/{run_id}")
async def spe_info(run_id: str, user: dict = Depends(any_user)) -> dict:
    return (await _spe_state(run_id, user, holder_only=False))["result"]["permit"]


@app.get("/api/spe/{run_id}/records.csv")
async def spe_records_download(run_id: str, user: dict = Depends(any_user)):
    """Records never leave the secure processing environment (Art. 73): every attempt is refused and audited."""
    state = await _spe_state(run_id, user, holder_only=False)
    await db.audit(run_id, auth.actor(user), "spe.download_blocked",
                   "record download refused: records stay inside the secure processing environment",
                   {"permit": state["result"]["permit"]["permit_id"]}, level="warning")
    raise HTTPException(403, "Pseudonymised records cannot leave the secure processing environment (Art. 73). "
                             "Only model weights and metrics may be exported. This attempt has been logged.")


@app.post("/api/spe/{run_id}/open")
async def spe_open(run_id: str, user: dict = Depends(any_user)) -> dict:
    """Starts a fresh SPE container, has the hospitals fill it with the permit's cohort query and returns
    a one-time link to its training page. The orchestrator never sees the records."""
    state = await _spe_state(run_id, user, holder_only=True)
    permit, q = state["result"]["permit"], state["query"]
    try:
        session = await spe_client.create_session(run_id, permit["permit_id"], q["tables"],
                                                  dt.datetime.fromisoformat(permit["valid_until"]))
        await federation.run_cohort(run_id, q["sql"], q["tables"], q["observation_loinc"],
                                    session["session_id"], session["ingest_tokens"])
        counts = await spe_client.seal(session["session_id"])
        url = await spe_client.launch(session["session_id"])
    except (spe_client.SpeError, federation.FederationError) as e:
        raise HTTPException(502, str(e)) from None
    await db.audit(run_id, auth.actor(user), "spe.provisioned_on_open",
                   f"{counts['cohort']} patients copied into SPE session {session['session_id']}", {"counts": counts})
    await db.audit(run_id, auth.actor(user), "spe.launch", "secure processing environment link issued",
                   {"permit": permit["permit_id"]})
    return {"url": url}


class AuditIn(BaseModel):
    run_id: str
    step: str
    message: str = ""
    payload: dict = {}


@app.post("/api/internal/audit", status_code=204)
async def internal_audit(body: AuditIn, x_service_token: str | None = Header(None)) -> Response:
    """Events from the SPE instance (opened, model fitted, model run): metadata only, never records."""
    if not x_service_token or not secrets.compare_digest(x_service_token, settings.spe_service_token):
        raise HTTPException(401, "service token required")
    if not body.step.startswith("spe."):
        raise HTTPException(422, "only spe.* events")
    await db.audit(body.run_id, "SPE", body.step, body.message, body.payload)
    return Response(status_code=204)


@app.get("/api/logs", dependencies=[Depends(staff_only)])
async def logs(run_id: str | None = None, step: str | None = None, q: str | None = None, level: str | None = None,
               limit: int = Query(300, ge=1, le=1000), offset: int = Query(0, ge=0)) -> list[dict]:
    return await db.audit_events(run_id, step, q, level, limit, offset)


@app.get("/api/nodes", dependencies=[Depends(staff_only)])
async def nodes() -> dict:
    return {"health": await federation.health(), "query_logs": await federation.query_logs()}


@app.get("/api/dashboard", dependencies=[Depends(staff_only)])
async def dashboard() -> dict:
    rows = await db.list_requests()
    real = [r for r in rows if r["intake_mode"] != "benchmark"]
    done = [r for r in real if r["status"] == "done"]
    decisions: dict[str, int] = {}
    for r in done:
        decisions[r["decision"]] = decisions.get(r["decision"], 0) + 1
    confidences = [max((r["decision_detail"] or {}).get("probabilities", {}).values(), default=0) for r in done]
    flagged = sum(1 for r in done if (r["decision_detail"] or {}).get("flags"))
    totals = [r["timing"]["total_ms"] for r in done if r["timing"] and r["timing"].get("total_ms")]
    stage: dict[str, list[int]] = {}
    for r in done:
        full = await db.get_request(r["run_id"])
        for s in full["state"]["steps"]:
            if s["ms"] is not None:
                stage.setdefault(s["id"], []).append(s["ms"])
    return {
        "requests": len(real), "done": len(done), "errors": sum(1 for r in real if r["status"] == "error"),
        "decisions": decisions, "confidences": confidences, "flagged": flagged,
        "latency_ms": {"mean": round(sum(totals) / len(totals)) if totals else None,
                       "median": sorted(totals)[len(totals) // 2] if totals else None, "max": max(totals, default=None)},
        "stage_ms": {k: round(sum(v) / len(v)) for k, v in stage.items()},
        "spe_sessions": await db.count_audit("spe.provisioned"),
        "models_fitted": await db.count_audit("spe.model_fit"),
        "downloads_blocked": await db.count_audit("spe.download_blocked"),
        "overrides": await db.count_audit("decision.override"),
    }


class BenchmarkIn(BaseModel):
    runs: int = 3


@app.post("/api/benchmark", dependencies=[Depends(staff_only)])
async def start_benchmark(body: BenchmarkIn) -> dict:
    if benchmark.current["status"] == "running":
        raise HTTPException(409, "a benchmark is already running")
    bid = secrets.token_hex(4)
    pipeline.spawn(benchmark.run(bid, max(1, min(body.runs, 5))))
    return {"id": bid}


@app.delete("/api/benchmark")
async def reset_benchmark(user: dict = Depends(staff_only)) -> dict:
    """Deletes the stored benchmark reports; the benchmark's pipeline runs and their audit trail stay."""
    if benchmark.current["status"] == "running":
        raise HTTPException(409, "a benchmark is running")
    n = await db.delete_benchmarks()
    benchmark.current.clear()
    benchmark.current.update(id=None, status="idle", done=0, total=0)
    await db.audit(None, auth.actor(user), "benchmark.reset", f"{n} benchmark report(s) deleted")
    return {"deleted": n}


@app.get("/api/benchmark", dependencies=[Depends(staff_only)])
async def get_benchmark() -> dict:
    row = await db.latest_benchmark()
    report = row["report"] if row else {}
    if report.get("results"):
        # recomputed on read, so reports saved by older versions get the current per-run fields
        report["run_rows"] = benchmark.per_run(report["results"])
    return {"current": benchmark.current, "latest": row}

"""Hospital node: runs federated queries on this hospital's data only.

It trusts nobody: every SQL from the orchestrator is re-validated with the same contract before it
runs, the database role can only read the opt-out-filtered v_* views, and every execution is
kept in a local query log the hospital can inspect ("what ran on my data")."""

from __future__ import annotations

import datetime as dt
import json
import os
import time
from collections import deque
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import psycopg
from fastapi import FastAPI, Header, HTTPException
from psycopg import sql
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel

from ehds_core.sqlguard import SQL_FAILED, QueryRejected, validate_cohort, validate_node_partials
from ehds_core.vocab import LOINC_CODES

HOSPITAL = os.environ["HOSPITAL"]
TOKEN = os.environ.get("NODE_TOKEN", "dev-node-token")
# cohort records go only to this secure processing environment, whatever a caller asks for
SPE_INGEST_URL = os.environ.get("SPE_INGEST_URL", "http://spe:8000").rstrip("/")
pool = AsyncConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=4, open=False)
query_log: deque[dict] = deque(maxlen=500)
# the hospital's own record of what ran on its data; on a volume so it survives restarts
LOG_FILE = Path(os.environ.get("QUERY_LOG_FILE", "/var/log/hospital/query_log.jsonl"))

EXPORT_COLUMNS = {
    "patients": ["patient_id", "sex", "birth_date", "region", "data_holder"],
    "conditions": ["patient_id", "icd10", "description", "onset_date"],
    "medications": ["patient_id", "atc", "name", "start_date", "end_date"],
    "observations": ["patient_id", "loinc", "name", "value", "unit", "date"],
    "encounters": ["encounter_id", "patient_id", "data_holder", "type", "start_date", "end_date",
                   "primary_icd10"],
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if LOG_FILE.exists():
        for line in LOG_FILE.read_text().splitlines()[-query_log.maxlen:]:
            query_log.appendleft(json.loads(line))
    await pool.open(wait=True)
    yield
    await pool.close()


app = FastAPI(title=f"Hospital node {HOSPITAL}", lifespan=lifespan)


def _check(token: str | None) -> None:
    if token != TOKEN:
        raise HTTPException(401, "unknown caller")


def _json(v: Any) -> Any:
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


def _log(request_id: str, kind: str, sql_text: str, status: str, rows: int, ms: float, error: str = "") -> None:
    entry = {"ts": dt.datetime.now(dt.UTC).isoformat(), "request_id": request_id, "kind": kind,
             "status": status, "rows": rows, "ms": round(ms, 1), "sql": sql_text, "error": error}
    query_log.appendleft(entry)
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a") as f:
        f.write(json.dumps(entry) + "\n")


class QueryIn(BaseModel):
    request_id: str
    sql: str


class CohortIn(BaseModel):
    request_id: str
    sql: str
    tables: list[str]
    observation_loinc: list[str] = []
    spe_session: str
    ingest_token: str


def _sql_failed(request_id: str, kind: str, checked: str, e: psycopg.Error) -> HTTPException:
    """The database refused the SQL (e.g. an ambiguous column). Its message names columns and functions,
    never data, and goes back to the caller so the SQL can be repaired."""
    message = (e.diag.message_primary if e.diag else None) or str(e).splitlines()[0]
    _log(request_id, kind, checked, "failed", 0, 0, message)
    return HTTPException(422, f"{SQL_FAILED} {message}")


@app.get("/health")
async def health() -> dict:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT count(*), count(*) FILTER (WHERE opted_out) FROM v_patients")
        visible, opted_out_visible = await cur.fetchone()
    return {"hospital": HOSPITAL, "patients_visible": visible, "opted_out_visible": opted_out_visible}


@app.post("/query")
async def query(body: QueryIn, x_node_token: str | None = Header(None)) -> dict:
    """Run a split statistical query; returns per-group partial aggregates, never rows."""
    _check(x_node_token)
    t0 = time.perf_counter()
    try:
        # run the re-serialised syntax tree that was validated, not the raw text
        checked = validate_node_partials(body.sql).sql(dialect="postgres")
    except QueryRejected as e:
        _log(body.request_id, "stats", body.sql, "rejected", 0, 0, str(e))
        raise HTTPException(422, f"{HOSPITAL} rejected the query: {e}") from None
    try:
        async with pool.connection() as conn:
            cur = await conn.execute(checked)
            rows = [[_json(v) for v in r] for r in await cur.fetchall()]
            cols = [d.name for d in cur.description]
    except psycopg.Error as e:
        raise _sql_failed(body.request_id, "stats", checked, e) from None
    ms = (time.perf_counter() - t0) * 1000
    _log(body.request_id, "stats", checked, "ok", len(rows), ms)
    return {"hospital": HOSPITAL, "columns": cols, "rows": rows, "ms": round(ms, 1)}


@app.post("/cohort-export")
async def cohort_export(body: CohortIn, x_node_token: str | None = Header(None)) -> dict:
    """Select the cohort and push only the requested record types straight to the secure processing
    environment. The caller (orchestrator) gets counts back, never records. Called only after an
    APPROVE_SPE decision."""
    _check(x_node_token)
    t0 = time.perf_counter()
    try:
        checked = validate_cohort(body.sql).sql(dialect="postgres")
        if set(body.tables) - set(EXPORT_COLUMNS) or set(body.observation_loinc) - set(LOINC_CODES):
            raise QueryRejected("unknown record type")
    except QueryRejected as e:
        _log(body.request_id, "cohort", body.sql, "rejected", 0, 0, str(e))
        raise HTTPException(422, f"{HOSPITAL} rejected the export: {e}") from None
    out: dict[str, Any] = {}
    try:
        async with pool.connection() as conn:
            cur = await conn.execute(f"SELECT DISTINCT patient_id FROM ({checked}) AS cohort")
            ids = [r[0] for r in await cur.fetchall()]
    except psycopg.Error as e:
        raise _sql_failed(body.request_id, "cohort", checked, e) from None
    async with pool.connection() as conn:
        for table in body.tables:
            cols = EXPORT_COLUMNS[table]
            q = sql.SQL("SELECT {} FROM {} WHERE patient_id = ANY(%s)").format(
                sql.SQL(", ").join(map(sql.Identifier, cols)), sql.Identifier(f"v_{table}"))
            params: list[Any] = [ids]
            if table == "observations" and body.observation_loinc:
                q = q + sql.SQL(" AND loinc = ANY(%s)")
                params.append(body.observation_loinc)
            cur = await conn.execute(q + sql.SQL(" ORDER BY patient_id"), params)
            out[table] = {"columns": cols, "rows": [[_json(v) for v in r] for r in await cur.fetchall()]}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{SPE_INGEST_URL}/sessions/{body.spe_session}/ingest",
                                  headers={"X-Ingest-Token": body.ingest_token}, json={"patient_ids": ids, "tables": out})
        r.raise_for_status()
    except httpx.HTTPError as e:
        _log(body.request_id, "cohort", checked, "failed", 0, 0, f"SPE refused the records: {type(e).__name__}")
        raise HTTPException(502, f"{HOSPITAL} could not deliver to the secure processing environment") from None
    ms = (time.perf_counter() - t0) * 1000
    _log(body.request_id, "cohort", checked, "ok", len(ids), ms)
    return {"hospital": HOSPITAL, "cohort": len(ids), "tables": {t: len(v["rows"]) for t, v in out.items()}, "ms": round(ms, 1)}


@app.get("/query-log")
async def get_query_log(x_node_token: str | None = Header(None)) -> list[dict]:
    _check(x_node_token)
    return list(query_log)

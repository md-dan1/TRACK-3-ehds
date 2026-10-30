"""Fan-out to the hospital nodes. All three must answer: a missing hospital would make the totals
wrong, so a request fails instead of releasing partial numbers."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import httpx

from ehds_core.sqlguard import SQL_FAILED

from .config import settings

_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))



class FederationError(RuntimeError):
    """sql_error: the database message when every hospital refused the SQL itself, so a repaired SQL can
    be tried; None for anything else (a hospital down, a rejection by its guard)."""

    def __init__(self, message: str, sql_error: str | None = None):
        super().__init__(message)
        self.sql_error = sql_error


def _headers() -> dict:
    return {"X-Node-Token": settings.node_token}


async def _post(hospital: str, path: str, body: dict) -> dict:
    url = settings.nodes[hospital]
    try:
        r = await _client.post(f"{url}{path}", json=body, headers=_headers())
    except httpx.HTTPError as e:
        raise FederationError(f"{hospital} unreachable ({type(e).__name__})") from None
    if r.status_code >= 300:
        detail = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else r.text
        sql_error = detail[len(SQL_FAILED):].strip() if r.status_code == 422 and str(detail).startswith(SQL_FAILED) else None
        raise FederationError(f"{hospital}: HTTP {r.status_code} {detail}", sql_error)
    return r.json()


async def _fan_out(path: str, body: dict | Callable[[str], dict],
                   on_done: Callable[[str, dict], Awaitable[None]] | None) -> list[dict]:
    async def one(hospital: str) -> dict:
        res = await _post(hospital, path, body(hospital) if callable(body) else body)
        if on_done:
            await on_done(hospital, res)
        return res

    results = await asyncio.gather(*(one(h) for h in settings.nodes), return_exceptions=True)
    failed = [r for r in results if isinstance(r, BaseException)]
    if failed:
        # the same SQL fails the same way on every hospital (same views); only then is a repair safe
        all_sql = len(failed) == len(results) and all(getattr(r, "sql_error", None) for r in failed)
        raise FederationError("; ".join(str(r) for r in failed), failed[0].sql_error if all_sql else None)
    return list(results)


async def run_stats(run_id: str, node_sql: str, on_done=None) -> list[dict]:
    return await _fan_out("/query", {"request_id": run_id, "sql": node_sql}, on_done)


async def run_cohort(run_id: str, sql: str, tables: list[str], loinc: list[str], spe_session: str,
                     ingest_tokens: dict[str, str], on_done=None) -> list[dict]:
    """Each hospital pushes its cohort records straight into the SPE session with its own one-time
    token; only counts come back here."""
    return await _fan_out("/cohort-export", lambda hospital: {
        "request_id": run_id, "sql": sql, "tables": tables, "observation_loinc": loinc,
        "spe_session": spe_session, "ingest_token": ingest_tokens[hospital]}, on_done)


async def health() -> list[dict]:
    async def one(hospital: str, url: str) -> dict:
        try:
            r = await _client.get(f"{url}/health", timeout=5)
            return {**r.json(), "up": r.status_code == 200}
        except httpx.HTTPError as e:
            return {"hospital": hospital, "up": False, "error": type(e).__name__}

    return list(await asyncio.gather(*(one(h, u) for h, u in settings.nodes.items())))


async def query_logs() -> dict[str, list]:
    async def one(hospital: str, url: str) -> tuple[str, list]:
        try:
            r = await _client.get(f"{url}/query-log", headers=_headers(), timeout=5)
            return hospital, r.json() if r.status_code == 200 else []
        except httpx.HTTPError:
            return hospital, []

    return dict(await asyncio.gather(*(one(h, u) for h, u in settings.nodes.items())))

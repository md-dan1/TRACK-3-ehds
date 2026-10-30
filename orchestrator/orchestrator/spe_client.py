"""Control calls to the SPE instance. The orchestrator creates and seals sessions and asks for launch
links; it gets session ids, ingest tokens (handed straight to the hospitals) and counts, never records."""

from __future__ import annotations

import datetime as dt

import httpx

from .config import settings

_client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))


class SpeError(RuntimeError):
    pass


async def _call(method: str, path: str, body: dict | None = None) -> dict:
    try:
        r = await _client.request(method, f"{settings.spe_url}{path}", json=body or {},
                                  headers={"X-Service-Token": settings.spe_service_token})
    except httpx.HTTPError as e:
        raise SpeError(f"secure processing environment unreachable ({type(e).__name__})") from None
    if r.status_code >= 300:
        raise SpeError(f"secure processing environment: HTTP {r.status_code} {r.text[:200]}")
    return r.json()


async def create_session(run_id: str, permit_id: str, tables: list[str], valid_until: dt.datetime) -> dict:
    """Empty session for one permit; returns {session_id, ingest_tokens: {hospital: token}}."""
    return await _call("POST", "/sessions", {"run_id": run_id, "permit_id": permit_id, "tables": tables,
                                     "hospitals": list(settings.nodes), "valid_until": valid_until.isoformat()})


async def seal(session_id: str) -> dict:
    """Closes ingestion; returns row counts per table and the cohort size."""
    return (await _call("POST", f"/sessions/{session_id}/seal"))["counts"]


async def launch(session_id: str) -> str:
    return (await _call("POST", f"/sessions/{session_id}/launch"))["url"]


async def end(session_id: str) -> None:
    """Removes the session's container and records at once."""
    await _call("DELETE", f"/sessions/{session_id}")

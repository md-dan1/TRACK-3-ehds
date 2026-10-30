"""Orchestrator database: request state, append-only audit log, LLM cache, benchmark."""

from __future__ import annotations

import json
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from .config import settings

pool = AsyncConnectionPool(settings.orchestrator_db_url, min_size=1, max_size=10, open=False,
                           kwargs={"row_factory": dict_row})


MIGRATION = """
CREATE TABLE IF NOT EXISTS users (
    id            serial PRIMARY KEY,
    role          text NOT NULL CHECK (role IN ('applicant', 'staff')),
    username      text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (role, username)
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id    integer NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS owner_id integer REFERENCES users;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
-- the export-review flow was removed; the SPE instance keeps records and models to itself
DROP TABLE IF EXISTS export_requests;
CREATE INDEX IF NOT EXISTS requests_owner_idx ON requests (owner_id, created_at DESC);
"""


async def migrate() -> None:
    """Idempotent schema changes, run at every start (fresh and existing databases)."""
    async with pool.connection() as conn:
        await conn.execute(MIGRATION)
        await conn.execute("DELETE FROM sessions WHERE expires_at < now()")
        # a benchmark runs in this process; one still "running" at start was cut off by a restart
        await conn.execute("UPDATE benchmarks SET status='interrupted' WHERE status='running'")


async def get_user(role: str, username: str) -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT * FROM users WHERE role=%s AND username=%s", (role, username))
        return await cur.fetchone()


async def upsert_user(role: str, username: str, display_name: str, password_hash: str | None) -> None:
    """Create or update an account. A new password hash also ends the account's open sessions."""
    async with pool.connection() as conn:
        if password_hash is None:
            await conn.execute("UPDATE users SET display_name=%s WHERE role=%s AND username=%s", (display_name, role, username))
            return
        await conn.execute("INSERT INTO users (role, username, display_name, password_hash) VALUES (%s,%s,%s,%s) "
                           "ON CONFLICT (role, username) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
                           "display_name = EXCLUDED.display_name", (role, username, display_name, password_hash))
        await conn.execute("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE role=%s AND username=%s)",
                           (role, username))


async def create_session(token_hash: str, user_id: int, hours: int) -> None:
    async with pool.connection() as conn:
        await conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s,%s, now() + make_interval(hours => %s))",
                           (token_hash, user_id, hours))


async def session_user(token_hash: str) -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT u.id, u.username, coalesce(u.display_name, u.username) AS display_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id "
                                 "WHERE s.token_hash=%s AND s.expires_at > now()", (token_hash,))
        return await cur.fetchone()


async def delete_session(token_hash: str) -> None:
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM sessions WHERE token_hash=%s", (token_hash,))


async def insert_request(run_id: str, reference: str | None, intake_mode: str, payload: dict, state: dict,
                         owner_id: int | None = None) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO requests (run_id, reference, intake_mode, status, payload, state, owner_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (run_id, reference, intake_mode, state["status"], Jsonb(payload), Jsonb(state), owner_id))


async def save_state(run_id: str, state: dict) -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE requests SET state=%s, status=%s, decision=%s, updated_at=now() WHERE run_id=%s",
            (Jsonb(state), state["status"], (state.get("decision") or {}).get("decision"), run_id))


async def get_request(run_id: str) -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT * FROM requests WHERE run_id=%s", (run_id,))
        return await cur.fetchone()


# the inbox and the dashboard read the same rows, so their counts always agree
LIST_LIMIT = 1000


async def list_requests(limit: int = LIST_LIMIT, owner_id: int | None = None) -> list[dict]:
    """All requests, or only one applicant's own (never their benchmark runs)."""
    where = "WHERE owner_id = %s AND intake_mode <> 'benchmark' " if owner_id is not None else ""
    params = (owner_id, limit) if owner_id is not None else (limit,)
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT run_id, reference, created_at, intake_mode, status, decision, payload, "
            "state->'decision' AS decision_detail, state->'timing' AS timing, state->'flags' AS flags, "
            f"state->'parent_run' AS parent_run FROM requests {where}ORDER BY created_at DESC LIMIT %s", params)
        return await cur.fetchall()


async def audit(run_id: str | None, actor: str, step: str, message: str = "", payload: dict | None = None,
                duration_ms: float | None = None, level: str = "info") -> None:
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO audit_log (run_id, actor, step, level, message, duration_ms, payload) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (run_id, actor, step, level, message, None if duration_ms is None else int(duration_ms),
             Jsonb(json.loads(json.dumps(payload or {}, default=str)))))


async def audit_events(run_id: str | None = None, step: str | None = None, q: str | None = None,
                       level: str | None = None, limit: int = 500, offset: int = 0) -> list[dict]:
    where, params = [], []
    if run_id:
        where.append("run_id = %s"); params.append(run_id)
    if step:
        where.append("step LIKE %s"); params.append(f"{step}%")
    if level:
        where.append("level = %s"); params.append(level)
    if q:
        where.append("(message ILIKE %s OR payload::text ILIKE %s)"); params += [f"%{q}%", f"%{q}%"]
    sql = "SELECT * FROM audit_log" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY id " + ("ASC" if run_id else "DESC") + " LIMIT %s OFFSET %s"
    async with pool.connection() as conn:
        cur = await conn.execute(sql, (*params, limit, offset))
        return await cur.fetchall()


async def cache_get(key: str) -> Any | None:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT response FROM llm_cache WHERE key=%s", (key,))
        row = await cur.fetchone()
        return row["response"] if row else None


async def cache_put(key: str, response: Any) -> None:
    async with pool.connection() as conn:
        await conn.execute("INSERT INTO llm_cache (key, response) VALUES (%s,%s) ON CONFLICT (key) DO UPDATE "
                           "SET response = EXCLUDED.response, created_at = now()", (key, Jsonb(response)))


async def count_audit(step: str) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT count(*) AS n FROM audit_log WHERE step=%s", (step,))
        return (await cur.fetchone())["n"]


async def save_benchmark(bid: str, status: str, report: dict) -> None:
    async with pool.connection() as conn:
        await conn.execute("INSERT INTO benchmarks (id, status, report) VALUES (%s,%s,%s) ON CONFLICT (id) DO UPDATE "
                           "SET status=EXCLUDED.status, report=EXCLUDED.report", (bid, status, Jsonb(report)))


async def delete_benchmarks() -> int:
    async with pool.connection() as conn:
        cur = await conn.execute("DELETE FROM benchmarks")
        return cur.rowcount


async def latest_benchmark() -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT * FROM benchmarks ORDER BY created_at DESC LIMIT 1")
        return await cur.fetchone()

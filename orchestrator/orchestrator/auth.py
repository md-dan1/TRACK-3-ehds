"""Authentication: separate applicant and staff accounts, scrypt password hashes, server-side
sessions in an HttpOnly cookie, role checks as FastAPI dependencies, and a login throttle."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict

from fastapi import Depends, HTTPException, Request

from . import db
from .config import settings

COOKIE = "ehds_session"
ROLES = ("applicant", "staff")
_N, _R, _P = 2**14, 8, 1
MAX_FAILURES, WINDOW_S = 5, 300
_failures: dict[tuple, list[float]] = defaultdict(list)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${key.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, key = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except ValueError:
        return False
    return hmac.compare_digest(got.hex(), key)


# a valid hash to compare against when the user does not exist, so timing does not reveal usernames
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def seed_users() -> None:
    """Accounts come from the environment (one per role); the stored hash follows the configured password."""
    accounts = {"applicant": (settings.applicant_username, settings.applicant_password, settings.applicant_display_name),
                "staff": (settings.staff_username, settings.staff_password, settings.staff_display_name)}
    for role, (username, password, display_name) in accounts.items():
        row = await db.get_user(role, username)
        if row is None or not verify_password(password, row["password_hash"]):
            await db.upsert_user(role, username, display_name, hash_password(password))
        elif row.get("display_name") != display_name:
            await db.upsert_user(role, username, display_name, None)


def actor(user: dict) -> str:
    """Name shown in the audit log and the header."""
    return user.get("display_name") or user["username"]


def throttled(key: tuple) -> bool:
    now = time.monotonic()
    _failures[key] = [t for t in _failures[key] if now - t < WINDOW_S]
    return len(_failures[key]) >= MAX_FAILURES


def record_failure(key: tuple) -> None:
    _failures[key].append(time.monotonic())


async def login(role: str, username: str, password: str, client: str) -> tuple[str, dict]:
    key = (client, role, username.lower())
    if throttled(key):
        raise HTTPException(429, "Too many failed sign-in attempts. Try again in a few minutes.")
    user = await db.get_user(role, username)
    ok = verify_password(password, user["password_hash"] if user else _DUMMY_HASH) and user is not None
    if not ok:
        record_failure(key)
        role_name = settings.applicant_display_name if role == "applicant" else settings.staff_display_name
        await db.audit(None, role_name, "auth.login_failed", f"failed sign-in for '{username}'", {"client": client}, level="warning")
        raise HTTPException(401, "Invalid username or password.")
    _failures.pop(key, None)
    token = secrets.token_urlsafe(32)
    await db.create_session(token_hash(token), user["id"], settings.session_hours)
    await db.audit(None, actor(user), "auth.login", f"{actor(user)} signed in", {"client": client})
    return token, {"id": user["id"], "username": user["username"], "role": user["role"],
                   "display_name": actor(user)}


async def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    user = await db.session_user(token_hash(token)) if token else None
    if user is None:
        raise HTTPException(401, "Not signed in.")
    return user


def require(*roles: str):
    async def dependency(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(403, "Not allowed for this account.")
        return user
    return dependency


any_user = require("applicant", "staff")
staff_only = require("staff")

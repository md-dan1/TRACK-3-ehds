"""SPE gateway: starts one container per session and is the only way into it.

Three callers, three kinds of credentials:
- orchestrator (service token): create a session (starts its container), seal it (counts only),
  get a one-time launch link
- hospitals (one-time ingest token per hospital): push their cohort patients and records
- researcher's browser (cookie from the launch link): everything else is proxied to the session's
  container, which publishes no port and answers only requests carrying its own secret

Sessions live in memory here; a session's container is removed after two minutes without activity."""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import hmac
import os
import secrets
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import docker
import httpx
from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from .store import COLUMNS

SERVICE_TOKEN = os.environ.get("SPE_SERVICE_TOKEN", "dev-spe-token")
PUBLIC_URL = os.environ.get("SPE_PUBLIC_URL", "http://localhost:8090").rstrip("/")
ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://orchestrator:8000").rstrip("/")
IMAGE = os.environ.get("SPE_IMAGE", "ehds-spe:latest")
NETWORK = os.environ.get("SPE_SESSION_NETWORK", "ehds-spe-sessions")
LABEL = "ehds.spe"
COOKIE = "spe_session"
IDLE = dt.timedelta(minutes=2)
EXPIRED = "This secure processing environment was closed after two minutes without activity."
# response headers passed back from a session container
PASS_HEADERS = ("content-type", "content-disposition", "cache-control")


@dataclass
class Session:
    id: str
    run_id: str
    permit_id: str
    tables: list[str]
    valid_until: dt.datetime
    secret: str
    sealed: bool = False
    counts: dict | None = None
    last_seen: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.UTC))

    @property
    def container(self) -> str:
        return f"ehds-spe-{self.id}"

    @property
    def url(self) -> str:
        return f"http://{self.container}:8000"

    def touch(self) -> None:
        self.last_seen = dt.datetime.now(dt.UTC)


@dataclass
class Token:
    kind: str  # ingest, launch or browser
    session_id: str
    hospital: str | None
    expires: dt.datetime


sessions: dict[str, Session] = {}
tokens: dict[str, Token] = {}  # by SHA-256 hash; the tokens themselves are never stored
_docker = docker.from_env()
_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token(session_id: str, kind: str, expires: dt.datetime, hospital: str | None = None) -> str:
    token = secrets.token_urlsafe(24)
    tokens[token_hash(token)] = Token(kind, session_id, hospital, expires)
    return token


def use_token(token: str, kind: str, session_id: str | None = None) -> tuple[Session, Token] | None:
    """Session for a valid token; ingest and launch tokens work once."""
    h = token_hash(token)
    t = tokens.get(h)
    if t is None or t.kind != kind or t.expires <= dt.datetime.now(dt.UTC) or (session_id and t.session_id != session_id):
        return None
    sess = sessions.get(t.session_id)
    if sess is None:
        return None
    if kind in ("ingest", "launch"):
        del tokens[h]
    sess.touch()
    return sess, t


def _remove_container(name: str) -> None:
    try:
        _docker.containers.get(name).remove(force=True)
    except docker.errors.NotFound:
        pass


async def _end(sess: Session) -> None:
    sessions.pop(sess.id, None)
    for h in [h for h, t in tokens.items() if t.session_id == sess.id]:
        del tokens[h]
    await asyncio.to_thread(_remove_container, sess.container)


async def _reaper() -> None:
    while True:
        await asyncio.sleep(15)
        now = dt.datetime.now(dt.UTC)
        for sess in list(sessions.values()):
            if now - sess.last_seen > IDLE or now >= sess.valid_until:
                await _end(sess)


def _remove_leftovers() -> None:
    """Containers from before a restart: their sessions are gone with the registry."""
    for c in _docker.containers.list(all=True, filters={"label": LABEL}):
        c.remove(force=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(_remove_leftovers)
    reaper = asyncio.create_task(_reaper())
    yield
    reaper.cancel()
    for sess in list(sessions.values()):
        await _end(sess)


app = FastAPI(title="EHDS secure processing environment", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def service(x_service_token: str | None = Header(None)) -> None:
    if not x_service_token or not hmac.compare_digest(x_service_token, SERVICE_TOKEN):
        raise HTTPException(401, "service token required")


async def _audit(run_id: str, step: str, message: str, payload: dict | None = None) -> None:
    """Report an event to the orchestrator's audit log: metadata only, never record content."""
    try:
        await _client.post(f"{ORCHESTRATOR_URL}/api/internal/audit", headers={"X-Service-Token": SERVICE_TOKEN},
                           json={"run_id": run_id, "step": step, "message": message, "payload": payload or {}})
    except httpx.HTTPError:
        pass  # the SPE keeps working when the audit sink is briefly down


async def _call(sess: Session, method: str, path: str, **kwargs) -> httpx.Response:
    try:
        return await _client.request(method, f"{sess.url}{path}", headers={"X-Gateway-Secret": sess.secret,
                                                                            **kwargs.pop("headers", {})}, **kwargs)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"session container unreachable ({type(e).__name__})") from None


# ---------- orchestrator ----------

class SessionIn(BaseModel):
    run_id: str
    permit_id: str
    tables: list[str]
    hospitals: list[str]
    valid_until: dt.datetime


def _start_container(sess: Session) -> None:
    _docker.containers.run(
        IMAGE, ["uvicorn", "spe_service.app:app", "--host", "0.0.0.0", "--port", "8000"],
        name=sess.container, network=NETWORK, labels={LABEL: sess.id}, detach=True,
        environment={"SPE_SECRET": sess.secret, "SPE_PERMIT_ID": sess.permit_id, "SPE_TABLES": ",".join(sess.tables),
                     "SPE_VALID_UNTIL": sess.valid_until.isoformat(), "SPE_GATEWAY_URL": "http://spe:8000"},
        mem_limit="512m", pids_limit=128, read_only=True, tmpfs={"/tmp": ""},
        cap_drop=["ALL"], security_opt=["no-new-privileges"])


@app.post("/sessions", dependencies=[Depends(service)])
async def create_session(body: SessionIn) -> dict:
    """Starts the session's own container; returns its id and one ingest token per hospital."""
    if not body.tables or set(body.tables) - set(COLUMNS):
        raise HTTPException(422, "unknown record type")
    sess = Session(secrets.token_hex(6), body.run_id, body.permit_id, body.tables, body.valid_until, secrets.token_urlsafe(32))
    try:
        await asyncio.to_thread(_start_container, sess)
    except docker.errors.DockerException as e:
        raise HTTPException(503, f"could not start the session container: {e}") from None
    sessions[sess.id] = sess
    for _ in range(100):
        try:
            if (await _client.get(f"{sess.url}/health", timeout=1)).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        await asyncio.sleep(0.2)
    else:
        await _end(sess)
        raise HTTPException(503, "session container did not start")
    sess.touch()
    expires = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=15)
    return {"session_id": sess.id, "ingest_tokens": {h: new_token(sess.id, "ingest", expires, h) for h in body.hospitals}}


def _live(session_id: str) -> Session:
    sess = sessions.get(session_id)
    if sess is None:
        raise HTTPException(404, EXPIRED)
    sess.touch()
    return sess


@app.post("/sessions/{session_id}/seal", dependencies=[Depends(service)])
async def seal(session_id: str) -> dict:
    """Close ingestion: remaining ingest tokens die; returns counts only."""
    sess = _live(session_id)
    for h in [h for h, t in tokens.items() if t.session_id == sess.id and t.kind == "ingest"]:
        del tokens[h]
    r = await _call(sess, "POST", "/seal")
    sess.sealed, sess.counts = True, r.json()["counts"]
    return {"counts": sess.counts}


@app.delete("/sessions/{session_id}", dependencies=[Depends(service)])
async def end_session(session_id: str) -> dict:
    """Removes the session's container and records at once."""
    if sess := sessions.get(session_id):
        await _end(sess)
    return {"ok": True}


@app.post("/sessions/{session_id}/launch", dependencies=[Depends(service)])
async def launch(session_id: str) -> dict:
    """A link that opens the training page once, within two minutes."""
    sess = _live(session_id)
    if not sess.sealed:
        raise HTTPException(404, "no ready session")
    code = new_token(sess.id, "launch", dt.datetime.now(dt.UTC) + dt.timedelta(minutes=2))
    return {"url": f"{PUBLIC_URL}/open?code={code}"}


# ---------- hospitals ----------

class IngestIn(BaseModel):
    patient_ids: list[str] = Field(max_length=100_000)
    tables: dict[str, dict]


@app.post("/sessions/{session_id}/ingest")
async def ingest(session_id: str, body: IngestIn, x_ingest_token: str | None = Header(None)) -> dict:
    found = use_token(x_ingest_token or "", "ingest", session_id)
    if found is None or found[0].sealed:
        raise HTTPException(401, "invalid or used ingest token")
    sess, t = found
    for name, table in body.tables.items():
        if name not in sess.tables or table.get("columns") != COLUMNS[name]:
            raise HTTPException(422, f"unexpected table {name}")
    r = await _call(sess, "POST", "/ingest", json=body.model_dump())
    if r.status_code >= 300:
        raise HTTPException(r.status_code, r.text[:200])
    return {"hospital": t.hospital, "counts": r.json()["counts"]}


# ---------- session containers ----------

class AuditIn(BaseModel):
    step: str
    message: str = ""
    payload: dict = {}


@app.post("/internal/audit")
async def relay_audit(body: AuditIn, x_gateway_secret: str | None = Header(None)) -> dict:
    """A container may only log for its own run: the secret identifies the session."""
    sess = next((s for s in sessions.values() if hmac.compare_digest(s.secret, x_gateway_secret or "")), None)
    if sess is None:
        raise HTTPException(401, "unknown session")
    await _audit(sess.run_id, body.step, body.message, body.payload)
    return {"ok": True}


# ---------- researcher ----------

@app.get("/open")
async def open_page(code: str) -> Response:
    found = use_token(code, "launch")
    if found is None:
        return HTMLResponse(_message("This link has expired or was already used. Open the environment again from your request page."), 401)
    sess, _ = found
    token = new_token(sess.id, "browser", sess.valid_until)
    await _audit(sess.run_id, "spe.opened", "secure processing environment opened")
    resp = HTMLResponse(_redirect_page())
    max_age = int((sess.valid_until - dt.datetime.now(dt.UTC)).total_seconds())
    resp.set_cookie(COOKIE, token, httponly=True, samesite="strict", max_age=max_age,
                    secure=PUBLIC_URL.startswith("https://"))
    return resp


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.api_route("/{path:path}", methods=["GET", "POST"])
async def proxy(path: str, request: Request, spe_session: str | None = Cookie(None)) -> Response:
    """The training page and its API, forwarded to the session's container."""
    if not (path == "" or path.startswith(("static/", "api/"))):
        raise HTTPException(404, "not found")
    found = use_token(spe_session or "", "browser")
    if found is None:
        text = EXPIRED if spe_session else "Open the secure processing environment from your request page."
        if path == "":
            return HTMLResponse(_message(text), 401)
        raise HTTPException(401, text)
    sess, _ = found
    r = await _call(sess, request.method, f"/{path}", params=request.query_params, content=await request.body(),
                    headers={"content-type": request.headers.get("content-type", "")})
    return Response(r.content, r.status_code, {k: r.headers[k] for k in PASS_HEADERS if k in r.headers})


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


def _message(text: str) -> str:
    return (f"<!doctype html><meta charset=utf-8><title>Secure processing environment</title>"
            f"<body style=\"font-family:system-ui;margin:4rem auto;max-width:36rem;color:#0f172a\">"
            f"<h1 style=\"font-size:1.25rem\">Secure processing environment</h1><p>{text}</p></body>")


# the web app's "working" sparkle (web/src/components/WorkingSparkle.tsx): same five frames, order and timing
_SPARKLE_FRAMES = [
    '<circle cx="12" cy="12" r="1.25" fill="currentColor"/>',
    '<path d="M12 8v8M8 12h8"/>',
    '<path d="M12 5v14M5 12h14M8.82 8.82l6.36 6.36M15.18 8.82l-6.36 6.36"/>',
    '<path d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>'
    '<path d="M20 3v4M22 5h-4M4 17v2M5 18H3"/>',
]


def _redirect_page(seconds: int = 3) -> str:
    """The web app's sky "working" panel with its sparkle, shown on the magic link, then on to the training page."""
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Secure processing environment</title>
<noscript><meta http-equiv="refresh" content="{seconds};url=/"></noscript>
<style>
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 0 16px; box-sizing: border-box; background: #f8fafc;
         font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }}
  .panel {{ display: flex; align-items: center; gap: 0.5rem; width: 100%; max-width: 28rem; box-sizing: border-box; padding: 0.75rem;
           border: 1px solid #7dd3fc; border-radius: 8px; background: #f0f9ff; color: #082f49; }}
  .panel svg {{ flex: none; width: 2rem; height: 2rem; margin: 0 0.75rem; color: #1e40af; }}
  .panel p {{ margin: 0; }}
  .title {{ font-weight: 500; }}
  .panel p + p {{ margin-top: 0.125rem; }}
</style>
<div class=panel role=status>
  <svg id=sparkle viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round aria-hidden=true>{_SPARKLE_FRAMES[4]}</svg>
  <div>
    <p class=title>Opening secure processing environment</p>
    <p>Redirecting in <span id=n>{seconds}</span>&hellip;</p>
  </div>
</div>
<script>
  // ping-pong from the full sparkle down to the seed and back; still (full sparkle) under reduced motion
  const FRAMES = {_SPARKLE_FRAMES!r}, ORDER = [4, 3, 2, 1, 0, 1, 2, 3], HOLD_MS = [320, 150, 150, 150, 480];
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {{
    const svg = document.getElementById("sparkle");
    let step = 0;
    (function next() {{
      svg.innerHTML = FRAMES[ORDER[step]];
      setTimeout(() => {{ step = (step + 1) % ORDER.length; next(); }}, HOLD_MS[ORDER[step]]);
    }})();
  }}
  let n = {seconds};
  const tick = setInterval(() => {{
    document.getElementById("n").textContent = --n;
    if (n <= 0) {{ clearInterval(tick); location.replace("/"); }}
  }}, 1000);
</script>"""

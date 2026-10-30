"""Secure processing environment (SPE) session container: one per session, records in memory only.

It publishes no port and answers only requests that carry its gateway secret (gateway.py starts it,
holds the secret and is the only way in). Two kinds of calls arrive through the gateway:
- ingest and seal: the hospitals' cohort records, then the counts
- the researcher's browser: the training page, statistics, fit a restricted model,
  run it on typed-in values, download the fitted model

No endpoint returns a record."""

from __future__ import annotations

import asyncio
import hmac
import os
import secrets
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analysis, store

SECRET = os.environ.get("SPE_SECRET", "")
PERMIT_ID = os.environ.get("SPE_PERMIT_ID", "")
VALID_UNTIL = os.environ.get("SPE_VALID_UNTIL", "")
GATEWAY_URL = os.environ.get("SPE_GATEWAY_URL", "http://spe:8000").rstrip("/")
STATIC = Path(__file__).parent / "static"

store.init([t for t in os.environ.get("SPE_TABLES", "").split(",") if t])

# derived features and the fitted models live in memory only
_features: list[analysis.Feature] | None = None
# fitted models by model id: two tabs of one session can fit and run side by side
_fitted: dict[str, analysis.Fitted] = {}
MODELS_KEPT = 20  # the oldest is dropped


def _model(model_id: str) -> analysis.Fitted:
    fitted = _fitted.get(model_id)
    if fitted is None:
        raise HTTPException(404, "This model is no longer available. Fit it again.")
    return fitted

app = FastAPI(title="EHDS secure processing environment", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")
_client = httpx.AsyncClient(timeout=10)


@app.middleware("http")
async def gateway_only(request: Request, call_next):
    """Everything but the health check needs the secret only the gateway knows."""
    if request.url.path != "/health":
        given = request.headers.get("x-gateway-secret", "")
        if not SECRET or not hmac.compare_digest(given, SECRET):
            return JSONResponse({"detail": "gateway secret required"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    """Browsers ask again for the page's script and styles, so a redeploy shows at once."""
    resp = await call_next(request)
    if request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


async def _audit(step: str, message: str, payload: dict | None = None) -> None:
    """Report an event through the gateway to the audit log: metadata only, never record content."""
    try:
        await _client.post(f"{GATEWAY_URL}/internal/audit", headers={"X-Gateway-Secret": SECRET},
                           json={"step": step, "message": message, "payload": payload or {}})
    except httpx.HTTPError:
        pass  # the SPE keeps working when the audit sink is briefly down


# ---------- hospitals (checked and forwarded by the gateway) ----------

class IngestIn(BaseModel):
    patient_ids: list[str] = Field(max_length=100_000)
    tables: dict[str, dict]


@app.post("/ingest")
async def ingest(body: IngestIn) -> dict:
    if store.sealed:
        raise HTTPException(409, "session is sealed")
    return {"counts": store.ingest(body.patient_ids, body.tables)}


@app.post("/seal")
async def seal() -> dict:
    return {"counts": store.seal()}


# ---------- researcher ----------

@app.get("/")
async def page():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


async def _feats() -> list[analysis.Feature]:
    global _features
    if _features is None:
        cohort, tables, _ = store.load()
        _features = await asyncio.to_thread(analysis.features, cohort, tables)
    return _features


@app.get("/api/session")
async def session_info() -> dict:
    return {"permit_id": PERMIT_ID, "valid_until": VALID_UNTIL, "counts": store.counts()}


@app.get("/api/statistics")
async def statistics() -> list[dict]:
    _, tables, _ = store.load()
    return await asyncio.to_thread(analysis.statistics, tables)


@app.get("/api/variables")
async def variables() -> dict:
    feats = await _feats()
    return {"variables": [{"key": f.key, "label": f.label, "kind": f.kind} for f in feats],
            "models": [{"key": k, "label": m["label"], "target": m["target"]} for k, m in analysis.MODELS.items()]}


class FitIn(BaseModel):
    model: str
    x: list[str]
    y: str


@app.post("/api/fit")
async def fit(body: FitIn) -> dict:
    feats = await _feats()
    try:
        fitted, result = await asyncio.to_thread(analysis.fit, feats, body.model, body.x, body.y)
    except analysis.AnalysisError as e:
        raise HTTPException(422, str(e)) from None
    model_id = secrets.token_hex(4)
    _fitted[model_id] = fitted
    while len(_fitted) > MODELS_KEPT:
        _fitted.pop(next(iter(_fitted)))
    await _audit("spe.model_fit", f"{result['model']}: {body.y} from {', '.join(body.x)}",
                 {"model": body.model, "x": body.x, "y": body.y, "n_train": result["n_train"], "metrics": result["metrics"]})
    return {**result, "model_id": model_id, "runs_left": fitted.predictions_left}


class RunIn(BaseModel):
    model_id: str
    inputs: dict[str, float]


@app.post("/api/run")
async def run(body: RunIn) -> dict:
    fitted = _model(body.model_id)
    try:
        out = analysis.predict(await _feats(), fitted, body.inputs)
    except analysis.AnalysisError as e:
        raise HTTPException(422, str(e)) from None
    await _audit("spe.model_run", f"model run, {out['runs_left']} runs left", {"model": fitted.model_key})
    return out


@app.get("/api/model.{fmt}")
async def download_model(fmt: str, model_id: str) -> Response:
    """The fitted model's weights as a file; never any record."""
    fitted = _model(model_id)
    try:
        data = analysis.export(fitted, fmt)
    except analysis.AnalysisError as e:
        raise HTTPException(404, str(e)) from None
    await _audit("spe.model_export", f"model downloaded as {fmt}", {"model": fitted.model_key, "format": fmt})
    filename = fitted.model_key + analysis.EXPORT_FORMATS[fmt]
    return Response(data, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

"""OpenAI-compatible LLM client (OpenRouter by default). Only request text is ever sent.

score heads: one token at temperature 0 with logprobs; the labels are read from top_logprobs by their
text. The exp-sum over the labels is the probability mass the model itself put on them ("label mass").
Remote providers (OPENROUTER, LOGPROB_LLM_PROVIDER_API) get reasoning off and 5 alternatives: gpt-5.6
returns no logprobs otherwise, and a higher top_logprobs comes back empty."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import time
from dataclasses import dataclass, field

import httpx

from . import db
from .config import settings


class LLMError(RuntimeError):
    pass


@dataclass
class Usage:
    calls: int = 0
    cached: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    ms: float = 0.0
    log: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"calls": self.calls, "cache_hits": self.cached, "prompt_tokens": self.prompt_tokens,
                "completion_tokens": self.completion_tokens, "ms": round(self.ms)}


_client = httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=10.0))


MAX_TRIES = 6

# Remote providers sometimes stall a call that normally takes 1-5 s for a minute. A call still
# unanswered after HEDGE_AFTER seconds is sent again (at most HEDGE_COPIES in flight) and the first
# reply wins. Not for a local llama.cpp, where a second copy only competes for the same GPU.
HEDGE_AFTER = 5.0
HEDGE_COPIES = 3


async def _send(body: dict) -> httpx.Response:
    def send():
        return _client.post(_completions_url(), json=body,
                            headers={"Authorization": f"Bearer {settings.llm_api_key}"})

    if settings.endpoint_type not in ("OPENROUTER", "LOGPROB_LLM_PROVIDER_API"):
        return await send()
    tasks = [asyncio.create_task(send())]
    try:
        while True:
            wait = HEDGE_AFTER if len(tasks) < HEDGE_COPIES else None
            done, _ = await asyncio.wait(tasks, timeout=wait, return_when=asyncio.FIRST_COMPLETED)
            if done:
                return done.pop().result()
            tasks.append(asyncio.create_task(send()))
    finally:
        for t in tasks:
            t.cancel()


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return float(r.headers.get("retry-after", ""))
    except ValueError:
        return None


def _completions_url() -> str:
    """llama.cpp is called at <base>/v1/chat/completions; a base that already ends in /v1 (OpenRouter) is used as-is."""
    base = settings.llm_base_url.rstrip("/")
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


async def _post(body: dict, usage: Usage, use_cache: bool, purpose: str) -> dict:
    key = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    t0 = time.perf_counter()
    if use_cache and (hit := await db.cache_get(key)) is not None:
        usage.cached += 1
        usage.log.append({"purpose": purpose, "model": body["model"], "cached": True, "ms": 0})
        return hit
    last = None
    for attempt in range(MAX_TRIES):
        try:
            r = await _send(body)
        except httpx.HTTPError as e:
            last = f"{type(e).__name__}"
        else:
            if r.status_code < 300:
                payload = r.json()
                break
            last = f"HTTP {r.status_code}"
            if r.status_code < 500 and r.status_code not in (408, 409, 425, 429):
                raise LLMError(f"LLM refused the call ({last}): {r.text[:200]}")
            if r.status_code == 429:
                # rate limited: wait as long as the provider asks, else back off
                await asyncio.sleep(min(30.0, _retry_after(r) or 2.0 * (2 ** attempt)))
                continue
        await asyncio.sleep(0.5 * (2 ** attempt))
    else:
        raise LLMError(f"LLM unavailable after retries ({last})")
    ms = (time.perf_counter() - t0) * 1000
    u = payload.get("usage") or {}
    usage.calls += 1
    usage.ms += ms
    usage.prompt_tokens += int(u.get("prompt_tokens") or 0)
    usage.completion_tokens += int(u.get("completion_tokens") or 0)
    usage.log.append({"purpose": purpose, "model": body["model"], "cached": False, "ms": round(ms),
                      "prompt_tokens": u.get("prompt_tokens"), "completion_tokens": u.get("completion_tokens")})
    # An empty logprob reply is a provider miss, not an answer. Caching it makes every retry fail.
    if not (body.get("logprobs") and not _logprob_tokens(payload)):
        await db.cache_put(key, payload)
    return payload


def _logprob_tokens(payload: dict) -> list:
    choices = payload.get("choices") or []
    if not choices:
        return []
    return ((choices[0].get("logprobs") or {}).get("content")) or []


def _messages(system: str, user: str) -> list[dict]:
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _routing(body: dict) -> dict:
    """Remote providers: reasoning off, 5 alternatives (gpt-5.6 returns no logprobs otherwise, and none
    with more alternatives)."""
    if settings.endpoint_type in ("OPENROUTER", "LOGPROB_LLM_PROVIDER_API"):
        body["reasoning_effort"] = "none"
        if "top_logprobs" in body:
            body["top_logprobs"] = 5
    return body


# OpenRouter models whose default hosts return no logprobs (most hosts of small open models). Their
# scoring calls go to a host that supports every parameter sent; learned on the first empty reply.
_logprob_route: set[str] = set()


def _to_logprob_host(body: dict) -> dict:
    # reasoning_effort is dropped: non-reasoning hosts do not list it, and require_parameters would
    # then leave no host at all
    routed = {k: v for k, v in body.items() if k != "reasoning_effort"}
    routed["provider"] = {"require_parameters": True}
    return routed


async def score(system: str, user: str, labels: list[str], usage: Usage, use_cache: bool,
                purpose: str) -> dict:
    """Probability over a restricted set of single-token answers, e.g. ["yes", "no"]."""
    body = _routing({
        "model": settings.llm_score_model, "temperature": 0, "max_tokens": 1,
        "logprobs": True, "top_logprobs": 20,
        "messages": _messages(system, user),
    })
    model = body["model"]
    if model in _logprob_route:
        body = _to_logprob_host(body)
    payload = await _post(body, usage, use_cache, purpose)
    content = _logprob_tokens(payload)
    # parallel heads may all miss before the route is learned, so check the body, not the set
    if not content and settings.endpoint_type == "OPENROUTER" and "provider" not in body:
        _logprob_route.add(model)
        body = _to_logprob_host(body)
        payload = await _post(body, usage, use_cache, purpose)
        content = _logprob_tokens(payload)
    if not content:
        payload = await _post(body, usage, False, purpose)
        content = _logprob_tokens(payload)
    if not content:
        raise LLMError("the scoring model returned no logprobs")
    first = content[0]
    cands = {first["token"]: first["logprob"]}
    for t in first.get("top_logprobs") or []:
        cands[t["token"]] = max(t["logprob"], cands.get(t["token"], -math.inf))
    # "No" and " no" are other tokens than "no" but the same answer: sum the variants.
    mass = _masses(labels, cands)
    z = sum(mass.values())
    return {"probs": {k: v / z for k, v in mass.items()},
            "logprobs": {k: math.log(v) for k, v in mass.items()}, "label_mass": z}


def _masses(labels: list[str], cands: dict[str, float]) -> dict[str, float]:
    """Mass per label. A label the provider did not return keeps only the leftover probability.

    Azure often sends a single alternative. Treating a missing 'yes' as equally likely as that
    token ties the head at 0.5, and the legal check then rejects a confident 'no'."""
    forms = {label: _variants(label) for label in labels}
    masses: dict[str, float] = {}
    for label, variants in forms.items():
        found = [cands[v] for v in variants if v in cands]
        if found:
            masses[label] = sum(math.exp(v) for v in found)
    if len(masses) == len(labels):
        return masses
    known = {variant for variants in forms.values() for variant in variants}
    other = [math.exp(v) for tok, v in cands.items() if tok not in known and math.isfinite(v)]
    missing = [label for label in labels if label not in masses]
    # A reported logprob of 0 means the chosen label took all the mass. The others still need a
    # positive amount, because the caller takes a logarithm.
    leftover = max(1e-12, 1.0 - sum(masses.values()))
    bound = max(1e-12, min(other) if other else leftover / len(missing))
    for label in missing:
        masses[label] = bound
    return masses


def _variants(label: str) -> list[str]:
    forms = {label, label.lower(), label.capitalize(), label.upper()}
    return list(forms | {f" {f}" for f in forms})


async def text(system: str, user: str, usage: Usage, use_cache: bool, purpose: str,
               schema: dict | None = None, max_tokens: int = 2048) -> str:
    body = _routing({
        "model": settings.llm_text_model, "temperature": 0, "max_tokens": max_tokens,
        "messages": _messages(system, user),
    })
    if schema is not None:
        body["response_format"] = {"type": "json_schema",
                                   # OpenAI/Azure accept only letters, digits, _ and - in the name
                                   "json_schema": {"name": re.sub(r"[^A-Za-z0-9_-]", "_", purpose), "strict": True, "schema": schema}}
    payload = await _post(body, usage, use_cache, purpose)
    return (payload["choices"][0].get("message") or {}).get("content") or ""


async def json_out(system: str, user: str, schema: dict, usage: Usage, use_cache: bool, purpose: str) -> dict:
    raw = await text(system, user, usage, use_cache, purpose, schema=schema)
    raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        raise LLMError(f"LLM answer is not JSON: {e}") from None

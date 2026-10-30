"""Decision: two yes/no logprob heads, combined in the legal order of the README.

  head art54  P(purpose prohibited under Art. 54)                      -> REJECT if >= 0.5
  head need   P(applicant justifies why statistics are not enough)     -> only for access applications
  P(REJECT) = p54,  P(SPE) = (1 - p54) * p_need,  P(STAT) = the rest

A health data request can never get an SPE (masked). Articles come from a fixed table."""

from __future__ import annotations

import asyncio
import json
import math
import re

from ehds_core.articles import (APPROVE_SPE, APPROVE_STATISTICAL, ARTICLES, ART54_CATEGORIES, REJECT,
                                articles_for)
from ehds_core.schema import DataRequest

from . import llm
from . import prompts as P
from .config import settings

REVIEW_ART54 = (0.1, 0.6)   # measured: allowed purposes <= 0.004, prohibited >= 0.65
REVIEW_NEED = (0.2, 0.8)
LOW_MASS = 0.6              # measured ~0.85-0.9 on yes/no; the rest is the model starting a sentence


def _user(req: DataRequest) -> str:
    return json.dumps(req.llm_view(), ensure_ascii=False, indent=1)


YES_NO = ["yes", "no"]
LETTERS = ["A", "B", "C", "D", "E"]  # Art. 54 categories, one letter each


def combine(p54: float, p_need: float | None) -> dict[str, float]:
    p_need = p_need or 0.0
    return {REJECT: p54, APPROVE_STATISTICAL: (1 - p54) * (1 - p_need), APPROVE_SPE: (1 - p54) * p_need}


def choose(p54: float, p_need: float | None) -> str:
    if p54 >= 0.5:
        return REJECT
    if p_need is not None and p_need >= 0.5:
        return APPROVE_SPE
    return APPROVE_STATISTICAL


def _fallback_reason(decision: str, req: DataRequest, category: str) -> dict:
    if decision == REJECT:
        text = f"Your request is rejected because its purpose falls under the prohibited uses of Art. 54 ({category.lower()})."
    elif decision == APPROVE_SPE:
        text = ("Your purpose is allowed (Art. 53) and you explained why individual-level data is needed, so pseudonymised "
                "data is justified (Art. 66). You get access under a data permit inside a secure processing environment (Art. 68, 73).")
    elif req.is_application:
        text = ("Your purpose is allowed (Art. 53). Statistics answer your question, so pseudonymised records are not justified "
                "(Art. 66); we approved anonymised statistics instead (Art. 69).")
    else:
        text = "Your purpose is allowed (Art. 53) and anonymised statistics answer your question (Art. 69)."
    return {"applicant": text, "staff": "", "generated": False}


async def _reason(decision: str, articles: list[str], req: DataRequest, category: str, usage: llm.Usage,
                  use_cache: bool) -> dict:
    facts = {
        "decision": decision,
        "articles": {a: ARTICLES[a] for a in articles},
        "requested_as": req.requested_as,
        "downgraded_to_statistics": decision == APPROVE_STATISTICAL and req.is_application,
        "art54_category": category if decision == REJECT else None,
        "applicant": req.applicant.organisation,
        "purpose": req.purpose,
        "question": req.question,
    }
    try:
        out = await llm.json_out(P.REASON, json.dumps(facts, ensure_ascii=False, indent=1), P.REASON_SCHEMA,
                                 usage, use_cache, "reason")
        return {"applicant": out["applicant_reason"].strip(), "staff": out["staff_note"].strip(), "generated": True}
    except llm.LLMError:
        return _fallback_reason(decision, req, category)


async def decide(req: DataRequest, usage: llm.Usage, use_cache: bool, forced: str | None = None) -> dict:
    user = _user(req)
    jobs = [llm.score(P.ART54, user, YES_NO, usage, use_cache, "decision: art54"),
            llm.score(P.CATEGORY, user, LETTERS, usage, use_cache, "decision: art54 category")]
    if req.is_application:
        jobs.append(llm.score(P.NEED, user, YES_NO, usage, use_cache, "decision: need for records"))
    results = await asyncio.gather(*jobs)
    h54, cat = results[0], results[1]
    need = results[2] if req.is_application else None
    p54 = h54["probs"]["yes"]
    p_need = need["probs"]["yes"] if need else None

    probs = combine(p54, p_need)
    allowed = [REJECT, APPROVE_STATISTICAL] + ([APPROVE_SPE] if req.is_application else [])
    model_decision = choose(p54, p_need)
    decision = forced or model_decision
    articles = articles_for(decision, req.is_application)

    pv = sorted((probs[d] for d in allowed), reverse=True)
    entropy = -sum(p * math.log(p) for p in pv if p > 0) / math.log(len(allowed))
    cat_probs = {ART54_CATEGORIES[k]: v for k, v in cat["probs"].items()}
    category = max(cat_probs, key=cat_probs.get)

    flags = []
    if REVIEW_ART54[0] < p54 < REVIEW_ART54[1]:
        flags.append("borderline Art. 54 score")
    if p_need is not None and REVIEW_NEED[0] < p_need < REVIEW_NEED[1]:
        flags.append("borderline need for records")
    if min(h54["label_mass"], need["label_mass"] if need else 1.0) < LOW_MASS:
        flags.append("low label mass")
    if forced and forced != model_decision:
        flags.append("staff override")

    reason = await _reason(decision, articles, req, category, usage, use_cache)
    return {
        "decision": decision,
        "model_decision": model_decision,
        "articles": articles,
        "articles_detail": [{"id": a, "title": ARTICLES[a]} for a in articles],
        "probabilities": probs,
        "masked": [] if req.is_application else [APPROVE_SPE],
        "heads": {
            "art54": {"p_yes": p54, "label_mass": h54["label_mass"], "logprobs": h54["logprobs"]},
            "need_for_records": None if need is None else
            {"p_yes": p_need, "label_mass": need["label_mass"], "logprobs": need["logprobs"]},
            "category": {"probs": cat_probs, "top": category, "label_mass": cat["label_mass"]},
        },
        "margin": pv[0] - pv[1],
        "entropy": entropy,
        "flags": flags,
        "downgraded": decision == APPROVE_STATISTICAL and req.is_application,
        "reason": reason,
        "model": settings.llm_score_model,
        "prompt_version": P.PROMPT_VERSION,
    }


def _units(req: DataRequest) -> list[tuple[str, str]]:
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", req.purpose.strip()) if s]
    return [("purpose", s) for s in sentences] + [("question", req.question)]


async def attribution(req: DataRequest, base: dict, usage: llm.Usage, use_cache: bool) -> list[dict]:
    """Leave one sentence out, re-score the heads: how much each sentence pushed the decision."""
    sem = asyncio.Semaphore(4)

    async def one(field: str, sentence: str) -> dict:
        data = req.model_copy(deep=True)
        if field == "purpose":
            data.purpose = req.purpose.replace(sentence, "").strip() or "(no purpose given)"
        else:
            data.question = "(no question given)"
        async with sem:
            h54 = await llm.score(P.ART54, _user(data), YES_NO, usage, use_cache, "attribution: art54")
            need = None
            if req.is_application:
                need = await llm.score(P.NEED, _user(data), YES_NO, usage, use_cache, "attribution: need")
        out = {"field": field, "sentence": sentence,
               "delta_art54": base["heads"]["art54"]["p_yes"] - h54["probs"]["yes"]}
        if need is not None:
            out["delta_need"] = base["heads"]["need_for_records"]["p_yes"] - need["probs"]["yes"]
        return out

    return list(await asyncio.gather(*(one(f, s) for f, s in _units(req))))

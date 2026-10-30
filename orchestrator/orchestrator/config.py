import json
import os
from dataclasses import dataclass, field
from pathlib import Path


def _read_key() -> str:
    """Key from the mounted secret file (LLM_API_KEY_PATH), else from LLM_API_KEY in .env."""
    path = Path(os.environ.get("LLM_API_KEY_FILE", "/run/secrets/llm_api_key"))
    key = path.read_text().strip() if path.is_file() else ""
    return key or os.environ.get("LLM_API_KEY", "").strip()


# Every type speaks the OpenAI chat format and must return logprobs; the scoring labels are read from
# top_logprobs by their text.
# OPENROUTER: OpenRouter, qwen/qwen3.8-27b; reasoning off. Scoring calls fall back to providers that
# return logprobs.
# LOGPROB_LLM_PROVIDER_API: any other OpenAI-format API that returns logprobs; reasoning off, no fallback.
# LOCAL_LLM: the local-llm container (llama.cpp server with a GGUF from ./models), plain requests.
# Per type: (base URL, score model, text model), used when .env leaves them empty.
ENDPOINT_DEFAULTS = {
    "OPENROUTER": ("https://openrouter.ai/api/v1", "qwen/qwen3.8-27b", "qwen/qwen3.8-27b"),
    "LOGPROB_LLM_PROVIDER_API": ("https://api.openai.com", "gpt-4o-mini", "gpt-4o-mini"),
    "LOCAL_LLM": ("http://local-llm:8080", "local", "local"),
}


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _endpoint_type() -> str:
    value = (_env("ENDPOINT_TYPE") or "OPENROUTER").upper()
    if value not in ENDPOINT_DEFAULTS:
        raise ValueError(f"ENDPOINT_TYPE must be one of {', '.join(ENDPOINT_DEFAULTS)}, got {value!r}")
    return value


def _endpoint(i: int, name: str):
    return lambda: _env(name) or ENDPOINT_DEFAULTS[_endpoint_type()][i]


@dataclass(frozen=True)
class Settings:
    endpoint_type: str = field(default_factory=_endpoint_type)
    llm_base_url: str = field(default_factory=_endpoint(0, "LLM_BASE_URL"))
    llm_api_key: str = field(default_factory=_read_key, repr=False)
    llm_score_model: str = field(default_factory=_endpoint(1, "LLM_SCORE_MODEL"))
    llm_text_model: str = field(default_factory=_endpoint(2, "LLM_TEXT_MODEL"))
    orchestrator_db_url: str = os.environ.get("ORCHESTRATOR_DB_URL", "postgresql://orchestrator:orchestrator@localhost:5440/orchestrator")
    # SPE instance: control API (sessions, counts, launch links); it holds the records, not the orchestrator
    spe_url: str = os.environ.get("SPE_URL", "http://localhost:8090").rstrip("/")
    spe_service_token: str = field(default_factory=lambda: os.environ.get("SPE_SERVICE_TOKEN", "dev-spe-token"), repr=False)
    nodes: dict = field(default_factory=lambda: json.loads(os.environ.get("NODES", json.dumps({
        "Klinikum Nord": "http://localhost:8101",
        "Klinikum Süd": "http://localhost:8102",
        "Klinikum West": "http://localhost:8103",
    }))))
    node_token: str = os.environ.get("NODE_TOKEN", "dev-node-token")
    # one account per role; change these outside a demo
    applicant_username: str = os.environ.get("APPLICANT_USERNAME", "admin")
    applicant_password: str = field(default_factory=lambda: os.environ.get("APPLICANT_PASSWORD", "password"), repr=False)
    staff_username: str = os.environ.get("STAFF_USERNAME", "admin")
    staff_password: str = field(default_factory=lambda: os.environ.get("STAFF_PASSWORD", "password"), repr=False)
    applicant_display_name: str = os.environ.get("APPLICANT_DISPLAY_NAME", "Researcher")
    staff_display_name: str = os.environ.get("STAFF_DISPLAY_NAME", "Clinic")
    session_hours: int = int(os.environ.get("SESSION_HOURS", "8"))
    cookie_secure: bool = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    requests_dir: str = os.environ.get("REQUESTS_DIR", "requests")
    expected_file: str = os.environ.get("EXPECTED_FILE", "requests/expected.json")


settings = Settings()

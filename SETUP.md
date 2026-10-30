# Setup

Everything runs in Docker: 3 hospital DBs, 3 hospital services, orchestrator API, SPE gateway (starts one container per SPE session), orchestrator DB, web app.
Plus one LLM: OpenRouter (default), another logprob API, or a local Qwen model. uv only needed for metrics script and unit tests.

## 1. Install

| Tool | Why | macOS (Homebrew) |
|---|---|---|
| Docker Desktop (Compose v2) | runs the app | `brew install --cask docker` |
| git | get the code | `brew install git` |
| uv (optional) | metrics script, unit tests | `brew install uv` |

Linux: Docker Engine + Compose plugin from docs.docker.com, uv via `curl -LsSf https://astral.sh/uv/install.sh | sh`.

Start Docker Desktop once after install.

## 2. Get code

```bash
git clone <repo-url>
cd TRACK-3-ehds
```

## 3. LLM in .env

```bash
cp .env.example .env
```

Pick one `ENDPOINT_TYPE` in `.env`:

| `ENDPOINT_TYPE` | What | Set in `.env` |
|---|---|---|
| `OPENROUTER` (default) | OpenRouter, `qwen/qwen3.8-27b` | `LLM_API_KEY` |
| `LOGPROB_LLM_PROVIDER_API` | any OpenAI-format API that returns logprobs (OpenAI, vLLM, ...) | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_SCORE_MODEL`, `LLM_TEXT_MODEL` |
| `LOCAL_LLM` | Qwen on own machine. Free, no key | `COMPOSE_PROFILES=local`, model file (see below) |

Endpoint and key:

- `LLM_BASE_URL`: base URL of inference endpoint. A base ending in `/v1` is called as `<base>/chat/completions`, any other as `<base>/v1/chat/completions`.
  Empty = default of type: OpenRouter `https://openrouter.ai/api/v1`, provider `https://api.openai.com`, local `http://local-llm:8080`.
- `LLM_API_KEY`: API key, pasted into `.env`. Or keep key out of `.env`: leave empty, set `LLM_API_KEY_PATH=/path/to/key_file` (file holds only the key).
- Provider must support chat completions with `logprobs` + `top_logprobs` and `json_schema` response format. Models without logprobs (reasoning models) do not work.

`.env` is gitignored. Never commit it. Only request text goes to the LLM.

### Local LLM

Model: Qwen2.5-3B-Instruct, GGUF Q4_K_M, 2.1 GB.
Page: [huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF) (license: Qwen Research License, see page).

```bash
mkdir -p models
curl -L -o models/qwen2.5-3b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf
```

Then pick how to run it.

Mac (fast, Metal GPU, recommended):

```bash
brew install llama.cpp
llama-server -m models/qwen2.5-3b-instruct-q4_k_m.gguf --host 127.0.0.1 --port 8081 -c 16384 --parallel 2 --jinja -ngl 99
```

In `.env`:

```
ENDPOINT_TYPE=LOCAL_LLM
LLM_BASE_URL=http://host.docker.internal:8081
```

Linux or no Homebrew (container, CPU only, very slow on a Mac):

```
ENDPOINT_TYPE=LOCAL_LLM
COMPOSE_PROFILES=local
```

Starts extra container `local-llm` (llama.cpp server, internal network only).

Much weaker than the hosted models: see local results in [SOLUTION.md](SOLUTION.md). Other GGUF model: put file in `models/`,
point `llama-server -m` at it, or for the container set `LOCAL_MODEL_FILE=<file name>`.

## 4. Start

```bash
docker compose up -d --build
docker compose ps
```

First start builds images and loads CSVs into the 3 hospital DBs. Takes a few minutes.
Ready when all containers run (10, or 11 with local LLM; plus one per open SPE session) and the DBs show `healthy`.

## 5. Open

| What | Link |
|---|---|
| App | [http://localhost:8080](http://localhost:8080) |
| API docs | [http://localhost:8000/docs](http://localhost:8000/docs) |
| SPE instance | [http://localhost:8090](http://localhost:8090), opens from an approved records request (one-time link) |

Sign in: pick tab on login page, then:

| Tab | Username | Password | Lands on |
|---|---|---|---|
| Researcher | `admin` | `password` | New request |
| Clinic | `admin` | `password` | Dashboard |

Change accounts in `.env` (`APPLICANT_*`, `STAFF_*`), then `docker compose up -d`.

## 6. Metrics and tests (optional)

```bash
uv sync                                                              # Python deps from pyproject.toml
uv run pytest                                                        # unit tests, no Docker, no LLM
uv run python eval/run_eval.py                                       # 10 requests x 3 runs, writes eval/RESULTS_<endpoint>.md
```

`eval/run_eval.py` needs the app running (API on port 8000), signs in as Clinic.
Same metrics in app: Clinic, tab Benchmark, "Run benchmark".

## 7. Stop

```bash
docker compose stop      # pause, data kept
docker compose down -v   # remove everything, next start fresh from CSVs
```

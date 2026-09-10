# Backend

FastAPI backend for the YouTube contextual language learning extension.

## Code Layout

- `main.py` creates the app, configures CORS, and registers routers.
- `config.py` loads `.env` and provides shared settings.
- `errors.py` provides API error helpers.
- `diagnostics.py` builds request timing diagnostics.
- `routes/chat.py` contains the chat route, models, prompt, and Gemini call.
- `routes/translate.py` contains the quick translate route, models, prompt, and parsing.
- `routes/system.py` contains service status, health, debug, and test routes.

Keep feature-specific models and helpers beside their routes. Shared modules
should not import route modules or `main.py`.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`. Chat uses `GEMINI_CHAT_MODEL`, caption breakdowns
use `GEMINI_LEARNING_MODEL`, and both default to `gemini-3.5-flash-lite`.
`GEMINI_THINKING_LEVEL` defaults to `minimal` for lower-latency sidebar requests.

## Run

```bash
source .venv/bin/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Test Endpoints

- `GET /` - service status and docs link
- `GET /api/health` - health check with UTC timestamp
- `GET /api/debug/config` - non-secret backend config diagnostics
- `GET /api/test/ping` - returns `pong`
- `POST /api/chat` - Gemini chat response for the extension sidebar
- `POST /api/translate/learning` - Gemini caption translation with a learning breakdown
- `POST /api/test/echo` - echoes a JSON payload
- `POST /api/test/explain` - placeholder contextual explanation response

Interactive API docs are available at `http://127.0.0.1:8000/docs` while the server is running.

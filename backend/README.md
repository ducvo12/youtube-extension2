# Backend

FastAPI backend for the YouTube contextual language learning extension.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set `GEMINI_API_KEY` in `.env`. `GEMINI_MODEL` defaults to `gemini-3.5-flash`.

For quick translation, set `GOOGLE_CLOUD_PROJECT` in `.env`. `GOOGLE_TRANSLATE_LOCATION`
defaults to `global`, and `GOOGLE_TRANSLATE_TARGET_LANGUAGE` defaults to `en`.
Authenticate Google Cloud locally with one of:

```bash
gcloud auth application-default login
```

or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON file with Cloud
Translation access.

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
- `POST /api/translate` - Google Cloud Translation v3 text translation
- `POST /api/test/echo` - echoes a JSON payload
- `POST /api/test/explain` - placeholder contextual explanation response

Interactive API docs are available at `http://127.0.0.1:8000/docs` while the server is running.

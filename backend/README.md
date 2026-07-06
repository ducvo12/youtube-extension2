# Backend

FastAPI backend for the YouTube contextual language learning extension.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Test Endpoints

- `GET /` - service status and docs link
- `GET /api/health` - health check with UTC timestamp
- `GET /api/test/ping` - returns `pong`
- `POST /api/test/echo` - echoes a JSON payload
- `POST /api/test/explain` - placeholder contextual explanation response

Interactive API docs are available at `http://127.0.0.1:8000/docs` while the server is running.

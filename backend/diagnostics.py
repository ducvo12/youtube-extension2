import time
from datetime import datetime, timezone
from typing import Any

from fastapi import Request

from config import get_gemini_thinking_level


def elapsed_ms(start_time: float) -> int:
    return round((time.perf_counter() - start_time) * 1000)



def get_request_id(request: Request) -> str | None:
    return request.headers.get("X-YT-Translator-Request-Id")



def build_backend_diagnostics(
    request: Request,
    *,
    endpoint: str,
    provider: str,
    backend_start_time: float,
    provider_ms: int | None = None,
    parse_ms: int | None = None,
    model: str | None = None,
    text_length: int | None = None,
) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "requestId": get_request_id(request),
        "endpoint": endpoint,
        "provider": provider,
        "backendTotalMs": elapsed_ms(backend_start_time),
        "providerMs": provider_ms,
        "parseMs": parse_ms,
        "textLength": text_length,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if model:
        diagnostics["model"] = model
        diagnostics["thinkingLevel"] = get_gemini_thinking_level()

    return diagnostics


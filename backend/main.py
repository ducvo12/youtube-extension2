import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - allows startup before optional deps are installed.
    load_dotenv = None


BASE_DIR = Path(__file__).resolve().parent

if load_dotenv:
    load_dotenv(BASE_DIR / ".env")

DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_GEMINI_LEARNING_MODEL = "gemini-3.5-flash-lite"
DEFAULT_GEMINI_THINKING_LEVEL = "minimal"
GEMINI_CHAT_MAX_OUTPUT_TOKENS = 700
GEMINI_LEARNING_MAX_OUTPUT_TOKENS = 550
DEFAULT_TRANSLATE_TARGET_LANGUAGE = "en"
DEFAULT_TRANSLATE_LOCATION = "global"
ENV_FILE = BASE_DIR / ".env"
VALID_GEMINI_THINKING_LEVELS = {"minimal", "low", "medium", "high"}


app = FastAPI(
    title="YouTube Translator Backend",
    description="Backend API for the YouTube contextual language learning extension.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EchoRequest(BaseModel):
    message: str = Field(..., min_length=1)
    metadata: dict[str, Any] | None = None


class ExplanationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    source_language: str = Field(default="auto", min_length=2)
    target_language: str = Field(default="en", min_length=2)


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    source_language: str | None = Field(default=None, min_length=2, max_length=12)
    target_language: str | None = Field(
        default=None,
        min_length=2,
        max_length=12,
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_extension_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)

        if "sourceLanguage" in normalized and "source_language" not in normalized:
            normalized["source_language"] = normalized.pop("sourceLanguage")

        if "targetLanguage" in normalized and "target_language" not in normalized:
            normalized["target_language"] = normalized.pop("targetLanguage")

        return normalized


class CaptionTranslationChunk(BaseModel):
    source: str = Field(..., min_length=1, max_length=120)
    definition: str = Field(..., min_length=1, max_length=140)
    natural: str | None = Field(default=None, max_length=100)
    role: str | None = Field(default=None, max_length=40)
    note: str | None = Field(default=None, max_length=140)


class CaptionLearningTranslation(BaseModel):
    translated_text: str = Field(..., min_length=1, max_length=1200)
    chunks: list[CaptionTranslationChunk] = Field(default_factory=list, max_length=8)

    @model_validator(mode="before")
    @classmethod
    def normalize_gemini_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)

        if "translatedText" in normalized and "translated_text" not in normalized:
            normalized["translated_text"] = normalized.pop("translatedText")

        return normalized


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class VideoContext(BaseModel):
    video_id: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=300)
    transcript_context: str | None = Field(default=None, max_length=4000)
    selected_caption_text: str | None = Field(default=None, max_length=1200)

    @model_validator(mode="before")
    @classmethod
    def normalize_extension_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)

        if "videoId" in normalized and "video_id" not in normalized:
            normalized["video_id"] = normalized.pop("videoId")

        if "transcriptContext" in normalized and "transcript_context" not in normalized:
            normalized["transcript_context"] = normalized.pop("transcriptContext")

        if "selectedCaptionText" in normalized and "selected_caption_text" not in normalized:
            normalized["selected_caption_text"] = normalized.pop("selectedCaptionText")

        return normalized


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1200)
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=12)
    video_context: VideoContext | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_extension_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)

        if "videoContext" in normalized and "video_context" not in normalized:
            normalized["video_context"] = normalized.pop("videoContext")

        return normalized


def build_api_error(
    code: str,
    message: str,
    hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
    }

    if hint:
        error["hint"] = hint

    if details:
        error["details"] = details

    return error


def create_api_exception(
    status_code: int,
    code: str,
    message: str,
    hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=build_api_error(code, message, hint, details),
    )


def raise_api_error(
    status_code: int,
    code: str,
    message: str,
    hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    raise create_api_exception(status_code, code, message, hint, details)


def get_gemini_model() -> str:
    return os.getenv("GEMINI_CHAT_MODEL", "").strip() or DEFAULT_GEMINI_MODEL


def get_gemini_learning_model() -> str:
    return os.getenv("GEMINI_LEARNING_MODEL", "").strip() or DEFAULT_GEMINI_LEARNING_MODEL


def get_gemini_thinking_level() -> str:
    thinking_level = (
        os.getenv("GEMINI_THINKING_LEVEL", "").strip().lower()
        or DEFAULT_GEMINI_THINKING_LEVEL
    )

    if thinking_level not in VALID_GEMINI_THINKING_LEVELS:
        return DEFAULT_GEMINI_THINKING_LEVEL

    return thinking_level


def get_gemini_generation_config(max_output_tokens: int) -> dict[str, Any]:
    return {
        "max_output_tokens": max_output_tokens,
        "thinking_level": get_gemini_thinking_level(),
    }


def get_caption_learning_response_format() -> dict[str, Any]:
    return {
        "type": "text",
        "mime_type": "application/json",
        "schema": CaptionLearningTranslation.model_json_schema(),
    }


def get_gemini_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def get_google_cloud_project() -> str:
    return os.getenv("GOOGLE_CLOUD_PROJECT", "").strip()


def get_translate_location() -> str:
    return os.getenv("GOOGLE_TRANSLATE_LOCATION", "").strip() or DEFAULT_TRANSLATE_LOCATION


def get_default_translate_target_language() -> str:
    return (
        os.getenv("GOOGLE_TRANSLATE_TARGET_LANGUAGE", "").strip()
        or DEFAULT_TRANSLATE_TARGET_LANGUAGE
    )


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


def format_chat_history(history: list[ChatHistoryMessage]) -> str:
    if not history:
        return "No prior messages."

    return "\n".join(
        f"{message.role.title()}: {message.content}"
        for message in history[-8:]
    )


def build_chat_prompt(payload: ChatRequest) -> str:
    video_title = payload.video_context.title if payload.video_context else None
    transcript_context = (
        payload.video_context.transcript_context
        if payload.video_context
        else None
    )
    selected_caption_text = (
        payload.video_context.selected_caption_text
        if payload.video_context
        else None
    )

    return f"""
You are a contextual language-learning assistant embedded in a YouTube sidebar.

Help intermediate-to-advanced language learners understand native video content.
Prioritize meaning in context, tone/register, idioms, slang, grammar patterns, and natural usage.
Avoid word-for-word translation unless it is useful. Keep the answer concise and practical.
When selected caption text is provided, treat it as the specific phrase the user is asking about.
Format responses using only short paragraphs, dash bullet lists, bold labels, italics, and inline code.
Do not use tables, headings, blockquotes, HTML, images, links, numbered lists, or code blocks.

Video title:
{video_title or "Unknown"}

Nearby transcript context:
{transcript_context or "No transcript context is available yet."}

Selected caption text:
{selected_caption_text or "No caption text is selected."}

Recent chat history:
{format_chat_history(payload.history)}

Current user question:
{payload.message}
""".strip()

#######################################

# PROMPT HERE
def build_caption_learning_translation_prompt(payload: TranslateRequest) -> str:
    target_language = payload.target_language or get_default_translate_target_language()
    source_language = payload.source_language or "auto"

    return f"""
You translate YouTube captions for language learners.
Return only JSON matching the configured response schema.

Rules:
- Translate the caption into natural English.
- Prefer 3-6 chunks; never use more than 8 chunks.
- Prefer phrase chunks; split a word only if it is useful alone.
- Keep chunk order, copy source text exactly, and cover meaningful words.
- Keep definitions under 12 words.
- Use notes only for idioms, slang, register, or grammar.
- Infer source language if auto. Do not invent context.

Source language: {source_language}
Target language: {target_language}

Caption:
{payload.text}
""".strip()


#######################################


def parse_gemini_json_object(response_text: str) -> dict[str, Any]:
    text = response_text.strip()

    if text.startswith("```"):
        lines = text.splitlines()

        if lines and lines[0].startswith("```"):
            lines = lines[1:]

        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]

        text = "\n".join(lines).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")

        if start == -1 or end == -1 or end <= start:
            raise

        return json.loads(text[start:end + 1])


def generate_gemini_chat_response(payload: ChatRequest) -> dict[str, Any]:
    api_key = get_gemini_api_key()
    model = get_gemini_model()

    if not api_key:
        raise_api_error(
            status_code=503,
            code="MISSING_GEMINI_API_KEY",
            message="GEMINI_API_KEY is not configured on the backend.",
            hint=(
                "Create backend/.env with GEMINI_API_KEY=your_key, then restart "
                "uvicorn so the backend reloads the environment."
            ),
            details={
                "envFileExists": ENV_FILE.exists(),
                "envFilePath": str(ENV_FILE),
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
            },
        )

    try:
        from google import genai
    except ImportError as error:
        raise create_api_exception(
            status_code=503,
            code="GEMINI_SDK_MISSING",
            message="google-genai is not installed.",
            hint="Run pip install -r requirements.txt inside the backend virtualenv.",
        ) from error

    try:
        prompt = build_chat_prompt(payload)
        provider_start_time = time.perf_counter()
        with genai.Client(api_key=api_key) as client:
            interaction = client.interactions.create(
                model=model,
                input=prompt,
                generation_config=get_gemini_generation_config(
                    GEMINI_CHAT_MAX_OUTPUT_TOKENS
                ),
            )
        provider_ms = elapsed_ms(provider_start_time)
    except Exception as error:
        raise create_api_exception(
            status_code=502,
            code="GEMINI_REQUEST_FAILED",
            message="Gemini request failed.",
            hint="Check that the API key is valid and that the configured model is available for your Gemini account.",
            details={
                "errorType": type(error).__name__,
                "errorMessage": str(error),
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
            },
        ) from error

    response_text = getattr(interaction, "output_text", "").strip()

    if not response_text:
        raise_api_error(
            status_code=502,
            code="GEMINI_EMPTY_RESPONSE",
            message="Gemini returned an empty response.",
            details={
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
            },
        )

    return {
        "message": response_text,
        "model": model,
        "providerMs": provider_ms,
        "promptLength": len(prompt),
        "thinkingLevel": get_gemini_thinking_level(),
        "maxOutputTokens": GEMINI_CHAT_MAX_OUTPUT_TOKENS,
    }


def translate_caption_with_gemini(payload: TranslateRequest) -> dict[str, Any]:
    api_key = get_gemini_api_key()
    model = get_gemini_learning_model()

    if not api_key:
        raise_api_error(
            status_code=503,
            code="MISSING_GEMINI_API_KEY",
            message="GEMINI_API_KEY is not configured on the backend.",
            hint=(
                "Create backend/.env with GEMINI_API_KEY=your_key, then restart "
                "uvicorn so the backend reloads the environment."
            ),
            details={
                "envFileExists": ENV_FILE.exists(),
                "envFilePath": str(ENV_FILE),
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
            },
        )

    try:
        from google import genai
    except ImportError as error:
        raise create_api_exception(
            status_code=503,
            code="GEMINI_SDK_MISSING",
            message="google-genai is not installed.",
            hint="Run pip install -r requirements.txt inside the backend virtualenv.",
        ) from error

    try:
        prompt = build_caption_learning_translation_prompt(payload)
        provider_start_time = time.perf_counter()
        with genai.Client(api_key=api_key) as client:
            interaction = client.interactions.create(
                model=model,
                input=prompt,
                generation_config=get_gemini_generation_config(
                    GEMINI_LEARNING_MAX_OUTPUT_TOKENS
                ),
                response_format=get_caption_learning_response_format(),
            )
        provider_ms = elapsed_ms(provider_start_time)
    except Exception as error:
        raise create_api_exception(
            status_code=502,
            code="GEMINI_REQUEST_FAILED",
            message="Gemini request failed.",
            hint="Check that the API key is valid and that the configured model is available for your Gemini account.",
            details={
                "errorType": type(error).__name__,
                "errorMessage": str(error),
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
            },
        ) from error

    response_text = getattr(interaction, "output_text", "").strip()

    if not response_text:
        raise_api_error(
            status_code=502,
            code="GEMINI_EMPTY_RESPONSE",
            message="Gemini returned an empty response.",
            details={
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
            },
        )

    parse_start_time = time.perf_counter()
    try:
        parsed = CaptionLearningTranslation.model_validate(
            parse_gemini_json_object(response_text)
        )
        parse_ms = elapsed_ms(parse_start_time)
    except Exception as error:
        raise create_api_exception(
            status_code=502,
            code="GEMINI_INVALID_TRANSLATION_JSON",
            message="Gemini returned translation data that could not be parsed.",
            hint="Try the request again, or adjust the caption learning translation prompt.",
            details={
                "errorType": type(error).__name__,
                "errorMessage": str(error),
                "geminiModel": model,
                "geminiThinkingLevel": get_gemini_thinking_level(),
                "rawResponse": response_text[:1200],
            },
        ) from error

    return {
        "translatedText": parsed.translated_text,
        "chunks": [
            {
                "source": chunk.source,
                "definition": chunk.definition,
                "natural": chunk.natural,
                "role": chunk.role,
                "note": chunk.note,
            }
            for chunk in parsed.chunks
        ],
        "sourceLanguage": payload.source_language or "auto",
        "targetLanguage": payload.target_language or get_default_translate_target_language(),
        "provider": "google-gemini",
        "model": model,
        "thinkingLevel": get_gemini_thinking_level(),
        "providerMs": provider_ms,
        "parseMs": parse_ms,
        "promptLength": len(prompt),
        "maxOutputTokens": GEMINI_LEARNING_MAX_OUTPUT_TOKENS,
        "structuredOutput": True,
    }


def translate_text_with_google(payload: TranslateRequest) -> dict[str, Any]:
    project_id = get_google_cloud_project()

    if not project_id:
        raise_api_error(
            status_code=503,
            code="MISSING_GOOGLE_CLOUD_PROJECT",
            message="GOOGLE_CLOUD_PROJECT is not configured on the backend.",
            hint=(
                "Set GOOGLE_CLOUD_PROJECT in backend/.env, then restart uvicorn. "
                "Authenticate with gcloud application-default credentials or "
                "GOOGLE_APPLICATION_CREDENTIALS."
            ),
            details={
                "envFileExists": ENV_FILE.exists(),
                "envFilePath": str(ENV_FILE),
            },
        )

    try:
        from google.cloud import translate_v3 as translate
    except ImportError as error:
        raise create_api_exception(
            status_code=503,
            code="GOOGLE_TRANSLATE_SDK_MISSING",
            message="google-cloud-translate is not installed.",
            hint="Run pip install -r requirements.txt inside the backend virtualenv.",
        ) from error

    target_language = payload.target_language or get_default_translate_target_language()
    source_language = (payload.source_language or "").strip()
    request: dict[str, Any] = {
        "parent": f"projects/{project_id}/locations/{get_translate_location()}",
        "contents": [payload.text],
        "mime_type": "text/plain",
        "target_language_code": target_language,
    }

    if source_language and source_language.lower() != "auto":
        request["source_language_code"] = source_language

    try:
        provider_start_time = time.perf_counter()
        client = translate.TranslationServiceClient()
        response = client.translate_text(request=request)
        provider_ms = elapsed_ms(provider_start_time)
    except Exception as error:
        raise create_api_exception(
            status_code=502,
            code="GOOGLE_TRANSLATE_REQUEST_FAILED",
            message="Google Cloud Translation request failed.",
            hint="Check Google Cloud credentials, Translation API enablement, billing, and project id.",
            details={
                "errorType": type(error).__name__,
                "errorMessage": str(error),
                "translateLocation": get_translate_location(),
                "targetLanguage": target_language,
            },
        ) from error

    translation = response.translations[0] if response.translations else None

    if not translation or not translation.translated_text:
        raise_api_error(
            status_code=502,
            code="GOOGLE_TRANSLATE_EMPTY_RESPONSE",
            message="Google Cloud Translation returned an empty response.",
            details={
                "translateLocation": get_translate_location(),
                "targetLanguage": target_language,
            },
        )

    return {
        "translatedText": translation.translated_text,
        "detectedSourceLanguage": translation.detected_language_code or None,
        "sourceLanguage": source_language or "auto",
        "targetLanguage": target_language,
        "provider": "google-cloud-translate-v3",
        "providerMs": provider_ms,
    }


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "youtube-translator-backend",
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/debug/config")
async def debug_config() -> dict[str, Any]:
    return {
        "geminiApiKeyConfigured": bool(get_gemini_api_key()),
        "geminiModel": get_gemini_model(),
        "geminiLearningModel": get_gemini_learning_model(),
        "geminiThinkingLevel": get_gemini_thinking_level(),
        "legacyGeminiModelConfigured": bool(os.getenv("GEMINI_MODEL", "").strip()),
        "googleCloudProjectConfigured": bool(get_google_cloud_project()),
        "translateLocation": get_translate_location(),
        "translateTargetLanguage": get_default_translate_target_language(),
        "envFileExists": ENV_FILE.exists(),
        "envFilePath": str(ENV_FILE),
        "dotenvInstalled": load_dotenv is not None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/test/ping")
async def ping() -> dict[str, str]:
    return {"message": "pong"}


@app.post("/api/test/echo")
async def echo(payload: EchoRequest) -> dict[str, Any]:
    return {
        "message": payload.message,
        "metadata": payload.metadata or {},
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    backend_start_time = time.perf_counter()
    result = await run_in_threadpool(generate_gemini_chat_response, payload)

    return {
        "message": result["message"],
        "model": result["model"],
        "thinkingLevel": result["thinkingLevel"],
        "diagnostics": build_backend_diagnostics(
            request,
            endpoint="/api/chat",
            provider="google-gemini",
            backend_start_time=backend_start_time,
            provider_ms=result["providerMs"],
            model=result["model"],
            text_length=len(payload.message),
        ) | {
            "promptLength": result["promptLength"],
            "maxOutputTokens": result["maxOutputTokens"],
            "historyCount": len(payload.history),
            "transcriptContextLength": len(
                payload.video_context.transcript_context
                if payload.video_context and payload.video_context.transcript_context
                else ""
            ),
        },
    }


@app.post("/api/translate")
async def translate_text(payload: TranslateRequest, request: Request) -> dict[str, Any]:
    backend_start_time = time.perf_counter()
    result = await run_in_threadpool(translate_text_with_google, payload)

    return result | {
        "diagnostics": build_backend_diagnostics(
            request,
            endpoint="/api/translate",
            provider=result["provider"],
            backend_start_time=backend_start_time,
            provider_ms=result["providerMs"],
            text_length=len(payload.text),
        ),
    }


@app.post("/api/translate/learning")
async def translate_caption_learning(
    payload: TranslateRequest,
    request: Request,
) -> dict[str, Any]:
    backend_start_time = time.perf_counter()
    result = await run_in_threadpool(translate_caption_with_gemini, payload)

    return result | {
        "diagnostics": build_backend_diagnostics(
            request,
            endpoint="/api/translate/learning",
            provider=result["provider"],
            backend_start_time=backend_start_time,
            provider_ms=result["providerMs"],
            parse_ms=result["parseMs"],
            model=result["model"],
            text_length=len(payload.text),
        ) | {
            "promptLength": result["promptLength"],
            "maxOutputTokens": result["maxOutputTokens"],
            "structuredOutput": result["structuredOutput"],
            "chunkCount": len(result["chunks"]),
        },
    }


@app.post("/api/test/explain")
async def explain(payload: ExplanationRequest) -> dict[str, Any]:
    return {
        "text": payload.text,
        "source_language": payload.source_language,
        "target_language": payload.target_language,
        "explanation": (
            "This is a placeholder explanation endpoint. "
            "Connect this route to the AI explanation pipeline later."
        ),
    }

import time
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

from config import (
    ENV_FILE,
    GEMINI_CHAT_MAX_OUTPUT_TOKENS,
    get_gemini_api_key,
    get_gemini_generation_config,
    get_gemini_model,
    get_gemini_thinking_level,
)
from diagnostics import build_backend_diagnostics, elapsed_ms
from errors import create_api_exception, raise_api_error

router = APIRouter()


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
Explain the phrase's meaning in the surrounding transcript as a whole, using the nearby context provided.
Do not claim broader context than the transcript snippet supports.
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



@router.post("/api/chat")
async def chat(payload: ChatRequest, request: Request) -> dict[str, Any]:
    # print(payload.model_dump_json(indent=2))

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


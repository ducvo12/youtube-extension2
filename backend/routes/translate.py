import json
import time
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

from config import (
    DEFAULT_TARGET_LANGUAGE,
    ENV_FILE,
    GEMINI_LEARNING_MAX_OUTPUT_TOKENS,
    get_gemini_api_key,
    get_gemini_generation_config,
    get_gemini_learning_model,
    get_gemini_thinking_level,
)
from diagnostics import build_backend_diagnostics, elapsed_ms
from errors import create_api_exception, raise_api_error

router = APIRouter()


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
    chunks: list[CaptionTranslationChunk] = Field(
        default_factory=list,
        max_length=8
    )

    @model_validator(mode="before")
    @classmethod
    def normalize_gemini_payload(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)

        if "translatedText" in normalized and "translated_text" not in normalized:
            normalized["translated_text"] = normalized.pop("translatedText")

        return normalized



def get_caption_learning_response_format() -> dict[str, Any]:
    return {
        "type": "text",
        "mime_type": "application/json",
        "schema": CaptionLearningTranslation.model_json_schema(),
    }



def build_caption_learning_translation_prompt(payload: TranslateRequest) -> str:
    target_language = payload.target_language or DEFAULT_TARGET_LANGUAGE
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
        "targetLanguage": payload.target_language or DEFAULT_TARGET_LANGUAGE,
        "provider": "google-gemini",
        "model": model,
        "thinkingLevel": get_gemini_thinking_level(),
        "providerMs": provider_ms,
        "parseMs": parse_ms,
        "promptLength": len(prompt),
        "maxOutputTokens": GEMINI_LEARNING_MAX_OUTPUT_TOKENS,
        "structuredOutput": True,
    }



@router.post("/api/translate/learning")
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


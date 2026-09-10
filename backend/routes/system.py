import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from config import (
    ENV_FILE,
    get_gemini_api_key,
    get_gemini_learning_model,
    get_gemini_model,
    get_gemini_thinking_level,
    load_dotenv,
)

router = APIRouter()


class EchoRequest(BaseModel):
    message: str = Field(..., min_length=1)
    metadata: dict[str, Any] | None = None



class ExplanationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    source_language: str = Field(default="auto", min_length=2)
    target_language: str = Field(default="en", min_length=2)



@router.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "youtube-translator-backend",
        "status": "ok",
        "docs": "/docs",
    }



@router.get("/api/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }



@router.get("/api/debug/config")
async def debug_config() -> dict[str, Any]:
    return {
        "geminiApiKeyConfigured": bool(get_gemini_api_key()),
        "geminiModel": get_gemini_model(),
        "geminiLearningModel": get_gemini_learning_model(),
        "geminiThinkingLevel": get_gemini_thinking_level(),
        "legacyGeminiModelConfigured": bool(os.getenv("GEMINI_MODEL", "").strip()),
        "envFileExists": ENV_FILE.exists(),
        "envFilePath": str(ENV_FILE),
        "dotenvInstalled": load_dotenv is not None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }



@router.get("/api/test/ping")
async def ping() -> dict[str, str]:
    return {"message": "pong"}



@router.post("/api/test/echo")
async def echo(payload: EchoRequest) -> dict[str, Any]:
    return {
        "message": payload.message,
        "metadata": payload.metadata or {},
    }



@router.post("/api/test/explain")
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


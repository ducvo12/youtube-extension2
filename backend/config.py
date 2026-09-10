import os
from pathlib import Path
from typing import Any

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
DEFAULT_TARGET_LANGUAGE = "en"
ENV_FILE = BASE_DIR / ".env"
VALID_GEMINI_THINKING_LEVELS = {"minimal", "low", "medium", "high"}



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



def get_gemini_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


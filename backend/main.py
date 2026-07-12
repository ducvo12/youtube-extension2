from datetime import datetime, timezone
from typing import Any, Literal

# pyrefly: ignore [missing-import]
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


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


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class VideoContext(BaseModel):
    video_id: str | None = Field(default=None, alias="videoId")
    title: str | None = Field(default=None, max_length=300)
    transcript_context: str | None = Field(
        default=None,
        alias="transcriptContext",
        max_length=4000,
    )


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1200)
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=12)
    video_context: VideoContext | None = Field(default=None, alias="videoContext")


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
async def chat(payload: ChatRequest) -> dict[str, Any]:
    video_title = payload.video_context.title if payload.video_context else None
    transcript_context = (
        payload.video_context.transcript_context
        if payload.video_context
        else None
    )
    context_note = (
        f" I received nearby transcript context: \"{transcript_context[:180]}\"."
        if transcript_context
        else " I did not receive transcript context yet."
    )
    title_note = f" while watching \"{video_title}\"" if video_title else ""

    return {
        "message": (
            f"Backend placeholder reply{title_note}: I received your prompt "
            f"\"{payload.message}\".{context_note} "
            f"Conversation messages received: {len(payload.history)}."
        )
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

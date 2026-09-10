from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import chat, system, translate


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

app.include_router(system.router)
app.include_router(chat.router)
app.include_router(translate.router)

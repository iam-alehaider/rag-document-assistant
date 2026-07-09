from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.logging_config import configure_logging
from app.api import routes_auth, routes_documents, routes_chat, routes_health

settings = get_settings()

configure_logging()

app = FastAPI(title=settings.APP_NAME, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_health.router)
app.include_router(routes_auth.router)
app.include_router(routes_documents.router)
app.include_router(routes_chat.router)


@app.on_event("startup")
def on_startup():
    init_db()

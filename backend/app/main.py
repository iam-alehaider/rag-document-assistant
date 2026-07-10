from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.db import init_db
from app.logging_config import configure_logging
from app.rate_limit import limiter
from app.api import routes_auth, routes_documents, routes_chat, routes_health

settings = get_settings()

configure_logging()

app = FastAPI(title=settings.APP_NAME, version="1.0.0")

# --- Rate limiting ---
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Baseline security headers ---
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.ENV == "production":
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)

app.include_router(routes_health.router)
app.include_router(routes_auth.router)
app.include_router(routes_documents.router)
app.include_router(routes_chat.router)


@app.on_event("startup")
def on_startup():
    # Production schema changes go through Alembic (`alembic upgrade head`),
    # run as a separate deploy step - not through create_all().
    if settings.ENV == "development":
        init_db()

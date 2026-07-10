from fastapi import APIRouter
from fastapi.responses import PlainTextResponse
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
from sqlalchemy import text

from app.db import SessionLocal
from app.rag.vectorstore import get_client as get_qdrant_client

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """Liveness - is the process up at all. Doesn't touch dependencies."""
    return {"status": "ok"}


@router.get("/health/ready")
def readiness():
    """
    Readiness - can this instance actually serve traffic right now.
    Checks Postgres and Qdrant connectivity, the two hard dependencies.
    """
    checks = {}

    try:
        db = SessionLocal()
        db.execute(text("SELECT 1"))
        db.close()
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {e}"

    try:
        get_qdrant_client().get_collections()
        checks["qdrant"] = "ok"
    except Exception as e:
        checks["qdrant"] = f"error: {e}"

    all_ok = all(v == "ok" for v in checks.values())
    return {"status": "ready" if all_ok else "not_ready", "checks": checks}


@router.get("/metrics")
def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

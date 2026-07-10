import time
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db, User, ChatLog
from app.models import (
    ChatRequest,
    ChatResponse,
    SourceChunk,
    ChatSessionOut,
    ChatMessageOut,
)
from app.rag.embeddings import embed_query
from app.rag.vectorstore import search
from app.rag.llm import generate_answer
from app.metrics import RAG_QUERY_LATENCY, RAG_QUERY_COUNT
from app.rate_limit import limiter

settings = get_settings()
logger = logging.getLogger("rag.chat")
router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
@limiter.limit(settings.RATE_LIMIT_CHAT)
def chat(
    request: Request,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    start = time.time()
    session_id = payload.session_id or str(uuid.uuid4())

    query_vector = embed_query(payload.question)
    results = search(
        query_vector=query_vector,
        owner_id=user.id,
        document_id=payload.document_id,
    )

    context_chunks = [r.payload["chunk_text"] for r in results]
    sources = [
        SourceChunk(
            document_id=r.payload["document_id"],
            filename=r.payload["filename"],
            chunk_text=r.payload["chunk_text"],
            score=r.score,
        )
        for r in results
    ]

    answer = generate_answer(payload.question, context_chunks)

    log = ChatLog(session_id=session_id, user_id=user.id, question=payload.question, answer=answer)
    db.add(log)
    db.commit()

    RAG_QUERY_LATENCY.observe(time.time() - start)
    RAG_QUERY_COUNT.inc()
    logger.info("chat_query", extra={"user_id": user.id, "session_id": session_id, "latency": time.time() - start})

    return ChatResponse(answer=answer, sources=sources, session_id=session_id)


@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    One row per distinct session_id, with the first question used as a
    display title and first/last timestamps for sorting + display.
    """
    rows = (
        db.query(
            ChatLog.session_id,
            func.min(ChatLog.created_at).label("created_at"),
            func.max(ChatLog.created_at).label("updated_at"),
            func.count(ChatLog.id).label("message_count"),
        )
        .filter(ChatLog.user_id == user.id)
        .group_by(ChatLog.session_id)
        .order_by(func.max(ChatLog.created_at).desc())
        .all()
    )

    sessions = []
    for row in rows:
        first_message = (
            db.query(ChatLog)
            .filter(ChatLog.session_id == row.session_id, ChatLog.user_id == user.id)
            .order_by(ChatLog.created_at.asc())
            .first()
        )
        title = first_message.question[:60] if first_message else "Conversation"
        sessions.append(
            ChatSessionOut(
                session_id=row.session_id,
                title=title,
                message_count=row.message_count,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
        )
    return sessions


@router.get("/sessions/{session_id}", response_model=list[ChatMessageOut])
def get_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    messages = (
        db.query(ChatLog)
        .filter(ChatLog.session_id == session_id, ChatLog.user_id == user.id)
        .order_by(ChatLog.created_at.asc())
        .all()
    )
    if not messages:
        raise HTTPException(404, "Session not found")
    return messages


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    deleted = (
        db.query(ChatLog)
        .filter(ChatLog.session_id == session_id, ChatLog.user_id == user.id)
        .delete()
    )
    db.commit()
    if not deleted:
        raise HTTPException(404, "Session not found")

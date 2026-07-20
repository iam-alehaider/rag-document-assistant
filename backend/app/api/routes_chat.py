

import time
import uuid
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import get_settings
from app.db import get_db, SessionLocal, User, ChatLog, ChatSession
from app.models import (
    ChatRequest,
    ChatResponse,
    SourceChunk,
    ChatSessionOut,
    ChatMessageOut,
    SessionUpdateRequest,
)
from app.rag.embeddings import embed_query
from app.rag.vectorstore import search
from app.rag.llm import generate_answer, generate_answer_stream
from app.metrics import RAG_QUERY_LATENCY, RAG_QUERY_COUNT
from app.rate_limit import limiter

settings = get_settings()
logger = logging.getLogger("rag.chat")
router = APIRouter(prefix="/chat", tags=["chat"])

# Rough token estimate for Llama-family tokenizers - no exact tokenizer needed
# just to decide how much history fits in the context budget.
CHARS_PER_TOKEN_ESTIMATE = 4
HISTORY_TOKEN_BUDGET = 6000


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN_ESTIMATE)


def build_trimmed_history(db: Session, session_id: str, user_id: int) -> list[dict]:
    """
    Loads prior turns for this session and returns them as the
    [{"role": ..., "content": ...}, ...] shape generate_answer expects,
    walking backward from the most recent message and stopping once the
    estimated token budget is used up. Without this, each question would be
    answered with zero memory of earlier turns in the same conversation.
    """
    rows = (
        db.query(ChatLog)
        .filter(ChatLog.session_id == session_id, ChatLog.user_id == user_id)
        .order_by(ChatLog.created_at.desc())
        .all()
    )

    trimmed: list[dict] = []
    budget = HISTORY_TOKEN_BUDGET
    for row in rows:
        pair_tokens = _estimate_tokens(row.question) + _estimate_tokens(row.answer)
        if pair_tokens > budget:
            break
        budget -= pair_tokens
        # Insert at the front so the final list ends up oldest -> newest
        trimmed.insert(0, {"role": "assistant", "content": row.answer})
        trimmed.insert(0, {"role": "user", "content": row.question})

    return trimmed


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

    # Load prior turns in this session BEFORE adding the current question,
    # so the model actually has conversational memory instead of answering
    # every message in isolation.
    history = build_trimmed_history(db, session_id, user.id) if payload.session_id else []

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

    answer = generate_answer(payload.question, context_chunks, history=history)

    log = ChatLog(session_id=session_id, user_id=user.id, question=payload.question, answer=answer)
    db.add(log)
    db.commit()

    RAG_QUERY_LATENCY.observe(time.time() - start)
    RAG_QUERY_COUNT.inc()
    logger.info("chat_query", extra={"user_id": user.id, "session_id": session_id, "latency": time.time() - start})

    return ChatResponse(answer=answer, sources=sources, session_id=session_id)


@router.post("/stream")
@limiter.limit(settings.RATE_LIMIT_CHAT)
async def chat_stream(
    request: Request,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Same retrieval + generation pipeline as POST /chat, but streams the
    answer token by token as newline-delimited JSON (one JSON object per
    line) instead of waiting for the full completion.

    Event types: status, retrieval, sources, token, warning, error, done.
    Every event carries the same request_id so a single request is
    traceable end-to-end across logs/metrics.

    Uses fetch() + a streamed response body on the frontend rather than the
    browser's native EventSource, since EventSource can't send the
    Authorization header this API requires.
    """
    request_id = str(uuid.uuid4())
    session_id = payload.session_id or str(uuid.uuid4())
    start = time.time()

    # Load history synchronously here, before entering the generator, while
    # the normal request-scoped db session is still guaranteed to be alive.
    history = build_trimmed_history(db, session_id, user.id) if payload.session_id else []

    def event(obj: dict) -> str:
        return json.dumps(obj) + "\n"

    async def event_stream():
        yield event({"type": "status", "request_id": request_id, "message": "Searching documents..."})

        query_vector = embed_query(payload.question)
        results = search(
            query_vector=query_vector,
            owner_id=user.id,
            document_id=payload.document_id,
        )

        context_chunks = [r.payload["chunk_text"] for r in results]
        sources = [
            {
                "document_id": r.payload["document_id"],
                "filename": r.payload["filename"],
                "chunk_text": r.payload["chunk_text"],
                "score": r.score,
            }
            for r in results
        ]

        yield event({"type": "retrieval", "request_id": request_id, "chunks_found": len(results)})
        yield event({"type": "sources", "request_id": request_id, "sources": sources})

        if not context_chunks:
            yield event({
                "type": "warning",
                "request_id": request_id,
                "message": "No matching content found in your documents for this question.",
            })

        full_answer = ""
        finish_reason = "stop"
        tokens_since_disconnect_check = 0

        try:
            for delta_text, fr in generate_answer_stream(payload.question, context_chunks, history=history):
                tokens_since_disconnect_check += 1
                if tokens_since_disconnect_check >= 10:
                    tokens_since_disconnect_check = 0
                    if await request.is_disconnected():
                        finish_reason = "client_stopped"
                        break
                if delta_text:
                    full_answer += delta_text
                    yield event({"type": "token", "request_id": request_id, "text": delta_text})
                if fr:
                    finish_reason = fr
        except Exception as e:
            logger.error(f"LLM stream failed: {e}")
            yield event({
                "type": "error",
                "request_id": request_id,
                "message": "Answer generation failed partway through. Please try again.",
            })
            finish_reason = "error"

        # A fresh session for this write, rather than reusing the
        # request-scoped `db` - mirrors the same pattern already used in
        # app/rag/ingest.py's background task, since a request-scoped
        # session isn't a safe assumption to lean on for writes happening
        # this far into a long-lived streaming response.
        write_db = SessionLocal()
        try:
            log = ChatLog(session_id=session_id, user_id=user.id, question=payload.question, answer=full_answer)
            write_db.add(log)
            write_db.commit()
        finally:
            write_db.close()

        latency = time.time() - start
        RAG_QUERY_LATENCY.observe(latency)
        RAG_QUERY_COUNT.inc()
        logger.info(
            "chat_query_stream",
            extra={"user_id": user.id, "session_id": session_id, "latency": latency},
        )

        yield event({
            "type": "done",
            "request_id": request_id,
            "session_id": session_id,
            "finish_reason": finish_reason,
            "metadata": {
                "model": settings.GROQ_MODEL,
                "latency_ms": int(latency * 1000),
                "estimated_output_tokens": _estimate_tokens(full_answer) if full_answer else 0,
            },
        })

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/sessions", response_model=list[ChatSessionOut])
def list_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """
    One row per distinct session_id. Title is the custom rename if one was
    set, otherwise the first question, truncated. Pinned conversations sort
    above unpinned ones; within each group, most recently updated first.
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
        .all()
    )

    # One query for all this user's session metadata, rather than one query
    # per session inside the loop below.
    session_meta = {
        s.session_id: s
        for s in db.query(ChatSession).filter(ChatSession.user_id == user.id).all()
    }

    sessions = []
    for row in rows:
        meta = session_meta.get(row.session_id)
        title = meta.custom_title if meta and meta.custom_title else None
        if not title:
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
                is_pinned=bool(meta.is_pinned) if meta else False,
            )
        )

    sessions.sort(key=lambda s: (not s.is_pinned, -s.updated_at.timestamp()))
    return sessions


@router.patch("/sessions/{session_id}", response_model=ChatSessionOut)
def update_session(
    session_id: str,
    payload: SessionUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Renames and/or pins a conversation. The chat_sessions row is created
    lazily here on first use rather than eagerly when a conversation starts -
    most conversations are never renamed or pinned, so there's no reason to
    write a row for every single one up front.
    """
    owns_session = (
        db.query(ChatLog.id)
        .filter(ChatLog.session_id == session_id, ChatLog.user_id == user.id)
        .first()
    )
    if not owns_session:
        raise HTTPException(404, "Session not found")

    meta = db.query(ChatSession).filter(ChatSession.session_id == session_id).first()
    if not meta:
        meta = ChatSession(session_id=session_id, user_id=user.id)
        db.add(meta)

    if payload.title is not None:
        meta.custom_title = payload.title
    if payload.is_pinned is not None:
        meta.is_pinned = payload.is_pinned
    db.commit()

    agg = (
        db.query(
            func.min(ChatLog.created_at).label("created_at"),
            func.max(ChatLog.created_at).label("updated_at"),
            func.count(ChatLog.id).label("message_count"),
        )
        .filter(ChatLog.session_id == session_id, ChatLog.user_id == user.id)
        .first()
    )
    title = meta.custom_title
    if not title:
        first_message = (
            db.query(ChatLog)
            .filter(ChatLog.session_id == session_id, ChatLog.user_id == user.id)
            .order_by(ChatLog.created_at.asc())
            .first()
        )
        title = first_message.question[:60] if first_message else "Conversation"

    return ChatSessionOut(
        session_id=session_id,
        title=title,
        message_count=agg.message_count,
        created_at=agg.created_at,
        updated_at=agg.updated_at,
        is_pinned=meta.is_pinned,
    )


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

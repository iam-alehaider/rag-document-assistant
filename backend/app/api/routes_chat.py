import time
import uuid
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db import get_db, User, ChatLog
from app.models import ChatRequest, ChatResponse, SourceChunk
from app.rag.embeddings import embed_query
from app.rag.vectorstore import search
from app.rag.llm import generate_answer
from app.metrics import RAG_QUERY_LATENCY, RAG_QUERY_COUNT

logger = logging.getLogger("rag.chat")
router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
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
            chunk_text=r.payload["chunk_text"][:300],
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

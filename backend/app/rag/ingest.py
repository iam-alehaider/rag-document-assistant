import logging
import uuid

from pypdf import PdfReader

from app.rag.chunking import chunk_text
from app.rag.embeddings import embed_texts
from app.rag.vectorstore import upsert_chunks, ensure_collection

logger = logging.getLogger("rag.ingest")


def extract_text(file_bytes: bytes, filename: str) -> str:
    if filename.lower().endswith(".pdf"):
        reader = PdfReader(__import__("io").BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    # fallback: treat as plain text
    return file_bytes.decode("utf-8", errors="ignore")


def ingest_document_sync(file_bytes: bytes, filename: str, owner_id: int, document_id: str) -> int:
    """
    Core pipeline: parse -> chunk -> embed -> store in Qdrant.
    Returns number_of_chunks. Raises on failure (caller decides how to record it).
    """
    ensure_collection()

    text = extract_text(file_bytes, filename)
    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("No extractable text found in document")

    vectors = embed_texts(chunks)
    upsert_chunks(document_id, owner_id, filename, chunks, vectors)

    return len(chunks)


def process_document_background(file_bytes: bytes, filename: str, owner_id: int, document_id: str):
    """
    Runs in a FastAPI BackgroundTask, after the HTTP response has already
    been sent - so uploads feel instant to the user instead of blocking on
    embedding. Uses its own DB session since the request-scoped one is gone
    by the time this runs.
    """
    from app.db import SessionLocal, Document  # local import to avoid circular import

    db = SessionLocal()
    try:
        num_chunks = ingest_document_sync(file_bytes, filename, owner_id, document_id)
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            doc.chunks = num_chunks
            doc.status = "ready"
            db.commit()
    except Exception as e:
        logger.error(f"Document processing failed for {document_id}: {e}")
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            doc.status = "failed"
            doc.error_message = str(e)[:500]
            db.commit()
    finally:
        db.close()

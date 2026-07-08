import uuid

from pypdf import PdfReader

from app.rag.chunking import chunk_text
from app.rag.embeddings import embed_texts
from app.rag.vectorstore import upsert_chunks, ensure_collection


def extract_text(file_bytes: bytes, filename: str) -> str:
    if filename.lower().endswith(".pdf"):
        reader = PdfReader(__import__("io").BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    # fallback: treat as plain text
    return file_bytes.decode("utf-8", errors="ignore")


def ingest_document(file_bytes: bytes, filename: str, owner_id: int) -> tuple[str, int]:
    """
    Full ingestion pipeline: parse -> chunk -> embed -> store in Qdrant.
    Returns (document_id, number_of_chunks).
    """
    ensure_collection()

    text = extract_text(file_bytes, filename)
    chunks = chunk_text(text)
    if not chunks:
        raise ValueError("No extractable text found in document")

    vectors = embed_texts(chunks)
    document_id = str(uuid.uuid4())
    upsert_chunks(document_id, owner_id, filename, chunks, vectors)

    return document_id, len(chunks)

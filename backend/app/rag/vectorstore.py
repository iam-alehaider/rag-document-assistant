"""
Thin wrapper around Qdrant (open-source vector DB).
Works identically against a local Docker Qdrant instance or the free
1GB Qdrant Cloud tier — only QDRANT_URL / QDRANT_API_KEY change.
"""
import uuid
from functools import lru_cache

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.config import get_settings

settings = get_settings()


@lru_cache
def get_client() -> QdrantClient:
    return QdrantClient(url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY or None)


def ensure_collection():
    client = get_client()
    existing = [c.name for c in client.get_collections().collections]
    if settings.QDRANT_COLLECTION not in existing:
        client.create_collection(
            collection_name=settings.QDRANT_COLLECTION,
            vectors_config=qmodels.VectorParams(
                size=settings.EMBEDDING_DIM, distance=qmodels.Distance.COSINE
            ),
        )


def upsert_chunks(
    document_id: str,
    owner_id: int,
    filename: str,
    chunks: list[str],
    vectors: list[list[float]],
):
    client = get_client()
    points = [
        qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=vectors[i],
            payload={
                "document_id": document_id,
                "owner_id": owner_id,
                "filename": filename,
                "chunk_text": chunks[i],
                "chunk_index": i,
            },
        )
        for i in range(len(chunks))
    ]
    client.upsert(collection_name=settings.QDRANT_COLLECTION, points=points)


def search(
    query_vector: list[float],
    owner_id: int,
    document_id: str | None = None,
    top_k: int = None,
):
    client = get_client()
    top_k = top_k or settings.TOP_K

    must_filters = [qmodels.FieldCondition(key="owner_id", match=qmodels.MatchValue(value=owner_id))]
    if document_id:
        must_filters.append(
            qmodels.FieldCondition(key="document_id", match=qmodels.MatchValue(value=document_id))
        )

    results = client.search(
        collection_name=settings.QDRANT_COLLECTION,
        query_vector=query_vector,
        query_filter=qmodels.Filter(must=must_filters),
        limit=top_k,
    )
    return results


def delete_document(document_id: str, owner_id: int):
    client = get_client()
    client.delete(
        collection_name=settings.QDRANT_COLLECTION,
        points_selector=qmodels.FilterSelector(
            filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(key="document_id", match=qmodels.MatchValue(value=document_id)),
                    qmodels.FieldCondition(key="owner_id", match=qmodels.MatchValue(value=owner_id)),
                ]
            )
        ),
    )

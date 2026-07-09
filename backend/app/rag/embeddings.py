"""
Local embedding model — runs on CPU, completely free, no API key needed.

Uses `fastembed` (ONNX runtime) instead of `sentence-transformers` (PyTorch).
Same model, same output vectors, but a fraction of the memory footprint —
important because Render's free tier caps a service at 512MB RAM, and
PyTorch alone can eat most of that just importing.
"""
from functools import lru_cache

from fastembed import TextEmbedding

from app.config import get_settings

settings = get_settings()

# fastembed's naming convention for the same MiniLM model
FASTEMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@lru_cache
def get_embedder() -> TextEmbedding:
    return TextEmbedding(model_name=FASTEMBED_MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_embedder()
    return [vec.tolist() for vec in model.embed(texts)]


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]

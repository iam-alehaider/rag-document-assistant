"""Simple, dependency-light recursive text chunker (no LangChain needed)."""
from app.config import get_settings

settings = get_settings()

SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


def _split(text: str, separators: list[str]) -> list[str]:
    if not separators:
        return [text]
    sep, rest = separators[0], separators[1:]
    if sep == "":
        return list(text)
    return [p for p in text.split(sep) if p != ""]


def chunk_text(
    text: str,
    chunk_size: int = None,
    overlap: int = None,
) -> list[str]:
    """
    Recursively splits text on paragraph -> line -> sentence -> word
    boundaries, packing pieces into chunks of ~chunk_size chars with
    `overlap` chars of context carried between consecutive chunks.
    """
    chunk_size = chunk_size or settings.CHUNK_SIZE
    overlap = overlap or settings.CHUNK_OVERLAP

    text = text.strip()
    if not text:
        return []

    pieces = _split(text, SEPARATORS)

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = (current + " " + piece).strip() if current else piece
        if len(candidate) <= chunk_size:
            current = candidate
        else:
            if current:
                chunks.append(current)
            # start new chunk, carrying overlap from the tail of the previous one
            tail = current[-overlap:] if overlap and current else ""
            current = (tail + " " + piece).strip()
            # if a single piece is itself bigger than chunk_size, hard-split it
            while len(current) > chunk_size:
                chunks.append(current[:chunk_size])
                current = current[chunk_size - overlap:]
    if current:
        chunks.append(current)

    return chunks

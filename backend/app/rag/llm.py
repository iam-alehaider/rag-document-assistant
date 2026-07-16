

"""
LLM call layer. Uses Groq's OpenAI-compatible API — free tier, very fast
inference. Swap GROQ_MODEL / base_url if you later want to point this at
another free-tier provider (e.g. Google Gemini, OpenRouter free models)
without touching any other code.
"""
from groq import Groq

from app.config import get_settings

settings = get_settings()

SYSTEM_PROMPT = """You are a precise, helpful document assistant.
Answer the user's question using ONLY the provided context excerpts.
If the answer isn't in the context, say you don't have enough information
in the uploaded documents — never make things up.
Keep answers concise and cite which excerpt (by number) you used."""


def _client() -> Groq:
    return Groq(api_key=settings.GROQ_API_KEY.get_secret_value())


def build_context_block(chunks: list[str]) -> str:
    return "\n\n".join(f"[Excerpt {i+1}]\n{c}" for i, c in enumerate(chunks))


def generate_answer(question: str, context_chunks: list[str], history: list[dict] | None = None) -> str:
    context_block = build_context_block(context_chunks) if context_chunks else "No relevant context found."

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)

    user_msg = f"Context:\n{context_block}\n\nQuestion: {question}"
    messages.append({"role": "user", "content": user_msg})

    response = _client().chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=0.2,
        max_tokens=800,
    )
    return response.choices[0].message.content


def generate_answer_stream(question: str, context_chunks: list[str], history: list[dict] | None = None):
    """
    Same prompt construction as generate_answer, but yields (delta_text,
    finish_reason) tuples as Groq streams the response token by token,
    instead of waiting for and returning the full completion at once.
    """
    context_block = build_context_block(context_chunks) if context_chunks else "No relevant context found."

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)

    user_msg = f"Context:\n{context_block}\n\nQuestion: {question}"
    messages.append({"role": "user", "content": user_msg})

    stream = _client().chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=messages,
        temperature=0.2,
        max_tokens=800,
        stream=True,
    )

    for chunk in stream:
        if not chunk.choices:
            continue
        choice = chunk.choices[0]
        delta_text = choice.delta.content or ""
        finish_reason = choice.finish_reason
        yield delta_text, finish_reason

FROM python:3.11-slim

WORKDIR /app

# System deps for psycopg2 + fastembed
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini .

# Pre-download the embedding model at build time so cold-start is fast
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2')"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8000/health || exit 1

# WEB_CONCURRENCY defaults to 1 - Render's free tier (512MB) can't safely run
# more than one worker alongside the embedding model. Bump it via env var if
# you upgrade to a bigger instance.
#
# Migrations run automatically on every container start, before the server
# binds a port - this is what makes Alembic "just work" on Render without
# needing a separate pre-deploy step.
CMD alembic upgrade head && \
    gunicorn -k uvicorn.workers.UvicornWorker -w ${WEB_CONCURRENCY:-1} \
    --bind 0.0.0.0:8000 --timeout 120 --graceful-timeout 30 \
    app.main:app

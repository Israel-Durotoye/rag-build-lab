# Campus Guide backend for a Hugging Face Docker Space.
# Build context: the folder that deploy-space.sh assembles (rag_core/, backend/,
# pyproject.toml, this Dockerfile). Spaces serve the app on port 7860.
FROM python:3.11-slim

# OpenCV (used by RapidOCR) needs libGL and glib at import time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000; give it the app and a writable home.
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY --chown=user pyproject.toml ./
COPY --chown=user rag_core ./rag_core
COPY --chown=user backend ./backend

USER user
RUN pip install --user -e . -r backend/requirements.txt

# Bake the embedding model into the image so a cold start needs no download.
ENV CAMPUS_MODEL_DIR=/app/models
RUN python -c "from backend.embeddings import FastEmbedder; from pathlib import Path; \
FastEmbedder('BAAI/bge-small-en-v1.5', Path('/app/models'))"

# Documents, indexes, settings and welcome pages. On a Space this disk is
# ephemeral unless persistent storage is enabled, in which case set
# CAMPUS_DATA_DIR=/data in the Space settings.
ENV CAMPUS_DATA_DIR=/home/user/data \
    CAMPUS_WORKSPACE_TTL_DAYS=30

EXPOSE 7860
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "7860"]

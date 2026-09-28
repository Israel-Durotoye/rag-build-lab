"""Semantic embeddings with FastEmbed (ONNX, CPU).

The default model, BAAI/bge-small-en-v1.5, maps text to 384-number vectors
whose cosine similarity reflects meaning, so "phone" can match "GSM handset".
Its weights are downloaded once (about 70 MB) into the data directory.
"""
from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock
from typing import Callable, Protocol

import numpy as np

log = logging.getLogger('campus_guide')
BATCH = 16


class Embedder(Protocol):
    name: str
    dimensions: int

    def embed_documents(self, texts: list[str], progress: Callable[[int, int], None] | None = None) -> np.ndarray:
        """Unit-length vectors, one row per text."""

    def embed_query(self, text: str) -> np.ndarray:
        """Unit-length vector for a search query."""


def _normalize(matrix: np.ndarray) -> np.ndarray:
    matrix = np.asarray(matrix, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return matrix / np.where(norms == 0, 1, norms)


class FastEmbedder:
    def __init__(self, model: str, cache_dir: Path):
        from fastembed import TextEmbedding

        cache_dir.mkdir(parents=True, exist_ok=True)
        self.name = model
        self._model = TextEmbedding(model, cache_dir=str(cache_dir))
        self._lock = Lock()
        self.dimensions = int(self.embed_query('dimension probe').shape[0])

    def embed_documents(self, texts, progress=None):
        rows = []
        for start in range(0, len(texts), BATCH):
            with self._lock:
                rows.extend(self._model.embed(texts[start:start + BATCH], batch_size=BATCH))
            if progress:
                progress(min(start + BATCH, len(texts)), len(texts))
        return _normalize(np.array(rows)) if rows else np.zeros((0, self.dimensions), dtype=np.float32)

    def embed_query(self, text):
        with self._lock:
            vector = next(iter(self._model.query_embed([text])))
        return _normalize(np.array(vector))


_embedder: Embedder | None = None
_failed = False
_lock = Lock()


def get_embedder(enabled: bool, model: str, cache_dir: Path) -> Embedder | None:
    """The shared embedder, or None when disabled or it cannot load (for
    example, no network on first use). Retrieval then uses keywords only."""
    global _embedder, _failed
    if not enabled or _failed:
        return None
    with _lock:
        if _embedder is None and not _failed:
            try:
                _embedder = FastEmbedder(model, cache_dir)
            except Exception:
                log.exception('Embedding model failed to load; falling back to keyword retrieval')
                _failed = True
    return _embedder


def status(enabled: bool) -> str:
    """'off', 'loading', 'ready' or 'failed', without waiting for the model."""
    if not enabled:
        return 'off'
    if _failed:
        return 'failed'
    return 'ready' if _embedder is not None else 'loading'

"""Optical character recognition for scanned pages and text inside images.

RapidOCR runs PP-OCR models on onnxruntime. Its models ship inside the
package, so OCR works offline with no system binaries. The engine is loaded
on first use and shared across requests.
"""
from __future__ import annotations

import logging
from threading import Lock
from typing import Protocol

# Lines the recogniser is less sure of than this are dropped.
MIN_CONFIDENCE = 0.5


class OcrEngine(Protocol):
    name: str

    def read(self, image: bytes) -> list[str]:
        """Return recognised text lines, top to bottom, from a PNG image."""


class RapidOcrEngine:
    name = 'RapidOCR'

    def __init__(self):
        from rapidocr import RapidOCR

        # RapidOCR logs model loading at INFO and resets its level on every
        # Logger it builds; a filter survives that and keeps the log readable.
        logging.getLogger('RapidOCR').addFilter(lambda record: record.levelno >= logging.WARNING)
        self._engine = RapidOCR()
        self._lock = Lock()

    def read(self, image: bytes) -> list[str]:
        with self._lock:
            result = self._engine(image)
        texts = result.txts or ()
        scores = result.scores or (1.0,) * len(texts)
        return [text.strip() for text, score in zip(texts, scores) if text.strip() and score >= MIN_CONFIDENCE]


_engine: OcrEngine | None = None
_failed = False
_lock = Lock()


def get_engine(enabled: bool = True) -> OcrEngine | None:
    """The shared engine, or None when OCR is disabled or cannot load."""
    global _engine, _failed
    if not enabled or _failed:
        return None
    with _lock:
        if _engine is None and not _failed:
            try:
                _engine = RapidOcrEngine()
            except Exception:
                logging.getLogger(__name__).exception('OCR engine failed to load')
                _failed = True
    return _engine

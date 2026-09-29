"""Test doubles and file builders for the web backends' test suites.

Nothing here calls a model or downloads weights: the embedder is a
deterministic bag of words and the model client replays a script.
"""
from __future__ import annotations

import re
import zlib
from types import SimpleNamespace as NS

import numpy as np

from ..providers import OpenAICompatible

# The fake embedder treats these words as the same concept, standing in for
# what a real embedding model learns about meaning.
SYNONYMS = {'phone': 'handset', 'mobile': 'handset', 'gsm': 'handset', 'cellphone': 'handset',
            'exam': 'examination', 'exams': 'examination'}


class FakeEmbedder:
    """Deterministic bag-of-words vectors: fast, offline, and meaning-aware
    for the synonyms above."""
    name = 'fake-embedder'
    dimensions = 64

    def __init__(self, synonyms: dict[str, str] | None = None):
        self.synonyms = {**SYNONYMS, **(synonyms or {})}

    def _vector(self, text):
        vector = np.zeros(self.dimensions, dtype=np.float32)
        for word in re.findall(r'[a-z]+', text.lower()):
            word = self.synonyms.get(word, word)
            if len(word) > 3:
                # hash() is randomised per process; a stable checksum keeps
                # retrieval contract tests deterministic across test runs.
                vector[zlib.crc32(word.encode()) % self.dimensions] += 1
        norm = np.linalg.norm(vector)
        return vector / norm if norm else vector

    def embed_documents(self, texts, progress=None):
        rows = [self._vector(t) for t in texts]
        if progress:
            progress(len(texts), len(texts))
        return np.array(rows) if rows else np.zeros((0, self.dimensions), dtype=np.float32)

    def embed_query(self, text):
        return self._vector(text)


class HTTPError(Exception):
    def __init__(self, status_code):
        super().__init__(f'status {status_code}')
        self.status_code = status_code


class ScriptedCompletions:
    """Stands in for client.chat.completions. Each script item is a reply:
    a string (non-streamed content), an exception, or a list of stream
    parts: ('reasoning', text), ('token', text) or an exception."""
    def __init__(self, *script):
        self.script, self.calls = list(script), []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if callable(item) and not isinstance(item, Exception):
            item = item(kwargs)
        if isinstance(item, Exception):
            raise item
        if kwargs.get('stream'):
            return self._stream(item)
        return NS(choices=[NS(message=NS(content=item, reasoning_content=None), finish_reason='stop')],
                  usage=NS(prompt_tokens=50, completion_tokens=10, total_tokens=60, completion_tokens_details=None))

    @staticmethod
    def _stream(parts):
        for part in parts:
            if isinstance(part, Exception):
                raise part
            kind, text = part
            delta = NS(content=text if kind == 'token' else None, reasoning_content=text if kind == 'reasoning' else None)
            yield NS(choices=[NS(delta=delta, finish_reason=None)], usage=None)
        yield NS(choices=[NS(delta=NS(content=None, reasoning_content=None), finish_reason='stop')], usage=None)
        yield NS(choices=[], usage=NS(prompt_tokens=900, completion_tokens=40, total_tokens=940,
                                     completion_tokens_details=NS(reasoning_tokens=12)))


def model_with(*script, **kwargs):
    """(model, completions): an OpenAICompatible client that replays ``script``."""
    completions = ScriptedCompletions(*script)
    model = OpenAICompatible('deepseek-v4-flash', client=NS(chat=NS(completions=completions)),
                             sleep=lambda seconds: None, **kwargs)
    return model, completions


def text_png(lines, fontsize=16, width=None, dpi=200):
    """Render text lines to a PNG, standing in for a scan or a picture."""
    import pymupdf

    width = width or 40 + fontsize * 0.6 * max(len(line) for line in lines)
    doc = pymupdf.open()
    page = doc.new_page(width=width, height=40 + len(lines) * fontsize * 1.8)
    for index, line in enumerate(lines):
        page.insert_text((20, 30 + index * fontsize * 1.8), line, fontsize=fontsize)
    return page.get_pixmap(dpi=dpi).tobytes('png')


def pdf_bytes(pages):
    """pages: list of (text_lines, image_lines_or_None, image_only)."""
    import pymupdf

    doc = pymupdf.open()
    for number, (text_lines, image_lines, image_only) in enumerate(pages, 1):
        page = doc.new_page()
        if image_only:
            page.insert_image(page.rect, stream=text_png(text_lines, width=595))
            continue
        y = 72
        for line in text_lines:
            if line == '':
                y += 16
                continue
            page.insert_text((72, y), line, fontsize=11)
            y += 16
        page.insert_text((290, 810), str(number), fontsize=9)  # a running page number
        if image_lines:
            page.insert_image(pymupdf.Rect(72, 400, 523, 700), stream=text_png(image_lines))
    return doc.tobytes()

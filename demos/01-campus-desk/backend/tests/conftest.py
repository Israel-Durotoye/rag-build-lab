import io
import json
import re
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace as NS

import numpy as np
import pytest

DEMO_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DEMO_DIR))

from rag_core.providers import OpenAICompatible  # noqa: E402

from backend.app import create_app  # noqa: E402
from backend.settings import Settings  # noqa: E402

CORPUS = json.loads((DEMO_DIR / 'corpus.json').read_text())
EVALUATION = json.loads((DEMO_DIR / 'evaluation.json').read_text())

# The fake embedder treats these words as the same concept, standing in for
# what a real embedding model learns about meaning.
SYNONYMS = {'phone': 'handset', 'mobile': 'handset', 'gsm': 'handset', 'cellphone': 'handset',
            'exam': 'examination', 'exams': 'examination'}


class FakeEmbedder:
    """Deterministic bag-of-words vectors: fast, offline, and meaning-aware
    for the synonyms above."""
    name = 'fake-embedder'
    dimensions = 64

    def _vector(self, text):
        vector = np.zeros(self.dimensions, dtype=np.float32)
        for word in re.findall(r'[a-z]+', text.lower()):
            word = SYNONYMS.get(word, word)
            if len(word) > 3:
                vector[hash(word) % self.dimensions] += 1
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
    completions = ScriptedCompletions(*script)
    model = OpenAICompatible('deepseek-v4-flash', client=NS(chat=NS(completions=completions)),
                             sleep=lambda seconds: None, **kwargs)
    return model, completions


def settings(tmp_path, **overrides):
    base = dict(api_key='test-key', model='deepseek-v4-flash', fallback_models=(), base_url='https://agentrouter.org/v1',
                timeout=60.0, retries=2, user_agent='test', ocr_enabled=True, embeddings_enabled=True,
                embedding_model='fake-embedder', data_dir=tmp_path, top_k=4, max_documents=3, workspace_ttl_days=7)
    return Settings(**{**base, **overrides})


def make_client(tmp_path, *, model=None, embedder='fake', **overrides):
    from fastapi.testclient import TestClient

    app = create_app(settings(tmp_path, **overrides), model=model,
                     embedder=FakeEmbedder() if embedder == 'fake' else embedder, preload=False)
    return TestClient(app)


def workspace_id():
    return uuid.uuid4().hex


def headers(ws):
    return {'X-Workspace-Id': ws}


def events(response):
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def load_corpus(client, ws, documents=None):
    """Put pre-sectioned documents (default: the fixture handbook) into a workspace."""
    from backend.ingest import ingest_sections

    services = client.app.state.services
    return ingest_sections(services.store.workspace(ws), documents or CORPUS, services.embedder())


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


@pytest.fixture
def docx_bytes():
    def build(with_headings=True, picture_lines=None):
        import docx
        from docx.shared import Inches

        document = docx.Document()
        if with_headings:
            document.add_heading('Leave policy', level=1)
            document.add_paragraph('Every full-time staff member earns 21 days of annual leave.')
            document.add_heading('Laboratory safety', level=1)
            document.add_paragraph('Safety goggles are compulsory in the chemistry laboratory.')
            table = document.add_table(rows=2, cols=2)
            table.cell(0, 0).text, table.cell(0, 1).text = 'Room', 'Closes'
            table.cell(1, 0).text, table.cell(1, 1).text = 'Workshop', '17:30'
        else:
            document.add_paragraph('Staff earn 21 days of annual leave each year.')
            document.add_paragraph('Leave requests go to the registrar two weeks ahead.')
        if picture_lines:
            document.add_picture(io.BytesIO(text_png(picture_lines)), width=Inches(4))
        buffer = io.BytesIO()
        document.save(buffer)
        return buffer.getvalue()
    return build

import io
import json
import sys
import uuid
from pathlib import Path

import pytest

DEMO_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DEMO_DIR))

from rag_core.web.testing import (FakeEmbedder, HTTPError, ScriptedCompletions, model_with,  # noqa: E402, F401
                                  pdf_bytes, text_png)

from backend.app import create_app  # noqa: E402
from backend.settings import Settings  # noqa: E402

CORPUS = json.loads((DEMO_DIR / 'corpus.json').read_text())
EVALUATION = json.loads((DEMO_DIR / 'evaluation.json').read_text())


def settings(tmp_path, **overrides):
    base = dict(api_key='test-key', model='deepseek-v4-flash', fallback_models=(), base_url='https://agentrouter.org/v1',
                timeout=60.0, retries=2, user_agent='test', ocr_enabled=True, embeddings_enabled=True,
                embedding_model='fake-embedder', data_dir=tmp_path, model_dir=tmp_path / 'models', top_k=4, max_documents=3, workspace_ttl_days=7)
    return Settings(**{**base, **overrides})


def make_client(tmp_path, *, model=None, embedder='fake', app_options=None, **overrides):
    from fastapi.testclient import TestClient

    app = create_app(settings(tmp_path, **overrides), model=model,
                     embedder=FakeEmbedder() if embedder == 'fake' else embedder, preload=False,
                     **(app_options or {}))
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

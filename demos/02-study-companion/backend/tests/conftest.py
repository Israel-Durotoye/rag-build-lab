import json
import sys
import uuid
from pathlib import Path

import pytest

DEMO_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DEMO_DIR))

from rag_core.web.testing import FakeEmbedder, HTTPError, model_with, pdf_bytes  # noqa: E402, F401

from backend.app import create_app  # noqa: E402
from backend.ingest import ingest_sections  # noqa: E402
from backend.settings import Settings  # noqa: E402

CORPUS = json.loads((DEMO_DIR / 'corpus.json').read_text())
QUESTIONS = json.loads((DEMO_DIR / 'questions.json').read_text())
EXCEPTION = 'does not guarantee stability'
# The settings the command-line demo and its saved runs use (config.json).
BASELINE = {'k': 4, 'budgetWords': 250, 'expandBelowWords': 60}

NOTES = """# Photosynthesis

Photosynthesis is the process by which green plants turn light energy into chemical energy stored in glucose.
It takes place in the chloroplasts, mainly in the leaves.

## Light-dependent reactions

The light-dependent reactions happen in the thylakoid membranes and need light directly.
They split water, release oxygen and produce ATP and NADPH.

## Calvin cycle

The Calvin cycle happens in the stroma and uses ATP and NADPH to fix carbon dioxide into glucose.
It does not need light directly, but it stops in the dark because it depends on the products of the light reactions.

## Limiting factors

Light intensity, carbon dioxide concentration and temperature each limit the rate of photosynthesis.
Raising temperature speeds the rate up only until enzymes begin to denature.
"""


def settings(tmp_path, **overrides):
    base = dict(api_key='test-key', model='deepseek-v4-flash', fallback_models=(), base_url='https://agentrouter.org/v1',
                timeout=60.0, retries=2, user_agent='test', ocr_enabled=True, embeddings_enabled=True,
                embedding_model='fake-embedder', data_dir=tmp_path, embedding_dir=tmp_path / 'models',
                max_documents=3, workspace_ttl_days=7)
    return Settings(**{**base, **overrides})


def make_client(tmp_path, *, model=None, embedder='fake', app_options=None, **overrides):
    from fastapi.testclient import TestClient

    app = create_app(settings(tmp_path, **overrides), model=model,
                     embedder=FakeEmbedder() if embedder == 'fake' else embedder, ocr=None, preload=False,
                     **(app_options or {}))
    return TestClient(app)


def workspace_id():
    return uuid.uuid4().hex


def headers(ws):
    return {'X-Workspace-Id': ws}


def events(response):
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def workspace_of(client, ws):
    return client.app.state.services.store.workspace(ws)


def load_sample(client, ws, documents=None):
    """Put pre-sectioned notes (default: the bundled sample) into a workspace."""
    services = client.app.state.services
    return ingest_sections(services.store.workspace(ws), documents or CORPUS, services.embedder())


def upload(client, ws, name='Biology notes.md', data=None, content_type='text/markdown'):
    return client.post('/api/documents', files={'file': (name, data or NOTES.encode(), content_type)},
                       headers=headers(ws))


def ask(client, ws, message, **body):
    return client.post('/api/ask', json={'message': message, **body}, headers=headers(ws))


@pytest.fixture
def ws():
    return workspace_id()

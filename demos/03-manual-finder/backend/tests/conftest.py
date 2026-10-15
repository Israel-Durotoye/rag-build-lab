import json
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest

DEMO_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(DEMO_DIR))

from rag_core.web.testing import FakeEmbedder, HTTPError, model_with  # noqa: E402, F401

from backend.app import create_app  # noqa: E402
from backend.settings import Settings  # noqa: E402
from backend.variants import Registry, applies  # noqa: E402

CORPUS = json.loads((DEMO_DIR / 'corpus.json').read_text())
MODELS = json.loads((DEMO_DIR / 'library' / 'models.json').read_text())
QUERIES = json.loads((DEMO_DIR / 'queries.json').read_text())
SAMPLE_MODELS = [m['id'] for m in MODELS['models']]

# A synthetic manual for upload tests (not a real product): a code table whose
# rows name different models, a list whose items do too, a note, and a
# paragraph long enough to be split.
LONG = ' '.join(f'Step {n} of the synthetic cleaning routine wipes one more panel of the test casing.'
                for n in range(1, 21))
MANUAL = f"""# Synthetic test manual

This synthetic manual covers the Demo Box 7 and the Demo Box 7 Pro. It exists only for these tests.

## Error codes

| Code | Meaning |
| --- | --- |
| E17 | Demo Box 7 (B7): the fan has stalled. |
| E18 | Demo Box 7 Pro: the lid sensor is open. |

## Status lights

- Demo Box 7: the green light blinks while it starts.
- Demo Box 7 Pro: the blue light blinks while it starts.

## Cleaning

Warning: unplug the box before cleaning it.

{LONG}
"""
DEMO_MODELS = {
    'models': [{'name': 'Demo Box 7', 'id': 'box-7', 'short': 'Box 7', 'aliases': ['Box 7', 'B7']},
               {'name': 'Demo Box 7 Pro', 'id': 'box-7-pro', 'short': 'Box 7 Pro', 'aliases': ['Box 7 Pro']}],
    'families': [{'name': 'Demo Box', 'id': 'demo-box', 'members': ['box-7', 'box-7-pro']}]}


def settings(tmp_path, **overrides):
    base = dict(api_key='test-key', model='deepseek-v4-flash', fallback_models=(),
                base_url='https://agentrouter.org/v1', timeout=60.0, retries=2, user_agent='test', ocr_enabled=True,
                embeddings_enabled=True, embedding_model='fake-embedder', data_dir=tmp_path,
                embedding_dir=tmp_path / 'models', max_documents=16, workspace_ttl_days=7)
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


def load_sample(client, ws):
    response = client.post('/api/sample', headers=headers(ws))
    assert response.status_code == 200, response.text
    return response.json()


def upload(client, ws, name='Synthetic test manual.md', data=None, content_type='text/markdown'):
    return client.post('/api/documents', files={'file': (name, data or MANUAL.encode(), content_type)},
                       headers=headers(ws))


def ask(client, ws, message, **body):
    return client.post('/api/ask', json={'message': message, **body}, headers=headers(ws))


def done(response):
    """(the final 'done' event, every event) of an /api/ask stream."""
    assert response.status_code == 200, response.text
    stream = events(response)
    assert stream[-1]['type'] == 'done', stream[-1]
    return stream[-1], stream


def event(stream, kind):
    return next(e for e in stream if e['type'] == kind)


def sample_registry():
    return Registry.from_lists(MODELS['models'], MODELS['families'], MODELS.get('outside', []))


def chunk_applies(chunk, model, revision=None):
    """Whether a passage (a Library.chunks() entry) applies to ``model``."""
    return applies({'models': chunk['models'], 'revisions': chunk['revisions']}, chunk['docModels'], model, revision)


@contextmanager
def generating(client, *script, **options):
    """Swap a scripted model client into a running app; yields its calls."""
    model, completions = model_with(*script, **options)
    services = client.app.state.services
    previous, services.model = services.model, model
    try:
        yield completions
    finally:
        services.model = previous


@pytest.fixture
def ws():
    return workspace_id()


@pytest.fixture(scope='module')
def sample(tmp_path_factory):
    """One app per test module with the sample library loaded into one
    workspace (no model key, the fake embedder). Tests that change a
    workspace use a workspace of their own."""
    with make_client(tmp_path_factory.mktemp('finder')) as client:
        library = workspace_id()
        load_sample(client, library)
        yield client, library

import pytest

from backend.app import API_VERSION, API_VERSION_HEADER
from backend.preferences import DEFAULTS
from backend.settings import Settings
from conftest import events, headers, load_sample, make_client, model_with, upload, workspace_id


def test_status_reports_capabilities(tmp_path):
    model, _ = model_with('ok')
    with make_client(tmp_path, model=model) as client:
        response = client.get('/api/status')
        body = response.json()
    assert body['status'] == 'ok' and body['name'] == 'Study Companion' and body['generation'] is True
    assert body['apiVersion'] == API_VERSION and response.headers[API_VERSION_HEADER] == str(API_VERSION)
    assert response.headers['cache-control'] == 'no-store'
    assert body['embeddings']['status'] == 'ready' and body['retrieval']['default'] == 'hybrid'
    assert body['chunking'] == {'modes': ['section', 'fixed'], 'default': 'section', 'sectionMaxWords': 220}
    assert body['practice'] == {'kinds': ['quiz', 'flashcards', 'recall'], 'count': [3, 12]}
    assert (body['model'], body['provider']) == ('deepseek-v4-flash', 'agentrouter.org')
    with make_client(tmp_path, embedder=None) as client:
        body = client.get('/api/status').json()
    assert body['generation'] is False and body['retrieval']['default'] == 'keyword'
    assert body['embeddings']['status'] == 'off'


def test_public_api_prefix_can_rewrite_around_a_host_namespace(tmp_path):
    options = {'route_prefix': '/study-api', 'public_prefix': '/api'}
    with make_client(tmp_path, embedder=None, app_options=options) as client:
        public = client.get('/api/status')
        internal = client.get('/study-api/status')
        ws = workspace_id()
        added = client.post('/api/sample', headers=headers(ws))
    assert public.status_code == 200 and public.json()['apiVersion'] == API_VERSION
    assert public.headers[API_VERSION_HEADER] == str(API_VERSION) and internal.status_code == 200
    assert added.status_code == 200 and added.json()['documents'][0]['id'] == 'controls'


@pytest.mark.parametrize('value', [None, 'short', 'Z' * 32, '../' + 'a' * 29])
def test_workspace_id_is_required_and_validated(tmp_path, value):
    with make_client(tmp_path) as client:
        for path in ('/api/documents', '/api/settings', '/api/practice', '/api/sample'):
            response = client.get(path, headers={'X-Workspace-Id': value} if value else {})
            assert response.status_code == 400 and 'workspace' in response.json()['error']
            assert response.headers[API_VERSION_HEADER] == str(API_VERSION)


def test_settings_start_at_the_defaults_and_shape_the_prompt(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        first = client.get('/api/settings', headers=headers(ws)).json()
        assert first['settings'] == DEFAULTS == first['defaults']
        assert [level['id'] for level in first['levels']] == ['simple', 'standard', 'exam']
        assert first['ranges']['chunkWords'] == [20, 200]
        assert '“Synthetic control systems study notes”' in first['prompt']
        assert 'Explanation style (Standard, chosen by the student)' in first['prompt']

        saved = client.put('/api/settings', headers=headers(ws), json={
            'level': 'exam', 'instructions': '  Use British spelling.  ', 'notFound': 'Not in these notes.', 'k': 3}).json()
        assert saved['settings'] == {**DEFAULTS, 'level': 'exam', 'instructions': 'Use British spelling.',
                                     'notFound': 'Not in these notes.', 'k': 3}
        assert 'Explanation style (Exam revision' in saved['prompt'] and 'Use British spelling.' in saved['prompt']
        assert 'begin your reply with exactly "Not in these notes."' in saved['prompt']
        assert client.get('/api/settings', headers=headers(ws)).json()['settings'] == saved['settings']

        cleared = client.put('/api/settings', json={'notFound': '', 'instructions': ''}, headers=headers(ws)).json()
        assert cleared['settings']['notFound'] == DEFAULTS['notFound'] and cleared['settings']['instructions'] == ''
        assert cleared['settings']['level'] == 'exam'
        assert client.get('/api/settings', headers=headers(workspace_id())).json()['settings'] == DEFAULTS


def test_settings_reject_invalid_values(tmp_path, ws):
    with make_client(tmp_path) as client:
        for body in ({'level': 'phd'}, {'instructions': 'x' * 2001}, {'notFound': 'two\nlines'}, {'k': 0}, {'k': 11},
                     {'chunkWords': 19}, {'chunkWords': 50.5}, {'budgetWords': True}, {'expandBelowWords': '60'},
                     {'assistantName': 'Tutor'}, {'instructions': 5}):
            response = client.put('/api/settings', json=body, headers=headers(ws))
            assert response.status_code == 400 and response.json()['error'], body
        assert client.put('/api/settings', content='[]', headers={**headers(ws), 'Content-Type': 'application/json'}
                          ).status_code == 400
        assert client.get('/api/settings', headers=headers(ws)).json()['settings'] == DEFAULTS


def test_an_overview_is_written_once_and_kept(tmp_path, ws):
    reply = ('{"summary": "Notes on feedback control.", "keyTerms": ["Negative feedback", "Stability", ""], '
             '"questions": ["Does negative feedback guarantee stability?"]}')
    model, completions = model_with(f'```json\n{reply}\n```')
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        overview = client.post('/api/documents/controls/overview', headers=headers(ws)).json()
        assert overview == {'summary': 'Notes on feedback control.', 'keyTerms': ['Negative feedback', 'Stability'],
                            'questions': ['Does negative feedback guarantee stability?'], 'model': 'deepseek-v4-flash'}
        assert client.post('/api/documents/controls/overview', headers=headers(ws)).json() == overview
        assert len(completions.calls) == 1
        assert 'Section headings:\n- Negative feedback' in completions.calls[0]['messages'][1]['content']
        assert client.get('/api/documents', headers=headers(ws)).json()['documents'][0]['overview'] == overview
        assert client.post('/api/documents/missing/overview', headers=headers(ws)).status_code == 404
    with make_client(tmp_path, model=None) as client:
        load_sample(client, workspace_id())
        other = workspace_id()
        load_sample(client, other)
        assert client.post('/api/documents/controls/overview', headers=headers(other)).status_code == 503


def test_an_overview_the_model_gets_wrong_is_an_error_not_a_crash(tmp_path, ws):
    model, _ = model_with('I would rather chat.')
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        response = client.post('/api/documents/controls/overview', headers=headers(ws))
    assert response.status_code == 502 and 'could not be written' in response.json()['error']


def test_every_reply_carries_the_contract_header_even_errors(tmp_path, ws):
    with make_client(tmp_path) as client:
        replies = [client.get('/api/documents/nope', headers=headers(ws)), client.post('/api/ask', headers=headers(ws)),
                   client.get('/api/unknown'), upload(client, ws)]
    assert [r.status_code for r in replies] == [404, 415, 404, 200]
    assert all(r.headers[API_VERSION_HEADER] == str(API_VERSION) for r in replies)
    assert events(replies[-1])[-1]['type'] == 'done'


def test_settings_read_the_environment(tmp_path):
    env = {'STUDY_MODEL_API_KEY': ' key ', 'STUDY_MODEL': 'deepseek-ai/DeepSeek-V4-Flash',
           'STUDY_MODEL_BASE_URL': 'https://router.huggingface.co/v1', 'STUDY_MODEL_FALLBACKS': 'a, b,',
           'STUDY_MODEL_RETRIES': '1', 'STUDY_EMBEDDINGS': 'off', 'STUDY_DATA_DIR': str(tmp_path),
           'STUDY_MAX_DOCUMENTS': '5'}
    settings = Settings.from_env(env)
    assert (settings.api_key, settings.model, settings.provider) == ('key', env['STUDY_MODEL'], 'router.huggingface.co')
    assert settings.fallback_models == ('a', 'b') and settings.retries == 1 and settings.generation
    assert not settings.embeddings_enabled and settings.ocr_enabled and settings.max_documents == 5
    assert settings.embedding_dir == tmp_path / 'models' and settings.timeout == 60.0

    shared = Settings.from_env({'AGENTROUTER_API_KEY': 'campus', 'AGENTROUTER_MODEL': 'deepseek-v4-flash',
                                'AGENTROUTER_TIMEOUT_MS': '30000'})
    assert (shared.api_key, shared.timeout, shared.provider) == ('campus', 30.0, 'agentrouter.org')
    both = Settings.from_env({'AGENTROUTER_API_KEY': 'campus', 'STUDY_MODEL_API_KEY': 'study'})
    assert both.api_key == 'study'
    assert Settings.from_env({}).model_client() is None
    with pytest.raises(ValueError, match='STUDY_MODEL_RETRIES'):
        Settings.from_env({'STUDY_MODEL_RETRIES': '9'})
    with pytest.raises(ValueError, match='STUDY_MAX_DOCUMENTS must be a number'):
        Settings.from_env({'STUDY_MAX_DOCUMENTS': 'many'})

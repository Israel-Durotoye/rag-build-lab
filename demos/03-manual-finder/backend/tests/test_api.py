from fractions import Fraction

import pytest

from rag_core.web.retrieval import fuse

from backend.app import API_VERSION, API_VERSION_HEADER
from backend.preferences import DEFAULTS
from backend.settings import DEMO_DIR, Settings
from conftest import (CORPUS, DEMO_MODELS, QUERIES, SAMPLE_MODELS, ask, chunk_applies, done, events, headers,
                      make_client, model_with, upload, workspace_id, workspace_of)

VERSION = str(API_VERSION)


def test_status_reports_capabilities(tmp_path):
    model, _ = model_with('ok')
    with make_client(tmp_path, model=model) as client:
        response = client.get('/api/status')
    body = response.json()
    assert body['status'] == 'ok' and body['name'] == 'Finder' and body['generation'] is True
    assert body['apiVersion'] == API_VERSION == 1 and response.headers[API_VERSION_HEADER] == VERSION
    assert API_VERSION_HEADER == 'X-Manual-API-Version' and response.headers['cache-control'] == 'no-store'
    assert (body['model'], body['provider'], body['fallbackModels']) == ('deepseek-v4-flash', 'agentrouter.org', [])
    assert body['embeddings'] == {'status': 'ready', 'model': 'fake-embedder'}
    assert body['ocr'] == {'engine': 'RapidOCR', 'enabled': True}
    assert body['retrieval'] == {'modes': ['hybrid', 'keyword', 'semantic'], 'default': 'hybrid', 'rrfConstant': 60,
                                 'tieBreak': 'best-rank', 'candidates': 20}
    assert body['limits'] == {'fileBytes': 40 * 1024 * 1024, 'documents': 16}
    with make_client(tmp_path, embedder=None) as client:
        body = client.get('/api/status').json()
    assert body['generation'] is False and body['embeddings']['status'] == 'off'
    assert body['retrieval']['default'] == 'keyword'


def test_a_public_prefix_can_be_rewritten_to_the_routes(tmp_path):
    options = {'route_prefix': '/finder-api', 'public_prefix': '/api'}
    with make_client(tmp_path, embedder=None, app_options=options) as client:
        public = client.get('/api/status')
        internal = client.get('/finder-api/status')
        added = client.post('/api/sample', headers=headers(workspace_id()))
    assert public.status_code == internal.status_code == 200 and public.json()['apiVersion'] == API_VERSION
    assert public.headers[API_VERSION_HEADER] == VERSION
    assert added.status_code == 200 and added.json()['documents'][0]['id'] == CORPUS[0]['id']


ROUTES = [('get', '/api/library', None), ('post', '/api/sample', None), ('get', '/api/documents/rpi-hardware', None),
          ('delete', '/api/documents/rpi-hardware', None), ('get', '/api/models/rpi-3b/guide', None),
          ('get', '/api/codes', None), ('get', '/api/codes/suggest?q=P1', None), ('get', '/api/settings', None),
          ('put', '/api/settings', {'k': 3}), ('post', '/api/ask', {'message': 'What does E17 mean?'}),
          ('post', '/api/lab', {'query': 'P102'}), ('get', '/api/evaluation', None),
          ('post', '/api/evaluation/run', {}), ('get', '/api/evaluation/runs/0123456789ab', None)]


@pytest.mark.parametrize('value', [None, '', 'short', 'A' * 32, 'g' * 32, 'a' * 33, '../' + 'a' * 29])
def test_workspace_id_is_required_and_validated(sample, value):
    client, _ = sample
    for method, path, body in ROUTES:
        sent = {'X-Workspace-Id': value} if value is not None else {}
        response = client.request(method, path, json=body, headers=sent)
        assert response.status_code == 400 and 'workspace ID' in response.json()['error'], (method, path)
        assert response.headers[API_VERSION_HEADER] == VERSION


def test_every_reply_carries_the_contract_header_even_errors(sample, ws):
    client, library = sample
    replies = [client.get('/api/documents/nope', headers=headers(library)),
               client.post('/api/ask', content='{"message": "x"}', headers=headers(library)),
               client.get('/api/unknown'),
               client.post('/api/ask', json={'message': ''}, headers=headers(library)),
               client.post('/api/ask', json={'message': 'What does E17 mean?'}, headers=headers(ws)),
               client.post('/api/lab', content='[1]', headers={**headers(library), 'Content-Type': 'application/json'}),
               client.get('/api/library', headers=headers(library)),
               ask(client, library, 'What does GPIO 22 select?', model='rpi-3b-plus', mode='keyword')]
    assert [r.status_code for r in replies] == [404, 415, 404, 400, 409, 400, 200, 200]
    assert all(r.headers[API_VERSION_HEADER] == VERSION for r in replies)
    assert replies[-1].headers['content-type'].startswith('application/x-ndjson')
    assert events(replies[-1])[-1]['type'] == 'done'


# ------------------------------------------------------------------ settings

def test_settings_start_at_the_defaults_and_shape_the_prompt(sample, ws):
    client, _ = sample
    first = client.get('/api/settings', headers=headers(ws)).json()
    assert first['settings'] == DEFAULTS == first['defaults']
    assert DEFAULTS['rrfConstant'] == 60 and DEFAULTS['budgetWords'] == 500 and DEFAULTS['mode'] == 'hybrid'
    assert [s['id'] for s in first['styles']] == ['brief', 'standard', 'steps']
    assert first['ranges'] == {'k': [1, 10], 'rrfConstant': [1, 1000], 'budgetWords': [100, 2000]}
    assert first['policy']['alwaysAsk'] is True and 'always asks which model' in first['policy']['text']
    assert 'Never add steps' in first['rules'] and DEFAULTS['notFound'] in first['rules']
    assert 'Answer style (Standard)' in first['prompt'] and 'no model was chosen' in first['prompt']

    saved = client.put('/api/settings', headers=headers(ws), json={
        'style': 'steps', 'instructions': '  Use British spelling.  ', 'notFound': 'Not in this manual.', 'k': 3,
        'rrfConstant': 10, 'budgetWords': 300, 'mode': 'keyword'}).json()
    assert saved['settings'] == {**DEFAULTS, 'style': 'steps', 'instructions': 'Use British spelling.',
                                 'notFound': 'Not in this manual.', 'k': 3, 'rrfConstant': 10, 'budgetWords': 300,
                                 'mode': 'keyword'}
    assert 'Answer style (Step by step)' in saved['prompt'] and 'Use British spelling.' in saved['prompt']
    assert 'begin your reply with exactly "Not in this manual."' in saved['prompt']
    assert client.get('/api/settings', headers=headers(ws)).json()['settings'] == saved['settings']

    cleared = client.put('/api/settings', json={'notFound': '', 'instructions': None}, headers=headers(ws)).json()
    assert cleared['settings']['notFound'] == DEFAULTS['notFound'] and cleared['settings']['instructions'] == ''
    assert cleared['settings']['style'] == 'steps' and cleared['settings']['k'] == 3
    assert client.get('/api/settings', headers=headers(workspace_id())).json()['settings'] == DEFAULTS


@pytest.mark.parametrize('body', [
    {'style': 'poem'}, {'mode': 'sql'}, {'instructions': 'x' * 2001}, {'instructions': 5},
    {'notFound': 'two\nlines'}, {'notFound': 'x' * 301}, {'k': 0}, {'k': 11}, {'k': 2.5}, {'k': True},
    {'rrfConstant': 0}, {'rrfConstant': 1001}, {'budgetWords': 99}, {'budgetWords': '300'}, {'assistantName': 'Finder'},
])
def test_settings_reject_invalid_values(sample, ws, body):
    client, _ = sample
    response = client.put('/api/settings', json=body, headers=headers(ws))
    assert response.status_code == 400 and response.json()['error'], body
    assert client.get('/api/settings', headers=headers(ws)).json()['settings'] == DEFAULTS


def test_settings_must_be_a_json_object(sample, ws):
    client, _ = sample
    assert client.put('/api/settings', content='[]', headers={**headers(ws), 'Content-Type': 'application/json'}
                      ).status_code == 400
    assert client.put('/api/settings', content='k=3', headers=headers(ws)).status_code == 415


def test_server_settings_read_the_environment(tmp_path):
    env = {'MANUAL_MODEL_API_KEY': ' key ', 'MANUAL_MODEL': 'deepseek-ai/DeepSeek-V4-Flash',
           'MANUAL_MODEL_BASE_URL': 'https://router.huggingface.co/v1', 'MANUAL_MODEL_FALLBACKS': 'a, b,',
           'MANUAL_MODEL_RETRIES': '1', 'MANUAL_MODEL_TIMEOUT_MS': '30000', 'MANUAL_EMBEDDINGS': 'off',
           'MANUAL_OCR': 'no', 'MANUAL_DATA_DIR': str(tmp_path), 'MANUAL_MAX_DOCUMENTS': '5'}
    settings = Settings.from_env(env)
    assert (settings.api_key, settings.model) == ('key', env['MANUAL_MODEL'])
    assert settings.provider == 'router.huggingface.co'
    assert settings.fallback_models == ('a', 'b') and settings.retries == 1 and settings.timeout == 30.0
    assert settings.generation and not settings.embeddings_enabled and not settings.ocr_enabled
    assert settings.max_documents == 5 and settings.data_dir == tmp_path
    assert settings.embedding_dir == tmp_path / 'models'

    shared = Settings.from_env({'AGENTROUTER_API_KEY': 'shared', 'AGENTROUTER_MODEL': 'deepseek-v4-flash',
                                'AGENTROUTER_TIMEOUT_MS': '20000'})
    assert (shared.api_key, shared.model, shared.timeout, shared.provider) == (
        'shared', 'deepseek-v4-flash', 20.0, 'agentrouter.org')
    assert shared.data_dir == DEMO_DIR / '.state' and shared.max_documents == 16 and shared.embeddings_enabled
    assert Settings.from_env({'AGENTROUTER_API_KEY': 'shared', 'MANUAL_MODEL_API_KEY': 'finder'}).api_key == 'finder'
    assert Settings.from_env({}).model_client() is None and not Settings.from_env({}).generation
    with pytest.raises(ValueError, match='MANUAL_MODEL_RETRIES'):
        Settings.from_env({'MANUAL_MODEL_RETRIES': '9'})
    with pytest.raises(ValueError, match='MANUAL_MAX_DOCUMENTS must be a number'):
        Settings.from_env({'MANUAL_MAX_DOCUMENTS': 'many'})


# ------------------------------------------------------------------ library

def test_a_new_workspace_is_empty_and_offers_the_sample(sample, ws):
    client, _ = sample
    empty = client.get('/api/library', headers=headers(ws)).json()
    assert (empty['documents'], empty['models'], empty['families'], empty['corpusVersion']) == ([], [], [], '')
    info = empty['sample']
    assert info['available'] and not info['loaded'] and info['licence'] == 'CC BY-SA 4.0'
    assert info['publisher'] == 'Raspberry Pi Ltd and Arduino' and info['queries'] == len(QUERIES)
    assert [(d['id'], d['units']) for d in info['documents']] == [(d['id'], len(d['sections'])) for d in CORPUS]


def test_the_sample_library_is_loaded_with_its_models(sample):
    client, library = sample
    body = client.get('/api/library', headers=headers(library)).json()
    assert body['sample']['loaded'] and len(body['corpusVersion']) == 64
    assert {d['id'] for d in body['documents']} == {d['id'] for d in CORPUS}
    assert all(d['sample'] and d['format'] == 'sample' and d['modelsConfirmed'] and d['embeddings']
               and d['source']['licence'] == 'CC BY-SA 4.0' for d in body['documents'])
    models = {m['id']: m for m in body['models']}
    assert set(models) == set(SAMPLE_MODELS)
    assert all(m['units'] > 0 and m['documents'] for m in models.values())
    assert {r['id'] for r in models['rpi-2b']['revisions']} == {'v1-1', 'v1-2'} and models['uno-r4-wifi']['codes'] > 0
    assert {f['id']: f['members'] for f in body['families']}['rpi-3'] == ['rpi-3b', 'rpi-3b-plus']
    # Loading it again changes nothing.
    again = client.post('/api/sample', headers=headers(library))
    assert again.status_code == 200 and [d['id'] for d in again.json()['documents']] == [d['id'] for d in CORPUS]
    assert client.get('/api/library', headers=headers(library)).json()['corpusVersion'] == body['corpusVersion']


def test_a_sample_manual_lists_its_units_with_their_tags(sample):
    client, library = sample
    detail = client.get('/api/documents/rpi-hardware', headers=headers(library)).json()
    assert detail['id'] == 'rpi-hardware' and detail['source']['publisher'] == 'Raspberry Pi Ltd'
    assert [m['id'] for m in detail['modelDefs']] == ['rpi-2b', 'rpi-3b', 'rpi-3b-plus']
    units = {u['text']: u for u in detail['units']}
    row = units['Code | Model | Revision | RAM | Manufacturer\na01041 | 2B | 1.1 | 1 GB | Sony UK']
    assert (row['models'], row['revisions'], row['kind']) == (['rpi-2b'], {'rpi-2b': ['v1-1']}, 'row')
    assert row['chunkId'] == f"rpi-hardware:{row['id']}:0" and 'A01041' in row['codes']
    assert any(e['code'] == 'A01041' and e['unitId'] == row['id'] for e in detail['codeEntries'])
    assert sum(len(s['unitIds']) for s in detail['sections']) == len(detail['units'])
    assert client.get('/api/documents/not-there', headers=headers(library)).status_code == 404
    assert client.get('/api/documents/Bad_Id', headers=headers(library)).status_code == 404


def test_the_sample_needs_room_in_the_workspace(tmp_path, ws):
    with make_client(tmp_path, embedder=None, max_documents=3) as client:
        response = client.post('/api/sample', headers=headers(ws))
    assert response.status_code == 409 and 'already holds 3 manuals' in response.json()['error']


def test_an_uploaded_manual_is_tagged_once_its_models_are_named(sample, ws):
    client, _ = sample
    stream = events(upload(client, ws))
    stages = [e.get('stage') for e in stream if e['type'] == 'progress']
    assert {'reading', 'sectioning', 'tagging', 'embedding', 'indexing'} <= set(stages)
    summary = stream[-1]['document']
    assert stream[-1]['type'] == 'done' and summary['format'] == 'text' and summary['name'] == 'Synthetic test manual'
    assert summary['models'] == [] and not summary['modelsConfirmed'] and summary['sections'] == 4
    assert summary['embeddings'] is True and summary['sample'] is False and summary['source'] is None
    doc_id = summary['id']
    detail = client.get(f'/api/documents/{doc_id}', headers=headers(ws)).json()
    assert [m['name'] for m in detail['suggestedModels']] == ['Demo Box 7', 'Demo Box 7 Pro']
    units = {u['id']: u for u in detail['units']}
    assert all(u['models'] is None and u['tag'] == 'document' for u in units.values())
    row = units['error-codes-u01']
    assert (row['kind'], row['header'], row['chunkId']) == ('row', 'Code | Meaning', f'{doc_id}:error-codes-u01:0')
    assert row['codes'] == ['E17', 'B7']  # before its models are named, B7 reads as a code

    tagged = client.put(f'/api/documents/{doc_id}/models', json=DEMO_MODELS, headers=headers(ws))
    assert tagged.status_code == 200
    detail = tagged.json()
    assert detail['models'] == ['box-7', 'box-7-pro'] and detail['modelsConfirmed']
    units = {u['id']: u for u in detail['units']}
    assert (units['error-codes-u01']['models'], units['error-codes-u01']['tag']) == (['box-7'], 'text')
    assert units['error-codes-u02']['models'] == ['box-7-pro']
    assert units['synthetic-test-manual-u01']['models'] == ['box-7', 'box-7-pro']
    assert units['cleaning-u01']['models'] is None and units['cleaning-u01']['tag'] == 'document'
    # A model's name is never one of its codes.
    assert units['error-codes-u01']['codes'] == ['E17']
    assert sorted((e['code'], tuple(e['models'])) for e in detail['codeEntries']) == [('E17', ('box-7',)),
                                                                                       ('E18', ('box-7-pro',))]
    library = client.get('/api/library', headers=headers(ws)).json()
    assert [m['id'] for m in library['models']] == ['box-7', 'box-7-pro'] and library['families'][0]['id'] == 'demo-box'
    assert library['documents'][0]['modelsConfirmed'] and not library['sample']['loaded']

    # Each model now sees its own row.
    found, _ = done(ask(client, ws, 'What does E17 mean?', model='box-7', mode='keyword'))
    assert found['card']['kind'] == 'found'
    assert found['card']['meaning'] == 'E17 | Demo Box 7 (B7): the fan has stalled.'
    missing, stream = done(ask(client, ws, 'What does E17 mean?', model='box-7-pro', mode='keyword'))
    assert missing['card']['kind'] == 'not_found'
    assert missing['card']['didYouMean'] == [{'code': 'E18', 'display': 'E18'}]
    assert [m['id'] for m in missing['card']['elsewhere']] == ['box-7']
    prompt = next(e for e in stream if e['type'] == 'context')['trace']['prompt']['messages'][1]['content']
    assert 'the fan has stalled' not in prompt


def test_an_upload_that_names_a_library_model_joins_it(sample, ws):
    client, _ = sample
    assert client.post('/api/sample', headers=headers(ws)).status_code == 200
    notes = ('# Board care notes\n\nThese synthetic notes cover one board. They exist only for these tests.\n\n'
             '## Storage\n\nKeep the R4 WiFi in its antistatic bag when it is not in use.\n')
    doc_id = events(upload(client, ws, name='Board care notes.md', data=notes.encode()))[-1]['document']['id']
    # "UNO R4 WiFi" is one of the sample model's names, though not its ID or display name.
    response = client.put(f'/api/documents/{doc_id}/models', json={'models': [{'id': '', 'name': 'UNO R4 WiFi'}]},
                          headers=headers(ws))
    assert response.status_code == 200
    detail = response.json()
    assert detail['models'] == ['uno-r4-wifi'] and detail['modelDefs'][0]['name'] == 'Arduino UNO R4 WiFi'
    storage = next(u for u in detail['units'] if 'antistatic' in u['text'])
    assert storage['models'] == ['uno-r4-wifi']  # "R4 WiFi" is read as the sample's model
    library = client.get('/api/library', headers=headers(ws)).json()
    assert sorted(m['id'] for m in library['models']) == sorted(SAMPLE_MODELS)  # no look-alike beside it
    result, _ = done(ask(client, ws, 'Does it need an antistatic bag?', model='uno-r4-wifi', mode='keyword'))
    assert storage['chunkId'] in [s['id'] for s in result['sources']]


def test_an_answer_from_a_manual_whose_models_are_unconfirmed_says_so(sample, ws):
    client, _ = sample
    assert client.post('/api/sample', headers=headers(ws)).status_code == 200
    assert events(upload(client, ws))[-1]['type'] == 'done'  # models not confirmed: it counts for every model
    result, _ = done(ask(client, ws, 'What does E17 mean?', model='uno-r3', mode='keyword'))
    assert result['card']['kind'] == 'found' and result['card']['unconfirmed'] is True
    assert any(source['unconfirmed'] for source in result['sources'])
    sample_card, _ = done(ask(client, ws, 'Which header pin is RA4M1 port P102?', model='uno-r4-wifi', mode='keyword'))
    assert sample_card['card']['unconfirmed'] is False


def test_the_sample_manuals_models_cannot_be_changed(sample):
    client, library = sample
    response = client.put('/api/documents/rpi-hardware/models', json=DEMO_MODELS, headers=headers(library))
    assert response.status_code == 409 and 'fixed' in response.json()['error']


def test_naming_models_checks_the_list(sample, ws):
    client, _ = sample
    doc_id = events(upload(client, ws))[-1]['document']['id']
    for body in ({'models': 'Box 7'}, {'models': [{'name': ''}]}, {'models': [{'name': 'Box 7', 'id': 'Bad Id'}]},
                 {'models': [], 'tags': []}):
        response = client.put(f'/api/documents/{doc_id}/models', json=body, headers=headers(ws))
        assert response.status_code == 400 and response.json()['error'], body
    assert client.put('/api/documents/not-there/models', json=DEMO_MODELS, headers=headers(ws)).status_code == 404
    assert client.put(f'/api/documents/{doc_id}/models', content='[]',
                      headers={**headers(ws), 'Content-Type': 'application/json'}).status_code == 400
    assert client.get(f'/api/documents/{doc_id}', headers=headers(ws)).json()['models'] == []


def test_a_manual_can_be_deleted(sample, ws):
    client, _ = sample
    doc_id = events(upload(client, ws))[-1]['document']['id']
    assert client.delete(f'/api/documents/{doc_id}', headers=headers(ws)).json() == {'deleted': doc_id}
    assert client.get(f'/api/documents/{doc_id}', headers=headers(ws)).status_code == 404
    assert client.delete(f'/api/documents/{doc_id}', headers=headers(ws)).status_code == 404
    assert client.delete('/api/documents/Bad_Id', headers=headers(ws)).status_code == 404
    library = client.get('/api/library', headers=headers(ws)).json()
    assert library['documents'] == [] and library['models'] == []
    assert workspace_of(client, ws).library.chunks() == {}
    assert ask(client, ws, 'What does E17 mean?').status_code == 409


def test_uploads_must_be_supported_readable_files(sample, ws):
    client, _ = sample
    wrong = upload(client, ws, name='manual.exe', data=b'MZ')
    assert wrong.status_code == 400 and 'PDF' in wrong.json()['error']
    legacy = upload(client, ws, name='manual.doc', data=b'x')
    assert legacy.status_code == 400 and '.docx' in legacy.json()['error']
    empty = client.post('/api/documents', files={'file': ('empty.md', b'', 'text/markdown')}, headers=headers(ws))
    assert events(empty)[-1] == {'type': 'error', 'error': 'This file is empty.'}
    assert client.get('/api/library', headers=headers(ws)).json()['documents'] == []


def test_a_full_workspace_refuses_another_manual(tmp_path, ws):
    with make_client(tmp_path, embedder=None, max_documents=1) as client:
        assert events(upload(client, ws))[-1]['type'] == 'done'
        refused = events(upload(client, ws, name='Second manual.md', data=b'# Other\n\nAnother synthetic manual.'))
    assert refused[-1] == {'type': 'error',
                           'error': 'This workspace already holds 1 manuals. Remove one to add another.'}


# ------------------------------------------------------------------ codes and guide

def test_the_codes_matrix_marks_codes_that_differ_between_models(sample):
    client, library = sample
    matrix = client.get('/api/codes', params={'differs': '1'}, headers=headers(library)).json()
    assert {m['id'] for m in matrix['models']} == set(SAMPLE_MODELS)
    assert matrix['rows'] and all(r['differs'] for r in matrix['rows'])
    assert matrix['counts']['codes'] == matrix['counts']['differing'] >= len(matrix['rows'])
    p102 = next(r for r in matrix['rows'] if r['code'] == 'P102')
    assert set(p102['cells']) == set(SAMPLE_MODELS) and p102['cells']['rpi-3b'] is None
    assert p102['cells']['uno-r4-minima']['meaning'] == 'D5 | P102 | GTIOC2B'
    assert p102['cells']['uno-r4-wifi']['meaning'] == 'D13 | P102 | GTIOC2B'
    assert p102['cells']['uno-r4-wifi']['chunkId'].startswith('uno-r4-wifi-manual:')
    assert p102['cells']['uno-r4-wifi']['header'] == 'Pin | RA4M1 | Timer'  # the row is shown under its columns

    every = client.get('/api/codes', headers=headers(library)).json()
    flags = [r['differs'] for r in every['rows']]
    assert every['counts']['codes'] > every['counts']['differing'] == matrix['counts']['differing']
    assert flags == sorted(flags, reverse=True)  # differing codes first
    searched = client.get('/api/codes', params={'q': 'p102'}, headers=headers(library)).json()['rows']
    assert 'P102' in [r['code'] for r in searched]
    assert all('p102' in ' '.join([r['code'], r['display'], *(c['meaning'] for c in r['cells'].values() if c)]).lower()
               for r in searched)
    family = client.get('/api/codes', params={'family': 'rpi-3'}, headers=headers(library)).json()
    assert [m['id'] for m in family['models']] == ['rpi-3b', 'rpi-3b-plus']
    gpio = next(r for r in family['rows'] if r['code'] == 'GPIO22')
    assert gpio['differs'] and gpio['cells']['rpi-3b-plus']['meaning'] == '22 | 39 | NAND (no Linux support at present)'
    for params in ({'q': 'x' * 81}, {'family': 'x' * 65}):
        assert client.get('/api/codes', params=params, headers=headers(library)).status_code == 400


def test_code_suggestions_follow_what_is_typed(sample):
    client, library = sample
    found = client.get('/api/codes/suggest', params={'q': 'p10', 'model': 'uno-r4-wifi'},
                       headers=headers(library)).json()['suggestions']
    assert 0 < len(found) <= 8 and all(s['code'].startswith('P10') for s in found)
    p102 = next(s for s in found if s['code'] == 'P102')
    assert set(p102['models']) == {'uno-r4-minima', 'uno-r4-wifi'} and 'P102' in p102['meaning']
    gpio = client.get('/api/codes/suggest', params={'q': 'gpio-2'}, headers=headers(library)).json()['suggestions']
    assert gpio and all(s['code'].startswith('GPIO2') for s in gpio)
    assert client.get('/api/codes/suggest', params={'q': ''}, headers=headers(library)).json() == {'suggestions': []}
    assert client.get('/api/codes/suggest', params={'q': 'x' * 41}, headers=headers(library)).status_code == 400
    assert client.get('/api/codes/suggest', params={'q': 'P1', 'model': 'x' * 65},
                      headers=headers(library)).status_code == 400


def test_the_guide_tells_a_model_from_its_look_alikes(sample):
    client, library = sample
    found = client.get('/api/models/uno-r4-wifi/guide', headers=headers(library)).json()
    assert found['model']['id'] == 'uno-r4-wifi' and found['family']['id'] == 'uno'
    documents = {d['id'] for d in found['documents']}
    assert {'uno-r4-wifi-manual', 'uno-r4-wifi-datasheet', 'arduino-help-center'} <= documents
    assert not documents & {'rpi-hardware', 'uno-r4-minima-manual'}
    alike = {la['model']['id']: la for la in found['lookalikes']}
    assert 'uno-r4-minima' in alike and not any(m.startswith('rpi-') for m in alike)
    p102 = next(c for c in alike['uno-r4-minima']['codes'] if c['code'] == 'P102')
    assert (p102['here'], p102['there']) == ('D13 | P102 | GTIOC2B', 'D5 | P102 | GTIOC2B')
    chunks = workspace_of(client, library).library.chunks()
    assert all(chunk_applies(chunks[p['chunkId']], 'uno-r4-wifi') for p in found['identification'])
    for fact in alike['uno-r4-minima']['facts']:
        assert chunk_applies(chunks[fact['here']['chunkId']], 'uno-r4-wifi')
        assert chunk_applies(chunks[fact['there']['chunkId']], 'uno-r4-minima')
    assert client.get('/api/models/not-a-model/guide', headers=headers(library)).status_code == 404


# ------------------------------------------------------------------ lab

def test_the_lab_compares_three_rankings_under_one_filter(sample):
    client, library = sample
    query = 'Which header pin is RA4M1 port P102?'
    body = client.post('/api/lab', json={'query': query, 'model': 'uno-r4-wifi', 'k': 5, 'constant': 60},
                       headers=headers(library)).json()
    assert (body['query'], body['k'], body['constant'], body['tieBreak']) == (query, 5, 60, 'best-rank')
    assert body['filter']['model'] == 'uno-r4-wifi' and body['filter']['excluded'] > 0
    labelled = next((q for q in QUERIES if q['query'] == query), None)
    assert body['queryId'] == (labelled and labelled['id']) and body['expected'] == (labelled or {}).get('expected', [])
    keyword, semantic, fused = body['keyword']['results'], body['semantic']['results'], body['fused']
    assert keyword and semantic and fused and body['semantic']['available']
    assert body['keyword']['terms'][:3] == ['which', 'header', 'pin']
    chunks = workspace_of(client, library).library.chunks()
    shown = [r['id'] for r in keyword + semantic]
    assert set(body['chunks']) == set(shown) and all(chunk_applies(chunks[c], 'uno-r4-wifi') for c in shown)
    # The fused list is the exact fusion of the two lists, with its ties flagged.
    expected = fuse([[r['id'] for r in keyword], [r['id'] for r in semantic]], 60)
    assert [(f['id'], f['ranks'], f['bestRank'], f['tied']) for f in fused] == [
        (f['id'], f['ranks'], f['bestRank'], f['tied']) for f in expected]
    assert [f['rank'] for f in fused] == list(range(1, len(fused) + 1))
    scores = [sum(Fraction(1, 60 + r) for r in f['ranks'] if r) for f in fused]
    assert all(f['tied'] == (scores.count(s) > 1) for f, s in zip(fused, scores)) and any(f['tied'] for f in fused)
    assert scores == sorted(scores, reverse=True)

    unfiltered = client.post('/api/lab', json={'query': query, 'constant': 1}, headers=headers(library)).json()
    assert unfiltered['filter']['model'] is None and unfiltered['filter']['excluded'] == 0
    top = unfiltered['fused'][0]
    assert unfiltered['constant'] == 1 and top['score'] >= 0.5
    assert top['score'] == round(float(sum(Fraction(1, 1 + r) for r in top['ranks'] if r)), 6)
    assert unfiltered['filter']['allowed'] == len(chunks)


@pytest.mark.parametrize('body', [
    {'query': ''}, {'query': 'x' * 4001}, {'query': 'P102', 'k': 0}, {'query': 'P102', 'k': 11},
    {'query': 'P102', 'constant': 0}, {'query': 'P102', 'constant': 1001}, {'query': 'P102', 'constant': 2.5},
    {'query': 'P102', 'model': 'unknown-board'}, {'query': 'P102', 'model': 'Bad Id'},
    {'query': 'P102', 'revision': 'v1-1'}, {'query': 'P102', 'model': 'rpi-3b', 'revision': 'v1-1'},
    {'query': 'P102', 'mode': 'keyword'},
])
def test_the_lab_rejects_invalid_requests(sample, body):
    client, library = sample
    response = client.post('/api/lab', json=body, headers=headers(library))
    assert response.status_code == 400 and response.json()['error'], body


def test_the_lab_needs_manuals(sample, ws):
    client, _ = sample
    response = client.post('/api/lab', json={'query': 'P102'}, headers=headers(ws))
    assert response.status_code == 409


# ------------------------------------------------------------------ evaluation

def test_evaluation_needs_the_sample_library(sample, ws):
    client, _ = sample
    info = client.get('/api/evaluation', headers=headers(ws)).json()
    assert info['queries'] == QUERIES and info['runs'] == [] and 'not a benchmark' in info['scope']
    events(upload(client, ws))
    response = client.post('/api/evaluation/run', json={}, headers=headers(ws))
    assert response.status_code == 409 and 'sample library' in response.json()['error']


def test_an_evaluation_run_is_saved_listed_fetched_and_deleted(sample):
    client, library = sample
    stream = events(client.post('/api/evaluation/run', json={'modes': ['keyword', 'hybrid'], 'k': 5},
                                headers=headers(library)))
    progress = [e for e in stream if e['type'] == 'progress']
    assert progress[0]['done'] == 0 and progress[-1]['done'] == progress[-1]['total'] == len(QUERIES)
    assert stream[-1]['type'] == 'done'
    run = stream[-1]['run']
    assert len(run['id']) == 12 and (run['k'], run['constant'], run['embedder']) == (5, 60, 'fake-embedder')
    assert set(run['totals']) == {'keyword', 'hybrid'} and 'not a benchmark' in run['scope']
    assert run['lookalike'] == {'queries': 4, 'found': {'keyword': 0, 'hybrid': 0}}
    rows = {r['id']: r for r in run['rows']}
    assert set(rows) == {q['id'] for q in QUERIES}
    chunks = workspace_of(client, library).library.chunks()
    for query in QUERIES:
        row = rows[query['id']]
        assert set(row['modes']) == {'keyword', 'hybrid'}
        assert all(m['wrongModel'] == 0 and len(m['ranked']) <= 5 for m in row['modes'].values())
        # Passages labelled by hand as a look-alike board's answer never reach a top k.
        assert row['forbidden'] == query.get('forbidden', []) and all(m['lookalike'] == 0 for m in row['modes'].values())
        if query['expectStatus'] == 'clarification':
            assert row['asked'] and row['candidatesOk'], row
        else:
            assert not row['asked'], row
        if row['lookup']:
            # The exact-code lookup reads the model's own code table.
            assert chunk_applies(chunks[row['lookup']['chunkId']], query['model'], query.get('revision')), row
            if 'P102' in query['query']:
                assert row['lookup']['hit'], row

    listed = client.get('/api/evaluation', headers=headers(library)).json()['runs']
    assert [r['id'] for r in listed] == [run['id']] and listed[0]['totals'] == run['totals']
    assert 'rows' not in listed[0]
    assert client.get(f"/api/evaluation/runs/{run['id']}", headers=headers(library)).json() == run
    assert client.delete(f"/api/evaluation/runs/{run['id']}", headers=headers(library)).json() == {'deleted': run['id']}
    assert client.get(f"/api/evaluation/runs/{run['id']}", headers=headers(library)).status_code == 404
    assert client.delete(f"/api/evaluation/runs/{run['id']}", headers=headers(library)).status_code == 404
    assert client.get('/api/evaluation/runs/not-a-run', headers=headers(library)).status_code == 404
    assert client.get('/api/evaluation', headers=headers(library)).json()['runs'] == []


@pytest.mark.parametrize('body', [{'modes': []}, {'modes': ['sql']}, {'modes': 'keyword'}, {'k': 0}, {'k': '5'},
                                  {'constant': 0}, {'constant': 1001}, {'limit': 3}])
def test_an_evaluation_run_rejects_invalid_options(sample, body):
    client, library = sample
    response = client.post('/api/evaluation/run', json=body, headers=headers(library))
    assert response.status_code == 400 and response.json()['error'], body

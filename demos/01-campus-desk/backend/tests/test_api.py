import json

import pytest

from backend import documents as documents_module
from backend.app import API_VERSION, API_VERSION_HEADER
from conftest import (CORPUS, HTTPError, docx_bytes, events, headers, load_corpus, make_client, model_with,  # noqa: F401
                      pdf_bytes, workspace_id)

ANSWER = [('reasoning', 'The passage on grading says 4.50. '), ('token', 'A First Class needs a CGPA of '),
          ('token', '4.50–5.00 [1].')]


def upload(client, ws, name='Staff Manual.pdf', data=None):
    data = data or pdf_bytes([(['Leave policy', '', 'Every staff member earns 21 days of annual leave.'], None, False)])
    return client.post('/api/documents', files={'file': (name, data, 'application/pdf')}, headers=headers(ws))


def chat(client, ws, message, **body):
    return client.post('/api/chat', json={'message': message, **body}, headers=headers(ws))


def test_health_reports_capabilities(tmp_path):
    model, _ = model_with('ok')
    with make_client(tmp_path, model=model) as client:
        response = client.get('/api/status')
        body = response.json()
    assert body['status'] == 'ok' and body['generation'] is True and body['model'] == 'deepseek-v4-flash'
    assert body['apiVersion'] == API_VERSION and response.headers[API_VERSION_HEADER] == str(API_VERSION)
    assert body['embeddings']['status'] == 'ready' and body['retrieval']['default'] == 'hybrid'
    assert body['ocr'] == {'engine': 'RapidOCR', 'enabled': True}
    with make_client(tmp_path, embedder=None) as client:
        body = client.get('/api/status').json()
    assert body['generation'] is False and body['retrieval']['default'] == 'keyword'


def test_public_api_prefix_can_rewrite_around_a_host_namespace(tmp_path):
    options = {'route_prefix': '/campus-api', 'public_prefix': '/api'}
    with make_client(tmp_path, embedder=None, app_options=options) as client:
        public = client.get('/api/status')
        internal = client.get('/campus-api/status')
    assert public.status_code == 200 and public.json()['apiVersion'] == API_VERSION
    assert public.headers[API_VERSION_HEADER] == str(API_VERSION)
    assert internal.status_code == 200
    assert client.get('/api/health').json()['apiVersion'] == API_VERSION


@pytest.mark.parametrize('value', [None, 'short', 'Z' * 32, '../' + 'a' * 29])
def test_workspace_id_is_required_and_validated(tmp_path, value):
    with make_client(tmp_path) as client:
        response = client.get('/api/documents', headers={'X-Workspace-Id': value} if value else {})
    assert response.status_code == 400 and 'workspace' in response.json()['error']


def test_upload_streams_every_stage_then_the_document_can_be_explored(tmp_path):
    ws = workspace_id()
    with make_client(tmp_path) as client:
        response = upload(client, ws)
        assert response.headers['content-type'].startswith('application/x-ndjson')
        stream = events(response)
        stages = [e['stage'] for e in stream if e['type'] == 'progress']
        assert stages[0] == 'reading' and {'text', 'chunking', 'embedding', 'indexing'} <= set(stages)
        document = stream[-1]['document']
        assert stream[-1]['type'] == 'done' and document['name'] == 'Staff Manual'
        assert document['id'].startswith('staff-manual-') and document['chunks'] == 1 and document['embeddings']

        listed = client.get('/api/documents', headers=headers(ws)).json()['documents']
        assert [d['id'] for d in listed] == [document['id']]
        detail = client.get(f"/api/documents/{document['id']}", headers=headers(ws)).json()
        assert detail['extraction']['pages'] == [{'page': 1, 'chars': detail['extraction']['characters'], 'method': 'text'}]
        assert detail['chunks'][0]['location'] == 'p. 1' and 'annual leave' in detail['chunks'][0]['text']
        assert detail['index']['vocabulary'] > 5
        embeddings = detail['embeddings']
        assert (embeddings['model'], embeddings['dimensions'], len(embeddings['sample'])) == ('fake-embedder', 64, 6)
        assert {'extractMs', 'chunkMs', 'embedMs', 'indexMs'} <= set(detail['timings'])

        assert client.delete(f"/api/documents/{document['id']}", headers=headers(ws)).json() == {'deleted': document['id']}
        assert client.get('/api/documents', headers=headers(ws)).json() == {'documents': []}
        assert client.delete(f"/api/documents/{document['id']}", headers=headers(ws)).status_code == 404


def test_workspaces_never_see_each_others_documents(tmp_path):
    mine, theirs = workspace_id(), workspace_id()
    with make_client(tmp_path) as client:
        document = events(upload(client, mine))[-1]['document']
        assert client.get('/api/documents', headers=headers(theirs)).json() == {'documents': []}
        assert client.get(f"/api/documents/{document['id']}", headers=headers(theirs)).status_code == 404
        assert chat(client, theirs, 'annual leave').status_code == 409


def test_same_file_twice_replaces_it_and_the_workspace_limit_holds(tmp_path):
    ws = workspace_id()
    same = pdf_bytes([(['Leave policy', '', 'Every staff member earns 21 days of annual leave.'], None, False)])
    with make_client(tmp_path, max_documents=2) as client:
        first = events(upload(client, ws, data=same))[-1]['document']
        again = events(upload(client, ws, data=same))[-1]['document']
        assert first['id'] == again['id']
        events(upload(client, ws, 'Other.pdf', pdf_bytes([(['Another file entirely.'] * 4, None, False)])))
        blocked = events(upload(client, ws, 'Third.pdf', pdf_bytes([(['A third file.'] * 4, None, False)])))
        assert blocked[-1]['type'] == 'error' and 'already holds 2 documents' in blocked[-1]['error']


def test_upload_rejects_bad_files(tmp_path, monkeypatch):
    ws = workspace_id()
    with make_client(tmp_path) as client:
        assert client.post('/api/documents', files={'file': ('a.exe', b'x', 'application/octet-stream')},
                           headers=headers(ws)).status_code == 400
        assert client.post('/api/documents', headers=headers(ws)).status_code == 400
        broken = events(upload(client, ws, 'broken.pdf', b'%PDF-1.7 junk'))
        assert broken[-1] == {'type': 'error', 'error': 'This PDF could not be opened. Try re-exporting it.'}
        monkeypatch.setitem(documents_module.LIMITS, 'file_bytes', 10)
        assert upload(client, ws, 'big.pdf', b'x' * 20).status_code == 413


def test_word_upload_with_a_picture_is_searchable(tmp_path, docx_bytes):
    ws = workspace_id()
    with make_client(tmp_path) as client:
        response = client.post('/api/documents', headers=headers(ws), files={
            'file': ('Manual.docx', docx_bytes(picture_lines=['Fire assembly point: front lawn']), 'application/octet-stream')})
        document = events(response)[-1]['document']
        assert document['imageRegions'] == 1
        trace = client.post('/api/retrieve', json={'query': 'fire assembly point', 'mode': 'keyword'},
                            headers=headers(ws)).json()
        top = trace['chunks'][trace['selected'][0]]
        assert 'front lawn' in top['text'] and top['ocr'] is True


def test_chat_streams_each_layer_then_a_cited_answer(tmp_path):
    ws = workspace_id()
    model, calls = model_with(ANSWER)
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        stream = events(chat(client, ws, 'What CGPA do I need for a First Class?'))
    kinds = [e['type'] for e in stream]
    assert kinds[:5] == ['stage', 'retrieval', 'stage', 'augmentation', 'stage']
    assert kinds[5:] == ['generation.attempt', 'reasoning', 'token', 'token', 'done']
    retrieval = stream[1]['trace']
    assert retrieval['mode'] == 'hybrid' and 'handbook:degree-classification:0' in retrieval['selected']
    augmentation = stream[3]['trace']
    assert augmentation['messages'][0]['role'] == 'system' and len(augmentation['passages']) == 4
    done = stream[-1]
    first = retrieval['selected'][0]
    assert done['status'] == 'answered' and done['answer'] == 'A First Class needs a CGPA of 4.50–5.00 [1].'
    assert done['citations'] == [{'n': 1, 'id': first}] and done['sources'][0]['n'] == 1
    generation = done['generation']
    assert generation['reasoning'].startswith('The passage on grading') and generation['usage']['prompt_tokens'] == 900
    assert generation['attempts'] == [{'model': 'deepseek-v4-flash', 'attempt': 1, 'ok': True}]
    assert generation['finishReason'] == 'stop' and 'firstTokenMs' in generation['timings']
    sent = calls.calls[0]
    assert sent['stream'] is True and sent['messages'][-1]['content'].startswith('Passages from the documents:')


def test_chat_retries_a_failed_attempt_and_reports_it(tmp_path):
    ws = workspace_id()
    model, _ = model_with([('reasoning', 'hm'), HTTPError(503)], ANSWER)
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        stream = events(chat(client, ws, 'What CGPA do I need for a First Class?'))
    kinds = [e['type'] for e in stream if e['type'].startswith(('generation', 'reasoning'))]
    assert kinds[:4] == ['generation.attempt', 'reasoning', 'generation.retry', 'generation.attempt']
    done = stream[-1]
    assert done['status'] == 'answered'
    assert [a['ok'] for a in done['generation']['attempts']] == [False, True]
    assert done['generation']['attempts'][0]['reason'] == 'HTTP 503'
    assert done['generation']['reasoning'] == 'The passage on grading says 4.50. '  # the failed attempt's is dropped


def test_chat_falls_back_to_passages_when_the_model_is_down(tmp_path):
    ws = workspace_id()
    model, _ = model_with(HTTPError(503))
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        done = events(chat(client, ws, 'How many weeks is SIWES II?'))[-1]
    assert done['status'] == 'unavailable' and done['answer'] is None and done['sources']
    assert done['generation']['error'] == 'Model unavailable: HTTP 503'
    assert len(done['generation']['attempts']) == 3


def test_chat_without_a_model_shows_sources_only(tmp_path):
    ws = workspace_id()
    with make_client(tmp_path) as client:
        load_corpus(client, ws)
        done = events(chat(client, ws, 'How many weeks is SIWES II?'))[-1]
    assert done['status'] == 'sources_only' and 'handbook:industrial-training:0' in [s['id'] for s in done['sources']]


def test_follow_ups_are_rewritten_before_retrieval(tmp_path):
    ws = workspace_id()
    model, calls = model_with('CGPA requirement for Second Class Upper degree', ANSWER)
    history = [{'role': 'user', 'content': 'What CGPA do I need for a First Class?'},
               {'role': 'assistant', 'content': 'A First Class needs 4.50 [1].'}]
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        stream = events(chat(client, ws, 'and for second class upper?', history=history))
    retrieval = next(e for e in stream if e['type'] == 'retrieval')['trace']
    assert retrieval['rewrite']['method'] == 'model' and retrieval['query'].startswith('CGPA requirement')
    assert retrieval['original'] == 'and for second class upper?'
    answer_messages = calls.calls[-1]['messages']
    assert [m['role'] for m in answer_messages] == ['system', 'user', 'assistant', 'user']
    assert answer_messages[2]['content'] == 'A First Class needs 4.50.'


def test_uncited_replies_are_marked(tmp_path):
    ws = workspace_id()
    model, _ = model_with([('token', 'Hello! Ask me anything about the handbook.')])
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        done = events(chat(client, ws, 'hello there, what can you do'))[-1]
    assert done['status'] == 'uncited' and done['citations'] == []


def test_invalid_citations_are_removed_and_reported(tmp_path):
    ws = workspace_id()
    model, _ = model_with([('token', 'SIWES II is 24 weeks [2][9].')])
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        done = events(chat(client, ws, 'How many weeks is SIWES II?'))[-1]
    assert done['answer'] == 'SIWES II is 24 weeks [2].'
    assert done['generation']['citations'] == {'valid': [2], 'invalid': [9]}


@pytest.mark.parametrize('body, status', [
    ({'message': ' '}, 400), ({'message': 'x' * 4001}, 400), ({'message': 'hi', 'mode': 'sql'}, 400),
    ({'message': 'hi', 'history': 'nope'}, 400), ({'message': 'hi', 'tenant': 'x'}, 400),
    ({'message': 'hi', 'documentIds': 'all'}, 400),
])
def test_chat_rejects_malformed_requests(tmp_path, body, status):
    ws = workspace_id()
    with make_client(tmp_path) as client:
        load_corpus(client, ws)
        assert client.post('/api/chat', json=body, headers=headers(ws)).status_code == status
        assert client.post('/api/chat', content=b'{}', headers=headers(ws)).status_code == 415
        assert client.post('/api/chat', content=b'x' * 300_000, headers={
            **headers(ws), 'Content-Type': 'application/json'}).status_code == 413


def test_overview_is_written_once_then_cached(tmp_path):
    ws = workspace_id()
    reply = json.dumps({'summary': 'The FUT Minna Mechatronics handbook.', 'topics': ['Grading'],
                        'questions': ['What CGPA is a First Class?']})
    model, calls = model_with(reply)
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        first = client.post('/api/documents/handbook/overview', headers=headers(ws)).json()
        second = client.post('/api/documents/handbook/overview', headers=headers(ws)).json()
        listed = client.get('/api/documents', headers=headers(ws)).json()['documents'][0]
    assert first == second and first['summary'].startswith('The FUT Minna') and len(calls.calls) == 1
    assert listed['overview'] == first
    with make_client(tmp_path) as client:
        load_corpus(client, workspace_id())
        other = workspace_id()
        load_corpus(client, other)
        assert client.post('/api/documents/handbook/overview', headers=headers(other)).status_code == 503


def test_retrieve_endpoint_validates_input(tmp_path):
    ws = workspace_id()
    with make_client(tmp_path) as client:
        load_corpus(client, ws)
        ok = client.post('/api/retrieve', json={'query': 'library', 'k': 2}, headers=headers(ws)).json()
        assert len(ok['selected']) == 2 and ok['mode'] == 'hybrid'
        for body in [{'query': ''}, {'query': 'x', 'k': 0}, {'query': 'x', 'mode': 'dense'}]:
            assert client.post('/api/retrieve', json=body, headers=headers(ws)).status_code == 400


def test_not_found_replies_are_recognised(tmp_path):
    ws = workspace_id()
    model, _ = model_with([('token', "I couldn't find this in the documents I have. Please check with the school office, "
                                     "or try asking in a different way. You could ask about course fees [1].")])
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        done = events(chat(client, ws, 'What are the hostel accommodation fees?'))[-1]
    assert done['status'] == 'not_found'


def test_whole_document_questions_include_its_opening(tmp_path):
    ws = workspace_id()
    model, _ = model_with([('token', 'It is the Mechatronics handbook [1].')])
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        retrieval = next(e for e in events(chat(client, ws, 'What is this document about?'))
                         if e['type'] == 'retrieval')['trace']
    opening = [f"handbook:{s['id']}:0" for s in CORPUS[0]['sections'][:3]]
    assert retrieval['selected'][:3] == opening and retrieval['strategy'] == 'document opening + search'


def test_settings_change_the_prompt_and_the_not_found_check(tmp_path):
    ws = workspace_id()
    model, calls = model_with([('token', 'Sorry, that is not covered here. Try the bursary [1].')])
    with make_client(tmp_path, model=model) as client:
        load_corpus(client, ws)
        initial = client.get('/api/settings', headers=headers(ws)).json()
        assert initial['settings']['assistantName'] == 'Campus Guide' and initial['settings'] == initial['defaults']
        assert 'Grounding rules' in initial['prompt'] and '“Mechatronics' in initial['prompt']
        updated = client.put('/api/settings', headers=headers(ws), json={
            'assistantName': 'Minna Guide', 'instructions': '- One sentence only.',
            'notFound': 'Sorry, that is not covered here.'}).json()
        assert updated['settings']['assistantName'] == 'Minna Guide'
        assert updated['prompt'].startswith('You are Minna Guide') and '- One sentence only.' in updated['prompt']
        assert 'Use only the numbered passages' in updated['prompt'], 'grounding rules cannot be removed'
        done = events(chat(client, ws, 'What are the hostel accommodation fees?'))[-1]
        assert done['status'] == 'not_found'
        assert calls.calls[-1]['messages'][0]['content'].startswith('You are Minna Guide')
        # Blank fields go back to the defaults.
        reset = client.put('/api/settings', headers=headers(ws), json={'assistantName': '', 'notFound': None}).json()
        assert reset['settings']['assistantName'] == 'Campus Guide' and reset['settings']['instructions'] == '- One sentence only.'
        for body in [{'bogus': 'x'}, {'notFound': 'two\nlines'}, {'instructions': 'x' * 5000}, {'assistantName': 7}]:
            assert client.put('/api/settings', headers=headers(ws), json=body).status_code == 400


def test_profile_is_written_from_the_documents_and_refreshes_when_they_change(tmp_path):
    ws = workspace_id()
    reply = json.dumps({'institution': 'Federal University of Technology, Minna', 'unit': 'Mechatronics Engineering',
                        'tagline': 'Your handbook, answered.', 'welcome': 'It covers the programme. It is for students.',
                        'topics': ['Grading', 'SIWES'], 'quickActions': [
                            {'label': 'Check First Class CGPA', 'question': 'What CGPA is a First Class?'},
                            {'question': 'How long is SIWES II?'}]})
    model, calls = model_with(reply)
    with make_client(tmp_path, model=model) as client:
        assert client.get('/api/profile', headers=headers(ws)).json() == {'profile': None, 'documents': 0, 'generation': True}
        assert client.post('/api/profile', headers=headers(ws)).status_code == 409
        load_corpus(client, ws)
        made = client.post('/api/profile', headers=headers(ws)).json()['profile']
        assert made['institution'].startswith('Federal University') and len(made['quickActions']) == 2
        assert made['quickActions'][1]['label'] == 'How long is SIWES II?'
        assert 'Excerpts are document text' in calls.calls[0]['messages'][0]['content']
        assert client.get('/api/profile', headers=headers(ws)).json()['profile'] == made
        assert client.post('/api/profile', headers=headers(ws)).json()['profile'] == made and len(calls.calls) == 1
        # Adding a document makes the profile stale until it is written again.
        events(upload(client, ws, 'Extra.pdf', pdf_bytes([(['Extra rules for the workshop.'] * 4, None, False)])))
        assert client.get('/api/profile', headers=headers(ws)).json()['profile'] is None
        assert client.post('/api/profile', headers=headers(ws)).status_code == 200 and len(calls.calls) == 2
    with make_client(tmp_path) as client:
        other = workspace_id()
        load_corpus(client, other)
        assert client.post('/api/profile', headers=headers(other)).status_code == 503

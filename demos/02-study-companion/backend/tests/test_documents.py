import numpy as np
import pytest

from rag_core.core import chunk_document

from backend.store import chunk_record, source_document
from conftest import CORPUS, NOTES, events, headers, load_sample, make_client, pdf_bytes, upload, workspace_id, workspace_of


def test_upload_streams_every_stage_and_chunks_the_notes_both_ways(tmp_path, ws):
    with make_client(tmp_path) as client:
        response = upload(client, ws)
        assert response.headers['content-type'].startswith('application/x-ndjson')
        stream = events(response)
        stages = [e['stage'] for e in stream if e['type'] == 'progress']
        assert stages[0] == 'reading' and {'text', 'sectioning', 'embedding', 'indexing'} <= set(stages)
        document = stream[-1]['document']
        assert stream[-1]['type'] == 'done' and document['name'] == 'Biology notes'
        assert document['id'].startswith('biology-notes-') and document['sections'] == 4
        assert document['embeddings'] and not document['sample'] and document['words'] > 100

        detail = client.get(f"/api/documents/{document['id']}", headers=headers(ws)).json()
        assert [s['title'] for s in detail['sections']] == [
            'Photosynthesis', 'Light-dependent reactions', 'Calvin cycle', 'Limiting factors']
        assert detail['sections'][2]['location'].startswith('¶') and 'stroma' in detail['sections'][2]['text']
        chunking = detail['chunking']
        assert chunking['section']['count'] == 4
        assert (chunking['fixed']['chunkWords'], chunking['fixed']['minTailWords']) == (50, 12)
        assert chunking['fixed']['count'] >= 4 and chunking['fixed']['maxWords'] <= 50
        assert (detail['embeddings']['model'], detail['embeddings']['dimensions']) == ('fake-embedder', 64)
        assert {'extractMs', 'sectionMs', 'embedMs', 'indexMs'} <= set(detail['timings'])
        assert detail['index']['vocabulary'] > 20

        workspace = workspace_of(client, ws)
        for chunking_name, view in workspace.views.items():
            ids, matrix = view.vectors()
            assert ids == sorted(view.chunks()) and matrix.shape == (len(ids), 64)
            assert len(view.index.chunks()) == len(ids) == detail['chunking'][chunking_name]['count']

        assert client.delete(f"/api/documents/{document['id']}", headers=headers(ws)).json() == {'deleted': document['id']}
        assert client.get('/api/documents', headers=headers(ws)).json() == {'documents': []}
        assert all(view.vectors() is None and view.chunks() == {} for view in workspace.views.values())
        assert client.delete(f"/api/documents/{document['id']}", headers=headers(ws)).status_code == 404


def test_pdf_notes_cite_their_pages(tmp_path, ws):
    data = pdf_bytes([(['NEGATIVE FEEDBACK', '', 'Negative feedback subtracts the measured output from the reference.'], None, False),
                      (['STABILITY', '', 'A stable system gives a bounded output for every bounded input.'], None, False)])
    with make_client(tmp_path) as client:
        document = events(upload(client, ws, 'Controls.pdf', data, 'application/pdf'))[-1]['document']
        detail = client.get(f"/api/documents/{document['id']}", headers=headers(ws)).json()
    assert document['pages'] == 2
    assert [(s['title'], s['location'], s['pages']) for s in detail['sections']] == [
        ('NEGATIVE FEEDBACK', 'p. 1', [1, 1]), ('STABILITY', 'p. 2', [2, 2])]


def test_workspaces_never_see_each_others_notes(tmp_path):
    mine, theirs = workspace_id(), workspace_id()
    with make_client(tmp_path) as client:
        document = events(upload(client, mine))[-1]['document']
        assert client.get('/api/documents', headers=headers(theirs)).json() == {'documents': []}
        assert client.get(f"/api/documents/{document['id']}", headers=headers(theirs)).status_code == 404
        assert client.post('/api/ask', json={'message': 'Calvin cycle'}, headers=headers(theirs)).status_code == 409
        assert client.post('/api/compare', json={'query': 'Calvin cycle'}, headers=headers(theirs)).status_code == 409


def test_same_file_twice_replaces_it_and_the_workspace_limit_holds(tmp_path, ws):
    with make_client(tmp_path, max_documents=2) as client:
        first = events(upload(client, ws))[-1]['document']
        again = events(upload(client, ws))[-1]['document']
        assert first['id'] == again['id']
        events(upload(client, ws, 'Other.txt', b'Another set of notes entirely, about something else.', 'text/plain'))
        blocked = events(upload(client, ws, 'Third.txt', b'A third set of notes on a third subject.', 'text/plain'))
        assert blocked[-1]['type'] == 'error' and 'already holds 2 sets of notes' in blocked[-1]['error']
        assert client.post('/api/sample', headers=headers(ws)).status_code == 409


def test_upload_rejects_bad_files(tmp_path, ws):
    with make_client(tmp_path) as client:
        assert client.post('/api/documents', files={'file': ('a.exe', b'x', 'application/octet-stream')},
                           headers=headers(ws)).status_code == 400
        assert client.post('/api/documents', headers=headers(ws)).status_code == 400
        broken = events(upload(client, ws, 'broken.pdf', b'%PDF-1.7 junk', 'application/pdf'))
        assert broken[-1] == {'type': 'error', 'error': 'This PDF could not be opened. Try re-exporting it.'}
        empty = events(upload(client, ws, 'empty.txt', b'   \n\n  ', 'text/plain'))
        assert empty[-1]['type'] == 'error'


def test_sample_notes_keep_their_section_ids_and_come_with_questions(tmp_path, ws):
    with make_client(tmp_path) as client:
        before = client.get('/api/sample', headers=headers(ws)).json()
        assert before['loaded'] is False and len(before['questions']) == 8
        assert before['documents'] == [{'id': 'controls', 'title': CORPUS[0]['title'], 'sections': 8}]
        added = client.post('/api/sample', headers=headers(ws)).json()['documents']
        assert [(d['id'], d['format'], d['sample'], d['sections']) for d in added] == [('controls', 'sample', True, 8)]
        assert client.get('/api/sample', headers=headers(ws)).json()['loaded'] is True
        detail = client.get('/api/documents/controls', headers=headers(ws)).json()
        assert [s['id'] for s in detail['sections']] == [s['id'] for s in CORPUS[0]['sections']]
        assert detail['sections'][0]['location'] == 'Notes §1 Negative feedback' and detail['version'] == '2'
        # Loading it again replaces it rather than adding a copy.
        client.post('/api/sample', headers=headers(ws))
        assert len(client.get('/api/documents', headers=headers(ws)).json()['documents']) == 1


def test_changing_the_chunk_size_rebuilds_only_the_fixed_chunking(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        workspace = workspace_of(client, ws)
        section_before = workspace.views['section'].vectors()
        fixed_before = len(workspace.views['fixed'].chunks())
        reply = client.put('/api/settings', json={'chunkWords': 25}, headers=headers(ws)).json()
        assert reply['settings']['chunkWords'] == 25 and reply['rechunked'] > fixed_before
        fixed = workspace.views['fixed']
        ids, matrix = fixed.vectors()
        assert len(ids) == reply['rechunked'] == len(fixed.index.chunks()) == matrix.shape[0]
        sizes = [c['words'] for c in fixed.chunks().values()]
        # A last window under a quarter of the size (6 words) joins the one before it.
        assert max(sizes) == 28 and min(sizes) == 10
        assert sum(sizes) == sum(c['words'] for c in workspace.views['section'].chunks().values())
        assert [c.id for c in chunk_record(workspace.record('controls'), 'fixed', 25)] == ids
        section_after = workspace.views['section'].vectors()
        assert section_after[0] == section_before[0] and np.array_equal(section_after[1], section_before[1])
        # A setting that does not change the chunk size re-indexes nothing.
        assert 'rechunked' not in client.put('/api/settings', json={'k': 3}, headers=headers(ws)).json()


def test_notes_survive_a_restart(tmp_path, ws):
    with make_client(tmp_path) as client:
        document = events(upload(client, ws))[-1]['document']
    with make_client(tmp_path) as client:
        listed = client.get('/api/documents', headers=headers(ws)).json()['documents']
        assert [d['id'] for d in listed] == [document['id']]
        reply = client.post('/api/compare', json={'query': 'Calvin cycle', 'mode': 'keyword'}, headers=headers(ws)).json()
        assert reply['runs']['section']['context'][0]['title'] == 'Calvin cycle'


@pytest.mark.parametrize('name', ['notes.txt', 'notes.md'])
def test_plain_text_and_markdown_are_accepted(tmp_path, ws, name):
    with make_client(tmp_path) as client:
        document = events(upload(client, ws, name, NOTES.encode(), 'text/plain'))[-1]['document']
    assert document['format'] == 'text' and document['sections'] == 4


def consistent(workspace):
    """Every view's index, chunk list and vectors describe the same chunks."""
    for view in workspace.views.values():
        ids, matrix = view.vectors()
        assert sorted(c.id for c in view.index.chunks()) == sorted(view.chunks()) == sorted(ids)
        assert matrix.shape[0] == len(ids)
    return True


def test_notes_chunked_under_older_rules_are_rechunked_when_next_opened(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        workspace = workspace_of(client, ws)
        assert not workspace.needs_rechunk and consistent(workspace)
        # As an earlier version left it: one-word tails were chunks of their own.
        old = chunk_document(source_document(workspace.record('controls')), 'fixed', 50)
        assert [c.id for c in old][:3] == ['controls:feedback:0', 'controls:feedback:1', 'controls:feedback:2']
        workspace.views['fixed'].index.replace(workspace.documents(), 'fixed', 50)
        np.save(workspace.vector_path('controls', 'fixed'), np.zeros((len(old), 64), dtype=np.float32))
        (workspace.dir / 'chunking.json').write_text('{"rules": 1, "chunkWords": 50}')
        workspace.views['fixed'].invalidate()
        assert workspace.needs_rechunk

        reply = client.post('/api/compare', json={'query': 'thermostat heater', 'mode': 'hybrid'}, headers=headers(ws))
        assert reply.status_code == 200 and reply.json()['runs']['fixed']['totalChunks'] == 11
        assert not workspace.needs_rechunk and consistent(workspace)
        assert 'controls:feedback:2' not in workspace.views['fixed'].chunks()


def test_a_rechunk_that_was_cut_short_is_finished_when_next_opened(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        workspace = workspace_of(client, ws)
        workspace.save_settings({'chunkWords': 30})  # saved, but the server stopped before re-chunking
        assert workspace.needs_rechunk
        detail = client.get('/api/documents/controls', headers=headers(ws)).json()
        assert detail['chunking']['fixed']['chunkWords'] == 30 and detail['chunking']['fixed']['maxWords'] <= 36
        assert not workspace.needs_rechunk and consistent(workspace)
        assert len(workspace.views['fixed'].chunks()) == detail['chunking']['fixed']['count']


def test_adding_notes_does_not_hide_that_older_notes_need_rechunking(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        workspace = workspace_of(client, ws)
        (workspace.dir / 'chunking.json').write_text('{"rules": 1, "chunkWords": 50}')
        other = [{'id': 'biology', 'title': 'Biology', 'sections': [
            {'id': 'cells', 'title': 'Cells', 'text': 'Cells are the unit of life.'}]}]
        load_sample(client, ws, other)  # written directly, without opening the workspace through a route
        assert workspace.needs_rechunk
        assert client.get('/api/documents', headers=headers(ws)).status_code == 200
        assert not workspace.needs_rechunk and consistent(workspace)


def test_an_empty_workspace_never_needs_rechunking(tmp_path, ws):
    with make_client(tmp_path) as client:
        assert client.get('/api/documents', headers=headers(ws)).json() == {'documents': []}
        workspace = workspace_of(client, ws)
        assert not workspace.needs_rechunk
        load_sample(client, ws)
        assert not workspace.needs_rechunk and (workspace.dir / 'chunking.json').exists()

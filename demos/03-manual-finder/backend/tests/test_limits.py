"""What one request or one file can cost the server: parsing time, extracted
text, upload bodies, the workspaces a stream of new IDs leaves behind, the
prompt's size, and what the embedding cache reveals between workspaces."""
import io
import time

import pytest

from rag_core.web import extraction
from rag_core.web.documents import LIMITS
from rag_core.web.testing import pdf_bytes

from backend import store as store_module
from backend.identifiers import find, row_codes
from backend.sectioning import MAX_UNIT_CHARS, build_sections, is_rule
from conftest import ask, done, events, headers, make_client, upload, workspace_id

ADVERSARIAL = {
    'a long digit run before a plus': '1' * 64000 + '+',
    'letters and digits before a plus': 'a1' * 32000 + '+',
    'spaces after "1 long"': '1 long' + ' ' * 64000 + 'x',
    'spaces after "gpio"': 'gpio' + ' ' * 64000 + 'x',
    'thousands of codes': 'Ab1 ' * 16000,
}


@pytest.mark.parametrize('text', ADVERSARIAL.values(), ids=ADVERSARIAL.keys())
def test_reading_codes_takes_time_in_proportion_to_the_text(text):
    # These took minutes when a pattern retried every split of a long run.
    started = time.perf_counter()
    find(text)
    row_codes(f'| {text} |', '| Code | Meaning |')
    assert time.perf_counter() - started < 2


def test_a_table_rule_is_read_cell_by_cell():
    started = time.perf_counter()
    assert not is_rule('|' + ' ' * 64000 + 'x')
    assert time.perf_counter() - started < 1
    assert is_rule('| --- | :---: |') and is_rule('---|---') and not is_rule('| -- | --- |')


def test_a_passage_is_cut_at_its_character_limit():
    blocks = [extraction.Block('Long values', heading=True), extraction.Block('x' * 9000, para=1)]
    sections, _ = build_sections(blocks, 'Synthetic manual')
    units = [u for s in sections for u in s.units]
    assert len(units) == 5 and all(len(u.text) <= MAX_UNIT_CHARS for u in units)


def test_text_beyond_the_document_limit_is_not_read(monkeypatch):
    monkeypatch.setitem(LIMITS, 'characters_per_document', 1000)
    events_ = list(extraction.extract(('word ' * 1000).encode(), 'notes.txt', None))
    result = events_[-1]['result']
    assert result.truncated and sum(len(b.text) for b in result.blocks) <= 1000


def test_a_pdf_is_read_up_to_its_page_limit(monkeypatch):
    monkeypatch.setattr(extraction, 'MAX_PDF_PAGES', 2)
    lines = ['This synthetic page says something about the board,', 'enough to count as a text layer.']
    data = pdf_bytes([([f'Page {n}.', *lines], None, False) for n in range(1, 5)])
    result = list(extraction.extract(data, 'manual.pdf', None))[-1]['result']
    assert result.truncated and result.page_count == 4
    assert {b.page for b in result.blocks} == {1, 2} and len(result.pages) == 2


def test_a_word_file_that_unpacks_too_large_is_refused_before_it_is_opened(monkeypatch):
    import docx

    document = docx.Document()
    document.add_paragraph('A synthetic paragraph about a board.')
    buffer = io.BytesIO()
    document.save(buffer)
    monkeypatch.setattr(extraction, 'DOCX_MAX_XML', 100)
    with pytest.raises(extraction.ExtractionError, match='unpacks to more'):
        list(extraction.extract(buffer.getvalue(), 'manual.docx', None))


def test_an_upload_is_measured_before_its_body_is_read(tmp_path, ws, monkeypatch):
    with make_client(tmp_path) as client:
        def chunks():
            yield b'no size given'

        assert client.post('/api/documents', content=chunks(), headers=headers(ws)).status_code == 411
        monkeypatch.setitem(LIMITS, 'file_bytes', 100)
        monkeypatch.setattr('backend.app.FORM_OVERHEAD', 0)
        response = upload(client, ws, data=b'x' * 1000)
        assert response.status_code == 413 and '40 MB' in response.json()['error']
        monkeypatch.undo()
        two = client.post('/api/documents', headers=headers(ws), files=[
            ('file', ('a.md', b'# A\n\nOne.', 'text/markdown')), ('file', ('b.md', b'# B\n\nTwo.', 'text/markdown'))])
        assert two.status_code == 400


def test_reading_with_a_new_workspace_id_leaves_nothing_behind(tmp_path):
    with make_client(tmp_path) as client:
        root = tmp_path / 'workspaces'
        for path in ('/api/library', '/api/settings', '/api/codes', '/api/evaluation'):
            ws = workspace_id()
            assert client.get(path, headers=headers(ws)).status_code == 200, path
            assert not (root / ws).exists()
        ws = workspace_id()
        assert ask(client, ws, 'What does E17 mean?').status_code == 409  # no manuals yet
        assert not (root / ws).exists()
        assert client.put('/api/settings', json={'k': 4}, headers=headers(ws)).status_code == 200
        assert (root / ws).is_dir()  # a write creates it


def test_idle_workspaces_are_closed_beyond_the_limit_and_reopen(tmp_path, monkeypatch):
    monkeypatch.setattr(store_module, 'MAX_OPEN', 2)
    monkeypatch.setattr(store_module, 'IDLE_CLOSE_SECONDS', 0)
    with make_client(tmp_path) as client:
        ids = [workspace_id() for _ in range(4)]
        for ws in ids:
            assert client.put('/api/settings', json={'k': 7}, headers=headers(ws)).status_code == 200
        assert len(client.app.state.services.store._open) <= 2
        # A closed workspace opens again from disk with what it held.
        assert client.get('/api/settings', headers=headers(ids[0])).json()['settings']['k'] == 7


def test_the_context_is_bounded_in_characters_as_well_as_words(tmp_path, ws):
    notes = ('# Long value notes\n\nThese synthetic notes exist only for these tests.\n\n## Serial\n\n'
             'The serial number is ' + 'A1' * 4000 + ' on the label.\n')
    with make_client(tmp_path) as client:
        assert events(upload(client, ws, name='Long value notes.md', data=notes.encode()))[-1]['type'] == 'done'
        result, stream = done(ask(client, ws, 'Where is the serial number?', mode='keyword', budgetWords=100))
        items = next(e for e in stream if e['type'] == 'context')['trace']['items']
        assert items and sum(len(item['text']) for item in items) <= 100 * 12 + 2


def test_an_upload_is_never_embedded_from_another_workspaces_cache(tmp_path):
    with make_client(tmp_path) as client:
        cache = tmp_path / 'cache'
        before = set(cache.glob('*')) if cache.exists() else set()
        first, second = workspace_id(), workspace_id()
        progress = []
        for ws in (first, second):
            stream = events(upload(client, ws))
            assert stream[-1]['type'] == 'done'
            progress.append([e for e in stream if e.get('stage') == 'embedding'])
        assert (set(cache.glob('*')) if cache.exists() else set()) == before
        assert len(progress[0]) == len(progress[1])  # the second upload was embedded afresh

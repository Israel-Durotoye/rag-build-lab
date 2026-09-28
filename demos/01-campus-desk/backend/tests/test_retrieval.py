import pytest

from backend.ingest import ingest_sections
from backend.retrieval import retrieve
from backend.store import DocumentStore
from conftest import FakeEmbedder, workspace_id

RULES = [{'id': 'rules', 'title': 'Exam Rules', 'sections': [
    {'id': 'devices', 'title': 'Devices', 'location': 'p. 66',
     'text': 'Candidates found with a GSM handset in the hall are expelled.'},
    {'id': 'resits', 'title': 'Resits', 'location': 'p. 63',
     'text': 'Students who failed a course must register it again as a carry-over.'},
    {'id': 'library', 'title': 'Library', 'location': 'p. 75',
     'text': 'The library opens at eight and closes at ten in the evening.'},
]}]
HOURS = [{'id': 'hours', 'title': 'Staff Hours', 'sections': [
    {'id': 'staff', 'title': 'Hours', 'location': 'p. 1', 'text': 'Staff resume at 7:45 and the library closes at six.'}]}]


@pytest.fixture
def workspace(tmp_path):
    store = DocumentStore(tmp_path)
    ws = store.workspace(workspace_id())
    ingest_sections(ws, RULES + HOURS, FakeEmbedder())
    yield ws
    store.close()


def test_keyword_retrieval_is_stemmed_and_explains_matches(workspace):
    trace = retrieve(workspace, 'What if I fail a course?', mode='keyword', k=2)
    top = trace['keyword']['results'][0]
    assert top['id'] == 'rules:resits:0' and top['rank'] == 1 and top['score'] > 0
    assert set(top['terms']) >= {'fail', 'course'}  # "fail" matched "failed"
    assert trace['selected'][0] == 'rules:resits:0' and trace['mode'] == 'keyword'
    assert trace['semantic']['results'] == []


def test_semantic_retrieval_matches_meaning_not_words(workspace):
    keyword = retrieve(workspace, 'can I bring my phone?', mode='keyword', k=3)
    assert keyword['selected'] == []  # no shared words with "GSM handset"
    semantic = retrieve(workspace, 'can I bring my phone?', mode='semantic', k=3, embedder=FakeEmbedder())
    assert semantic['selected'][0] == 'rules:devices:0'
    assert semantic['semantic']['available'] and semantic['semantic']['results'][0]['similarity'] > 0


def test_hybrid_fuses_both_rankings_with_rrf(workspace):
    trace = retrieve(workspace, 'phone in the exam hall', mode='hybrid', k=2, embedder=FakeEmbedder())
    fused = {r['id']: r for r in trace['fused']['results']}
    top = fused['rules:devices:0']
    assert top['rank'] == 1 and top['keywordRank'] == 1 and top['semanticRank'] == 1
    assert top['score'] == pytest.approx(2 / 61, abs=1e-5)
    assert trace['selected'][0] == 'rules:devices:0' and len(trace['selected']) <= 2
    chunk = trace['chunks']['rules:devices:0']
    assert chunk['docName'] == 'Exam Rules' and chunk['location'] == 'p. 66' and 'GSM handset' in chunk['text']


def test_hybrid_without_embeddings_falls_back_to_keyword_and_says_why(workspace):
    trace = retrieve(workspace, 'library hours', mode='hybrid', k=3, embedder=None)
    assert trace['mode'] == 'keyword' and trace['requestedMode'] == 'hybrid'
    assert 'off' in trace['semantic']['reason']


def test_retrieval_can_be_limited_to_chosen_documents(workspace):
    trace = retrieve(workspace, 'library closes', mode='hybrid', k=5, embedder=FakeEmbedder(), document_ids=['hours'])
    assert trace['selected'] and all(cid.startswith('hours:') for cid in trace['selected'])
    assert trace['totalChunks'] == 1


def test_unknown_mode_is_rejected(workspace):
    with pytest.raises(ValueError):
        retrieve(workspace, 'x', mode='sql')

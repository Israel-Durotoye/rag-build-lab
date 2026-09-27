"""Campus Desk contracts. Model doubles below are only for validation tests."""
from hashlib import sha256
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path

import pytest

from rag_core.core import Index
from rag_core.pipeline import Pipeline, load_config


DEMO = Path(__file__).resolve().parents[1] / 'demos' / '01-campus-desk'
CASES = json.loads((DEMO / 'evaluation.json').read_text())


@pytest.fixture
def campus():
    pipe = Pipeline(load_config(DEMO / 'config.json'))
    yield pipe
    pipe.index.close()


def test_ingest_preserves_section_provenance_and_revision(tmp_path):
    pipe = Pipeline(load_config(DEMO / 'config.json'), db=tmp_path / 'campus.sqlite')
    original = pipe.index.version
    try:
        chunks = pipe.index.chunks()
        assert len(chunks) == 6
        sections = {s['id']: s for s in pipe.documents[0]['sections']}
        for chunk in chunks:
            section = sections[chunk.metadata['section']]
            assert chunk.doc_id == 'handbook'
            assert chunk.title == section['title']
            assert chunk.location == section['location']
            assert chunk.metadata['version'] == '1'
            assert chunk.metadata['content_hash'] == sha256(chunk.text.encode()).hexdigest()
        pipe.ingest()
        assert pipe.index.version == original
        assert len(pipe.index.chunks()) == 6
    finally:
        pipe.index.close()
    reopened = Index(tmp_path / 'campus.sqlite')
    try:
        assert reopened.version == original
        assert reopened.source('handbook:library:0').title == 'Library hours'
    finally:
        reopened.close()


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['question'])
def test_fixed_evaluation_questions(campus, case):
    result = campus.ask(case['question'])
    assert result['answer'] is None
    assert result['mode'] == 'source_search'
    assert result['corpus_version'] == campus.index.version
    if 'expected_source' in case:
        assert result['status'] == 'sources_found'
        assert case['expected_source'] in {s['id'] for s in result['sources']}
    else:
        assert result['status'] == 'insufficient_evidence'
        assert not result['sources']


def test_search_and_answer_are_separate_and_labels_resolve(campus):
    sources = campus.retrieve('library hours', k=1)
    result = campus.respond('When does it close?', sources)
    source_id = sources[0].id
    assert result['citation_labels'][source_id] == 'handbook · Library hours · library · v1'
    assert campus.preview(source_id)['text'] == result['sources'][0]['text']
    with pytest.raises(PermissionError):
        campus.preview('handbook:invented:0')


@pytest.mark.parametrize('citations,insufficient', [
    (['unknown'], False),
    (['handbook:housing:0'], False),  # Exists in storage, but not in selected context.
    (['handbook:library:0', 'unknown'], False),
    ([], False),
    ([123], False),
    (['unknown'], True),
])
def test_rejects_invalid_model_citations(campus, citations, insufficient):
    class ModelDouble:
        def generate(self, question, sources):
            return {'answer': 'Unsupported claim', 'citations': citations, 'insufficient': insufficient}

    campus.generator = ModelDouble()
    result = campus.respond('library hours', campus.retrieve('library hours', k=1))
    assert result['status'] == 'generation_unavailable'
    assert result['answer'] is None
    assert result['citations'] == []
    assert result['sources']


def test_missing_evidence_never_calls_generator(campus):
    class MustNotCall:
        def generate(self, question, sources):
            pytest.fail('Generation must not run without retrieved evidence')

    campus.generator = MustNotCall()
    assert campus.ask('How much is tuition?')['status'] == 'insufficient_evidence'


def test_model_abstention_discards_unsupported_answer(campus):
    class ModelDouble:
        def generate(self, question, sources):
            return {'answer': 'Unsupported fee amount', 'citations': [], 'insufficient': True}

    campus.generator = ModelDouble()
    result = campus.ask('What are the library late fees?')
    assert result['sources']  # Keyword overlap alone is not answer support.
    assert result['status'] == 'insufficient_evidence'
    assert result['answer'] is None


def test_keyword_overlap_is_not_presented_as_an_answer(campus):
    result = campus.ask('What are the library late fees?')
    assert result['status'] == 'sources_found'
    assert result['answer'] is None
    assert result['citations'] == []


def test_session_index_survives_thread_changes_and_concurrent_reindex(campus):
    """Real Streamlit reruns use different threads, unlike the AppTest harness."""
    def search_and_preview():
        result = campus.ask('When does the library close?')
        assert 'handbook:library:0' in {s['id'] for s in result['sources']}
        assert '20:00' in campus.preview('handbook:library:0')['text']

    with ThreadPoolExecutor(max_workers=3) as workers:
        jobs = []
        for _ in range(10):
            jobs.append(workers.submit(search_and_preview))
            jobs.append(workers.submit(campus.ingest))
        for job in jobs:
            job.result(timeout=10)
    assert len(campus.index.chunks()) == 6

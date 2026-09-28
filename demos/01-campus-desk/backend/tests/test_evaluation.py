"""The seven fixed retrieval checks over the fixture handbook, through the
API's keyword retriever (the mode the Python baseline also evaluates).
These are development checks, not an answer-quality benchmark."""
import pytest

from rag_core.core import tokens

from conftest import CORPUS, EVALUATION, headers, load_corpus, make_client, workspace_id

VOCABULARY = {t for section in CORPUS[0]['sections'] for t in tokens(section['title'] + ' ' + section['text'])}


@pytest.fixture(scope='module')
def handbook(tmp_path_factory):
    ws = workspace_id()
    with make_client(tmp_path_factory.mktemp('eval')) as client:
        load_corpus(client, ws)
        yield client, ws


@pytest.mark.parametrize('case', EVALUATION, ids=[case['question'] for case in EVALUATION])
def test_fixed_evaluation_through_the_api(handbook, case):
    client, ws = handbook
    trace = client.post('/api/retrieve', json={'query': case['question'], 'mode': 'keyword'},
                        headers=headers(ws)).json()
    if case.get('expected_source'):
        assert case['expected_source'] in trace['selected']
    else:
        # The question's subject is absent from the handbook. Stemmed keyword
        # search may still match generic words (e.g. "fees" -> "fee"), so
        # the check is that no retrieved passage mentions the subject;
        # saying "not in the document" is then the generation layer's job.
        subject = [t for t in tokens(case['question']) if t not in VOCABULARY]
        assert subject, 'the fixture must not mention the subject'
        texts = [trace['chunks'][cid]['text'].lower() for cid in trace['selected']]
        assert not any(term in text for term in subject for text in texts)

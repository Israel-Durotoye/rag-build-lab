import copy

import pytest

from backend.documents import DocumentError, is_heading, slugify, validate_documents
from conftest import CORPUS


def test_fixture_corpus_round_trips_the_validator():
    parsed = validate_documents(copy.deepcopy(CORPUS))
    assert len(parsed[0]['sections']) == len(CORPUS[0]['sections'])


@pytest.mark.parametrize('value, message', [
    ([], 'at least one'),
    ('handbook', 'at least one'),
    ([{'id': 'a', 'title': 'A', 'sections': []}], 'at least one section'),
    ([{'id': 'Bad ID!', 'title': 'A', 'sections': [{'id': 's', 'title': 'S', 'text': 'T'}]}], 'lowercase'),
    ([{'id': 'a', 'title': 'A', 'sections': [{'id': 's', 'title': 'S', 'text': 'T', 'tenant': 'x'}]}],
     'Unsupported section field'),
    ([{'id': 'a', 'title': 'A', 'extra': True, 'sections': [{'id': 's', 'title': 'S', 'text': 'T'}]}],
     'Unsupported document field'),
    ([{'id': 'a', 'title': 'A', 'sections': [{'id': 's', 'title': 'S', 'text': 'x' * 9000}]}], 'characters'),
    ([{'id': 'a', 'title': 'A', 'metadata': {'tenant': 'alpha'}, 'sections': [{'id': 's', 'title': 'S', 'text': 'T'}]}],
     'Tenant'),
])
def test_validator_rejects_malformed_documents(value, message):
    with pytest.raises(DocumentError, match=message):
        validate_documents(value)


@pytest.mark.parametrize('text, expected', [
    ('2.7 Grading System', True),
    ('CHAPTER THREE', True),
    ('MCE 543: AUTONOMOUS AND MOBILE ROBOTICS', True),
    ('## Opening hours', True),
    ('The university operates a 5.0 grading system.', False),
    ('relevant to the', False),
    ('DEPARTMENT OF', False),
    ('3.4 Requirements to Proceed .......... 57', False),
    ('A' * 120, False),
])
def test_heading_detection(text, expected):
    assert is_heading(text) is expected


def test_slugify_folds_accents_and_punctuation():
    assert slugify('DOME_100_300HB-1') == 'dome-100-300hb-1'
    assert slugify('Ünïcode — only') == 'unicode-only'
    assert slugify('!!!') == ''

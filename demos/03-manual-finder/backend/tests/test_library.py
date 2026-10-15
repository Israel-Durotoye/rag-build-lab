"""The sample library (corpus.json, built by library/build_corpus.py): real
source text, tagged with the models each passage applies to. Unit IDs and
counts may change after a review, so passages are found by their words."""
import importlib.util
import json
import re
import sys

import pytest

from backend.variants import applies
from conftest import CORPUS, DEMO_DIR, MODELS, QUERIES, SAMPLE_MODELS


def _build_corpus():
    spec = importlib.util.spec_from_file_location('build_corpus', DEMO_DIR / 'library' / 'build_corpus.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules['build_corpus'] = module
    writes, sys.dont_write_bytecode = sys.dont_write_bytecode, True  # leave library/ as it is
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = writes
    return module


build_corpus = _build_corpus()
DOCUMENTS = {d['id']: d for d in CORPUS}
REVISIONS = {m['id']: {r['id'] for r in m.get('revisions', [])} for m in MODELS['models']}


def units():
    return [(document, unit) for document in CORPUS for unit in document['sections']]


def tags(document, unit):
    """(models, revisions) of a unit: a shared unit has no device list of its
    own and applies to every model of its manual."""
    meta = unit['metadata']
    return meta.get('device', document['metadata']['models']), meta.get('revisions', {})


def find(pattern, document_id=None):
    hits = [(d, u) for d, u in units() if re.search(pattern, u['text']) and document_id in (None, d['id'])]
    assert len(hits) == 1, [(d['id'], u['id']) for d, u in hits]
    return hits[0]


def chunk(chunk_id):
    doc_id, unit_id, _ = chunk_id.split(':')
    document = DOCUMENTS[doc_id]
    unit = next((u for u in document['sections'] if u['id'] == unit_id), None)
    assert unit is not None, f'{chunk_id} is not in corpus.json'
    return document, unit


def test_the_corpus_holds_the_manuals_the_build_lists_in_order():
    assert [d['id'] for d in CORPUS] == [m['id'] for m in build_corpus.MANUALS]
    for document in CORPUS:
        meta = document['metadata']
        assert meta['licence'] == 'CC BY-SA 4.0' and meta['publisher'] and meta['url'].startswith('https://')
        assert meta['models'] == meta['device'] and set(meta['models']) <= set(SAMPLE_MODELS)
        assert document['sections'], document['id']


def test_every_unit_is_the_sources_own_words():
    assert build_corpus.verify(CORPUS) == []


def test_the_committed_corpus_is_what_the_build_makes_today():
    """corpus.json matches the sources, models.json and the backend's tagging
    rules: a change to any of them needs a rebuild (library/build_corpus.py)."""
    spec = json.loads((DEMO_DIR / 'library' / 'models.json').read_text())
    registry = build_corpus.Registry.from_lists(spec['models'], spec['families'], spec['outside'])
    build_corpus._REGISTRY = registry
    overrides = [dict(o) for o in spec.get('overrides', [])]
    built = [build_corpus.assemble(manual, registry, overrides, {}) for manual in build_corpus.MANUALS]
    assert [o for o in overrides if not o.get('_used')] == []
    assert built == CORPUS


def test_every_unit_applies_only_to_models_of_its_manual():
    for document, unit in units():
        models, revisions = tags(document, unit)
        where = f"{document['id']}/{unit['id']}"
        assert models and set(models) <= set(document['metadata']['models']), where
        assert set(revisions) <= set(models), where
        for model, allowed in revisions.items():
            # Empty: a revision the library doesn't define (the 2B's "1.0").
            assert set(allowed) <= REVISIONS[model], where


def test_a_revision_column_narrows_rows_only_where_it_holds_the_models_revisions():
    rows = {u['text'].split('\n')[-1].split(' | ')[0]: tags(d, u)[1] for d, u in units()
            if u['id'].startswith('new-style-revision-codes-in-use-u')}
    assert rows['a01041'] == {'rpi-2b': ['v1-1']} and rows['a02042'] == {'rpi-2b': ['v1-2']}
    assert rows['a01040'] == {'rpi-2b': []}  # 1.0: none of the 2B's revisions in the library
    # The 3B's revisions are its SoCs, not the board revisions 1.2 and 1.3 of this table.
    assert rows['a02082'] == {} and rows['a22083'] == {}


def test_unit_ids_are_unique_and_chunk_ids_follow_the_contract():
    for document in CORPUS:
        ids = [u['id'] for u in document['sections']]
        assert len(ids) == len(set(ids)), document['id']
        assert all(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', i) for i in ids)


def test_every_override_gives_its_reason():
    assert MODELS['overrides']
    for override in MODELS['overrides']:
        assert isinstance(override.get('reason'), str) and len(override['reason'].strip()) > 20, override
        document = DOCUMENTS[override['document']]
        assert sum(key in override for key in ('units', 'section', 'heading')) == 1, override
        assert override.get('replace', 'shared') in {'shared', 'all'}
        if override['models'] is not None:
            assert set(override['models']) <= set(document['metadata']['models']), override
            assert set(override.get('revisions', {})) <= set(override['models']), override


def test_the_gpio_22_sd0_row_is_the_original_3b_only():
    document, unit = find(r'^Bank 1 \| Bank 2 \| boot type\n22 \| 39 \| SD0$')
    assert tags(document, unit) == (['rpi-3b'], {'rpi-3b': ['bcm2837']})


def test_the_gpio_22_nand_row_is_the_later_3b_and_the_3b_plus():
    document, unit = find(r'^Bank 1 \| Bank 2 \| boot type\n22 \| 39 \| NAND')
    models, revisions = tags(document, unit)
    assert sorted(models) == ['rpi-3b', 'rpi-3b-plus'] and revisions == {'rpi-3b': ['bcm2837b0']}
    assert not applies({'models': models, 'revisions': revisions}, document['metadata']['models'], 'rpi-3b', 'bcm2837')
    assert not applies({'models': models, 'revisions': revisions}, document['metadata']['models'], 'rpi-2b')


def test_port_p102_is_a_different_pin_on_each_r4_board():
    rows = {d['id']: (u['text'].split('\n')[1], tags(d, u)[0]) for d, u in units()
            if u['metadata']['kind'] == 'row' and re.search(r'(^|\| )P102( \||$)', u['text'].split('\n')[1])}
    assert rows == {'uno-r4-minima-manual': ('D5 | P102 | GTIOC2B', ['uno-r4-minima']),
                    'uno-r4-wifi-manual': ('D13 | P102 | GTIOC2B', ['uno-r4-wifi'])}


def test_revision_codes_belong_to_their_board_and_revision():
    document, unit = find(r'\na020d3 \|')
    models, revisions = tags(document, unit)
    assert models == ['rpi-3b-plus'] and 'rpi-3b-plus' not in revisions
    document, unit = find(r'\na01041 \|')
    assert tags(document, unit) == (['rpi-2b'], {'rpi-2b': ['v1-1']})


def test_usb_boot_out_of_the_box_is_the_3b_plus_only():
    document, unit = find(r'support USB mass storage boot out of the box')
    assert tags(document, unit)[0] == ['rpi-3b-plus']


def test_the_labelled_queries_point_at_passages_for_their_model():
    assert len(QUERIES) == 12 and len({q['id'] for q in QUERIES}) == 12
    for query in QUERIES:
        assert query['kind'] in {'exact_code', 'paraphrase', 'mixed', 'ambiguity'}, query['id']
        assert query['model'] is None or query['model'] in SAMPLE_MODELS, query['id']
        if query['expectStatus'] == 'answer':
            assert query['model'] and query['expected'], query['id']
            for chunk_id in query['expected']:
                document, unit = chunk(chunk_id)
                models, revisions = tags(document, unit)
                assert applies({'models': models, 'revisions': revisions}, document['metadata']['models'],
                               query['model'], query.get('revision')), (query['id'], chunk_id)
        else:
            assert query['expectStatus'] == 'clarification' and query['expectedCandidates'], query['id']
            known = REVISIONS[query['model']] if query['model'] else set(SAMPLE_MODELS)
            assert set(query['expectedCandidates']) <= known, query['id']


def test_the_command_line_cases_point_at_passages_for_their_device():
    cases = json.loads((DEMO_DIR / 'evaluation.json').read_text())
    config = json.loads((DEMO_DIR / 'config.json').read_text())
    assert config['default_options']['filters']['device'] in SAMPLE_MODELS
    for case in cases:
        if 'expected_source' not in case:
            continue
        document, unit = chunk(case['expected_source'])
        models, revisions = tags(document, unit)
        device = case.get('filters', {}).get('device')
        assert device is None or device in models, case


@pytest.mark.parametrize('model', SAMPLE_MODELS)
def test_every_model_has_passages_of_its_own(model):
    own = [u for d, u in units() if model in u['metadata'].get('device', [])]
    assert own, model

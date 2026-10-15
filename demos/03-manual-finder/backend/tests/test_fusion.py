"""Rank fusion and the model filter (rag_core.web.retrieval), as Finder uses them."""
import itertools
from fractions import Fraction

import pytest

from rag_core.core import rrf
from rag_core.web.retrieval import CANDIDATES, MODES, RRF_CONSTANT, fuse, retrieve
from conftest import FakeEmbedder, workspace_of


def ids(fused):
    return [f['id'] for f in fused]


def test_ranks_are_fused_with_one_over_constant_plus_rank():
    fused = fuse([['a', 'b', 'c'], ['c', 'a']], 60)
    assert ids(fused) == ['a', 'c', 'b']
    assert fused[0] == {'id': 'a', 'score': round(1 / 61 + 1 / 62, 6), 'ranks': [1, 2], 'bestRank': 1, 'tied': False}
    assert fused[1]['ranks'] == [3, 1] and fused[2]['ranks'] == [2, None]
    # A passage listed twice by one retriever counts once, at its first rank.
    assert fuse([['a', 'a', 'b']], 60)[1] == {'id': 'b', 'score': round(1 / 62, 6), 'ranks': [2], 'bestRank': 2,
                                               'tied': False}


def test_mirror_ranks_tie_exactly_and_fall_back_to_the_id():
    fused = fuse([['b', 'a'], ['a', 'b']], 60)
    assert [(f['id'], f['tied'], f['bestRank']) for f in fused] == [('a', True, 1), ('b', True, 1)]
    assert fused[0]['score'] == fused[1]['score']


def test_two_ranks_of_62_tie_one_rank_of_1_and_the_better_best_rank_goes_first():
    assert 2 * Fraction(1, RRF_CONSTANT + 62) == Fraction(1, RRF_CONSTANT + 1)
    keyword = [f'k{i:02d}' for i in range(62)]
    keyword[0], keyword[61] = 'z', 'a'
    semantic = [f's{i:02d}' for i in range(62)]
    semantic[61] = 'a'
    fused = fuse([keyword, semantic], 60)
    z, a = (next(f for f in fused if f['id'] == name) for name in ('z', 'a'))
    assert z['tied'] and a['tied'] and z['score'] == a['score']
    assert (z['bestRank'], a['bestRank'], a['ranks']) == (1, 62, [62, 62])
    assert ids(fused).index('z') < ids(fused).index('a')
    # With the passage-ID rule (rag_core.core.rrf's), "a" comes first instead.
    by_id = ids(fuse([keyword, semantic], 60, 'id'))
    assert by_id.index('a') < by_id.index('z')


@pytest.mark.parametrize('tie_break', ['best-rank', 'id'])
def test_the_order_never_depends_on_the_order_of_the_inputs(tie_break):
    rankings = [['x', 'y', 'z', 'w'], ['z', 'y', 'x'], ['w', 'v', 'u']]
    first = fuse(rankings, 10, tie_break)
    for permutation in itertools.permutations(rankings):
        again = fuse(list(permutation), 10, tie_break)
        assert [(f['id'], f['score'], f['bestRank'], f['tied']) for f in again] == [
            (f['id'], f['score'], f['bestRank'], f['tied']) for f in first]
    assert ids(fuse([['b', 'a'], ['a', 'b']], 60, tie_break)) == ids(fuse([['a', 'b'], ['b', 'a']], 60, tie_break))


def test_ties_are_flagged_only_for_equal_sums():
    fused = fuse([['a', 'b', 'c'], ['d', 'c', 'b']], 60)
    scores = {f['id']: sum(Fraction(1, 60 + r) for r in f['ranks'] if r) for f in fused}
    for entry in fused:
        assert entry['tied'] == (list(scores.values()).count(scores[entry['id']]) > 1)
    assert [f['id'] for f in fused if f['tied']] == ['b', 'c', 'a', 'd']


def test_a_small_constant_rewards_one_top_rank_and_a_large_one_agreement():
    rankings = [['a', 'x', 'y', 'b'], ['p', 'q', 'r', 'b']]
    assert ids(fuse(rankings, 1))[:2] == ['a', 'p'] and fuse(rankings, 1)[0]['score'] == 0.5
    assert ids(fuse(rankings, 1000))[0] == 'b'


@pytest.mark.parametrize('constant', [0, -1, 1001, 60.0, True, '60', None])
def test_the_constant_must_be_a_whole_number_from_1_to_1000(constant):
    with pytest.raises(ValueError, match='RRF constant'):
        fuse([['a']], constant)


def test_the_constant_bounds_and_the_tie_rule_are_checked():
    assert fuse([['a']], 1)[0]['score'] == 0.5 and fuse([['a']], 1000)[0]['score'] == round(1 / 1001, 6)
    with pytest.raises(ValueError, match='Tie break'):
        fuse([['a']], 60, 'random')


@pytest.mark.parametrize('mode', MODES)
def test_retrieve_never_returns_a_passage_outside_allowed(sample, mode):
    client, library = sample
    source = workspace_of(client, library).library
    every = sorted(source.chunks())
    for allowed in (set(every[::3]), source.allowed('uno-r4-wifi'), source.allowed('rpi-3b', 'bcm2837')):
        trace = retrieve(source, 'Which header pin is RA4M1 port P102 on the GPIO header?', mode=mode, k=10,
                         embedder=FakeEmbedder(), allowed=allowed, constant=60, tie_break='best-rank')
        returned = [*trace['selected'], *trace['chunks'], *(r['id'] for r in trace['keyword']['results']),
                    *(r['id'] for r in trace['semantic']['results']), *(r['id'] for r in trace['fused']['results'])]
        assert set(returned) <= allowed and len(allowed) < len(every)
        assert trace['totalChunks'] == len(allowed) and trace['mode'] == mode
        if allowed != source.allowed('rpi-3b', 'bcm2837'):
            assert trace['selected']
        # Excluded passages never take a rank.
        for results in (trace['keyword']['results'], trace['semantic']['results'], trace['fused']['results']):
            assert [r['rank'] for r in results] == list(range(1, len(results) + 1))
    with pytest.raises(ValueError, match='Tie break'):
        retrieve(source, 'P102', mode=mode, tie_break='random')


def test_the_default_fusion_is_unchanged(sample):
    """tie_break 'id' and constant 60, the defaults the other sites use, still
    rank exactly as rag_core.core.rrf does and add no tie flags."""
    client, library = sample
    source = workspace_of(client, library).library
    query = 'The red power LED flickers when the supply voltage drops'
    trace = retrieve(source, query, mode='hybrid', k=6, embedder=FakeEmbedder())
    keyword_ids = [r['id'] for r in trace['keyword']['results']]
    semantic_ids = [r['id'] for r in trace['semantic']['results']]
    assert keyword_ids and semantic_ids
    expected = rrf([keyword_ids, semantic_ids], 60)
    assert trace['fused']['constant'] == RRF_CONSTANT == 60 and trace['fused']['tieBreak'] == 'id'
    assert [r['id'] for r in trace['fused']['results']] == expected[:CANDIDATES]
    assert trace['selected'] == expected[:6]
    assert all('tied' not in r for r in trace['fused']['results'])
    assert ids(fuse([keyword_ids, semantic_ids], 60, 'id')) == expected
    # Another constant or the best-rank rule goes through the exact fusion and flags ties.
    custom = retrieve(source, query, mode='hybrid', k=6, embedder=FakeEmbedder(), constant=10, tie_break='best-rank')
    assert [r['id'] for r in custom['fused']['results']] == ids(fuse([keyword_ids, semantic_ids], 10))[:CANDIDATES]
    assert all('tied' in r for r in custom['fused']['results']) and custom['fused']['constant'] == 10


def test_keyword_matches_are_filtered_before_the_candidate_cut(sample):
    client, library = sample
    source = workspace_of(client, library).library
    allowed = source.allowed('rpi-2b')
    query = 'How do I reset the board?'
    matching = [hit['chunk'].id for hit in source.index.keyword_matches(query, limit=len(source.chunks()))
                if hit['chunk'].id in allowed]
    trace = retrieve(source, query, mode='keyword', k=5, allowed=allowed)
    assert matching and [r['id'] for r in trace['keyword']['results']] == matching[:CANDIDATES]

from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
import pytest
from rag_core.core import Chunk
from rag_core.pipeline import Pipeline, load_config
from rag_core.study import StudyCompanion, build_context, extract

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / 'demos' / '02-study-companion'
EXCEPTION = 'does not guarantee stability'


def companion(chunk_mode='section', **kw):
    c = StudyCompanion(Pipeline(load_config(DEMO / 'config.json'), **kw))
    c.ingest(chunk_mode)
    return c


def sections(result):
    return [i['section_id'] for i in result['context']]


@pytest.mark.parametrize('chunk_mode', ['section', 'fixed'])
def test_definition_keeps_the_exception(chunk_mode):
    r = companion(chunk_mode).ask('What is negative feedback?')
    assert r['status'] == 'sources_found' and r['mode'] == 'source_search' and r['answer'] is None
    assert sections(r)[0] == 'feedback'
    assert any(EXCEPTION in i['text'] for i in r['context'])
    assert r['explanation']['kind'] == 'extractive'
    assert 'Not a generated explanation' in r['explanation']['label']
    assert any(EXCEPTION in s['text'] for s in r['explanation']['sentences'])
    assert all(s['source_id'] in r['citation_labels'] for s in r['explanation']['sentences'])


def test_fixed_matches_expand_to_parent_section_with_metadata():
    c = companion('fixed')
    r = c.ask('What is negative feedback?')
    item = r['context'][0]
    original = c.original_section('controls', 'feedback')
    assert item['expanded'] and item['id'] == 'controls:feedback' and item['text'] == original['text']
    assert set(item['matched_chunk_ids']) <= {x['id'] for x in r['retrieved']}
    assert item['metadata']['content_hash'] == sha256(original['text'].encode()).hexdigest()
    assert item['metadata']['version'] == '2' and r['corpus_version'] == c.pipe.index.version
    assert r['context_budget']['used_words'] <= r['context_budget']['budget_words']
    assert r['chunk_mode'] == 'fixed'


def test_section_chunks_are_never_expanded():
    r = companion('section').ask('What is negative feedback?')
    assert not any(i['expanded'] for i in r['context'])


def test_expansion_can_be_disabled():
    r = companion('fixed').ask('What is negative feedback?', expand=False)
    assert not any(i['expanded'] for i in r['context'])


def test_comparison_retrieves_both_sides():
    r = companion().ask('Compare open-loop and closed-loop control')
    assert {'open-loop', 'closed-loop'} <= set(sections(r))


def test_ambiguous_followup_needs_a_topic_and_is_limited_to_one():
    c = companion()
    first = c.ask('What about windup?')
    assert first['status'] == 'clarification' and not first['context'] and first['conversation'] == {}

    topic = c.ask('What does integral action do?')
    assert topic['conversation'] == {'topic_question': 'What does integral action do?', 'followups_used': 0}
    # An earlier answer in the conversation is ignored, never used as evidence.
    followup = c.ask('What about windup?', {**topic['conversation'], 'answer': 'INVENTED ANSWER TEXT'})
    assert followup['status'] == 'sources_found'
    assert followup['retrieval_query'] == 'What does integral action do?\nFollow-up: What about windup?'
    assert 'INVENTED' not in json.dumps(followup)
    assert sections(followup)[0] == 'integral' and 'windup' in followup['context'][0]['text']
    assert followup['conversation']['followups_used'] == 1

    second = c.ask('And anti-windup?', followup['conversation'])
    assert second['status'] == 'clarification' and 'one follow-up' in second['notice']
    fresh = c.ask('What is derivative action?', followup['conversation'])
    assert fresh['conversation'] == {'topic_question': 'What is derivative action?', 'followups_used': 0}


def test_absent_topic_abstains():
    r = companion().ask('Explain the Kalman filter')
    assert r['status'] == 'insufficient_evidence'
    assert r['context'] == [] and r['explanation'] is None


def test_budget_skips_expansion_but_keeps_top_match():
    c = companion('fixed')
    c.budget = 30
    r = c.ask('What is negative feedback?')
    assert r['context'] and not r['context'][0]['expanded']
    assert any('parent section' in s['reason'] for s in r['context_budget']['skipped'])


def test_top_match_is_kept_even_when_it_exceeds_the_budget():
    doc = {'id': 'd', 'sections': [{'id': 's', 'title': 'S', 'text': 'word ' * 50}]}
    chunk = Chunk('d:s:0', 'd', 'S', doc['sections'][0]['text'], 's', {'section': 's', 'version': '1'})
    context, budget = build_context([chunk], [doc], budget=10, expand_below=5)
    assert len(context) == 1 and budget['over_budget']


def test_extract_returns_verbatim_sentences_in_reading_order():
    context = [{'id': 'a', 'text': 'Gain is a number. Gain does not fix delay. Weather is nice.'}]
    got = extract('gain', context)
    assert [s['text'] for s in got] == ['Gain is a number.', 'Gain does not fix delay.']


class FakeGenerator:
    """Test double only; no model runs in these tests."""
    def __init__(self, response): self.response = response
    def generate(self, question, sources):
        self.seen = [c.id for c in sources]
        return self.response


def test_generation_uses_the_expanded_context_and_validates_citations():
    fake = FakeGenerator({'answer': 'It does not guarantee stability.', 'citations': ['controls:feedback'], 'insufficient': False})
    c = companion('fixed', generator=fake)
    r = c.ask('What is negative feedback?')
    assert r['status'] == 'generated' and r['explanation']['kind'] == 'generated'
    assert 'controls:feedback' in fake.seen
    fake.response = {'answer': 'x', 'citations': ['controls:feedback:0'], 'insufficient': False}
    r = c.ask('What is negative feedback?')
    assert r['status'] == 'generation_unavailable' and r['explanation']['kind'] == 'extractive'


def test_cli_study_ask_uses_chunking_and_previous():
    run = subprocess.run([sys.executable, '-m', 'rag_core.cli', '--config', str(DEMO / 'config.json'), 'ask',
                          'What about windup?', '--previous', 'What does integral action do?', '--chunking', 'fixed'],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    r = json.loads(run.stdout)
    assert r['chunk_mode'] == 'fixed' and r['context'][0]['section_id'] == 'integral'


def test_chunking_comparison_writes_both_runs(tmp_path):
    subprocess.run([sys.executable, str(DEMO / 'compare_chunking.py'), '--out', str(tmp_path)],
                   cwd=ROOT, capture_output=True, text=True, check=True)
    runs = {m: json.loads((tmp_path / f'chunking-{m}.json').read_text()) for m in ('section', 'fixed')}
    assert [q['question'] for q in runs['section']['questions']] == [q['question'] for q in runs['fixed']['questions']]
    assert len(runs['section']['questions']) == 8
    assert 'winner' not in json.dumps(runs).lower().replace('no winner is declared', '')

import json

from rag_core.study import EXTRACTIVE_LABEL

from conftest import BASELINE, EXCEPTION, HTTPError, ask, events, headers, load_sample, make_client, model_with

ANSWER = [('reasoning', 'Section 1 states the exception. '),
          ('token', 'No. Negative feedback **does not guarantee stability** [1]. '),
          ('token', 'High loop gain or delay can make the loop oscillate [1][2].')]


def done(response):
    stream = events(response)
    assert stream[-1]['type'] == 'done', stream[-1]
    return stream[-1], stream


def test_without_a_model_the_notes_own_sentences_are_shown(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'Does negative feedback guarantee stability?', mode='keyword'))
    assert [e['type'] for e in stream] == ['stage', 'retrieval', 'stage', 'context', 'done']
    assert result['status'] == 'sources_only' and result['answer'] is None and result['citations'] == []
    explanation = result['explanation']
    assert explanation['kind'] == 'extractive' and explanation['label'] == EXTRACTIVE_LABEL
    assert any(EXCEPTION in s['text'] for s in explanation['sentences'])
    source = result['sources'][0]
    assert (source['n'], source['sectionId'], source['docName']) == (1, 'feedback', 'Synthetic control systems study notes')
    assert all(any(s['text'] in src['text'] for src in result['sources'] if src['n'] == s['n'])
               for s in explanation['sentences'])  # every sentence is copied from the section it names
    assert result['caveats'][0] == {'text': 'Important exception: negative feedback does not guarantee stability.', 'n': 1}
    assert 'No model key' in result['generation']['error']


def test_a_generated_explanation_is_streamed_with_checked_citations(tmp_path, ws):
    model, completions = model_with(ANSWER)
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'Does negative feedback guarantee stability?'))
    kinds = [e['type'] for e in stream]
    assert kinds.index('retrieval') < kinds.index('context') < kinds.index('token') < kinds.index('done')
    assert 'reasoning' in kinds and 'generation.attempt' in kinds
    assert result['status'] == 'answered' and EXCEPTION in result['answer']
    assert [c['n'] for c in result['citations']] == [1, 2]
    assert result['citations'][0]['id'] == result['sources'][0]['id']
    assert result['explanation'] is None and result['caveats']
    assert result['generation']['usage']['total_tokens'] == 940
    assert result['conversation'] == {'topic': ['Does negative feedback guarantee stability?'], 'followUp': False}

    system, user = completions.calls[0]['messages']
    assert 'Keep every exception, condition and warning' in system['content']
    assert 'Use only the numbered sections' in system['content']
    assert user['content'].startswith('Sections from the notes:\n\n[1] Synthetic control systems study notes — Negative feedback')
    assert EXCEPTION in user['content'] and user['content'].endswith('Question: Does negative feedback guarantee stability?')
    context = next(e for e in stream if e['type'] == 'context')['trace']
    assert context['prompt']['messages'][1]['content'] == user['content']
    assert context['prompt']['stats']['estimatedTokens'] > 100


def test_citations_to_sections_that_were_not_given_are_removed(tmp_path, ws):
    model, _ = model_with([('token', 'Integral action removes steady-state error [1][9]. It can wind up [12].')])
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, _ = done(ask(client, ws, 'What does integral action do?', mode='keyword'))
    assert result['answer'] == 'Integral action removes steady-state error [1]. It can wind up.'
    assert result['generation']['citations'] == {'valid': [1], 'invalid': [9, 12]}
    assert result['status'] == 'answered'


def test_an_answer_without_citations_is_marked(tmp_path, ws):
    model, _ = model_with([('token', 'Integral action removes steady-state error.')])
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, _ = done(ask(client, ws, 'What does integral action do?', mode='keyword'))
    assert result['status'] == 'uncited' and result['citations'] == []


def test_the_not_found_sentence_is_recognised(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        client.put('/api/settings', json={'notFound': 'Not in these notes.'}, headers=headers(ws))
        model, completions = model_with([('token', 'Not in these notes. You could ask about feedback instead.')])
        client.app.state.services.model = model
        result, _ = done(ask(client, ws, 'Explain the Kalman filter', mode='semantic'))
    assert result['status'] == 'not_found'
    assert 'begin your reply with exactly "Not in these notes."' in completions.calls[0]['messages'][0]['content']


def test_no_model_is_asked_when_nothing_matches(tmp_path, ws):
    model, completions = model_with(ANSWER)
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'Explain the Kalman filter', mode='keyword'))
    assert result['status'] == 'no_passages' and result['sources'] == [] and result['answer'] is None
    assert completions.calls == [] and not any(e['type'] == 'token' for e in stream)


def test_matches_by_meaning_alone_are_flagged_as_weak(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        _, stream = done(ask(client, ws, 'Explain the Kalman filter', mode='hybrid'))
        weak = next(e for e in stream if e['type'] == 'retrieval')['trace']
        _, stream = done(ask(client, ws, 'What is negative feedback?', mode='hybrid'))
        strong = next(e for e in stream if e['type'] == 'retrieval')['trace']
    assert weak['weak'] is True and weak['keyword']['results'] == [] and weak['selected']
    assert strong['weak'] is False


def test_a_follow_up_carries_earlier_questions_and_never_earlier_answers(tmp_path, ws):
    model, completions = model_with('windup in integral action', ANSWER)
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'What about windup?', mode='keyword',
                                  earlier=['What does integral action do?']))
    retrieval = next(e for e in stream if e['type'] == 'retrieval')['trace']
    assert stream[0] == {'type': 'stage', 'stage': 'rewrite'}
    assert retrieval['rewrite']['method'] == 'model' and retrieval['rewrite']['followUp'] is True
    assert retrieval['query'] == 'windup in integral action' and retrieval['original'] == 'What about windup?'
    assert retrieval['rewrite']['carried'] == ['What does integral action do?']
    assert 'never used as evidence' in retrieval['rewrite']['note']
    assert result['sources'][0]['sectionId'] == 'integral'
    assert result['conversation'] == {'topic': ['What does integral action do?', 'What about windup?'], 'followUp': True}

    rewrite, answer = completions.calls
    assert not rewrite['stream'] and 'User: What does integral action do?' in rewrite['messages'][1]['content']
    sent = json.dumps([rewrite['messages'], answer['messages']])
    assert 'Assistant:' not in sent and all(m['role'] != 'assistant' for m in answer['messages'])
    user = answer['messages'][1]['content']
    assert 'Earlier questions in this topic (for reference only, not evidence):\n- What does integral action do?' in user
    assert user.endswith('Question: What about windup?')


def test_without_a_model_a_follow_up_is_searched_with_the_topic_question(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'Does it guarantee stability?', mode='keyword', chunking='fixed',
                                  earlier=['What is negative feedback?', 'Why does it reduce sensitivity?']))
    retrieval = next(e for e in stream if e['type'] == 'retrieval')['trace']
    assert retrieval['query'] == 'What is negative feedback?\nFollow-up: Does it guarantee stability?'
    assert retrieval['rewrite']['method'] == 'topic question + follow-up'
    assert retrieval['rewrite']['carried'] == ['What is negative feedback?']
    assert result['sources'][0]['sectionId'] == 'feedback'
    assert any(EXCEPTION in s['text'] for s in result['explanation']['sentences'])


def test_the_student_can_overrule_follow_up_detection(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        earlier = ['What does integral action do?']
        new_topic, stream = done(ask(client, ws, 'What about windup?', mode='keyword', earlier=earlier, followUp=False))
        rewrite = next(e for e in stream if e['type'] == 'retrieval')['trace']['rewrite']
        assert rewrite['followUp'] is False and rewrite['detected'] is True and rewrite['query'] == 'What about windup?'
        assert new_topic['conversation'] == {'topic': ['What about windup?'], 'followUp': False}

        forced, stream = done(ask(client, ws, 'Compare open-loop and closed-loop control in detail please',
                                  mode='keyword', earlier=earlier, followUp=True))
        rewrite = next(e for e in stream if e['type'] == 'retrieval')['trace']['rewrite']
        assert rewrite['followUp'] is True and rewrite['detected'] is False
        assert forced['conversation']['topic'][0] == 'What does integral action do?'

        first, stream = done(ask(client, ws, 'What about windup?', mode='keyword'))
        assert first['conversation']['followUp'] is False  # nothing to follow up on
        assert first['sources'][0]['sectionId'] == 'integral'


def test_a_failed_rewrite_falls_back_to_the_topic_question(tmp_path, ws):
    model, _ = model_with(HTTPError(404), ANSWER, retries=0)
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'What about windup?', mode='keyword',
                                  earlier=['What does integral action do?']))
    rewrite = next(e for e in stream if e['type'] == 'retrieval')['trace']['rewrite']
    assert rewrite['method'] == 'topic question + follow-up' and 'not found' in rewrite['error']
    assert rewrite['query'] == 'What does integral action do?\nFollow-up: What about windup?'
    assert result['sources'][0]['sectionId'] == 'integral'


def test_when_the_model_cannot_be_reached_the_notes_are_shown(tmp_path, ws):
    model, _ = model_with(HTTPError(503), retries=1)
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'What is negative feedback?', mode='keyword'))
    assert result['status'] == 'unavailable' and result['answer'] is None
    assert result['explanation']['kind'] == 'extractive' and result['sources']
    assert result['generation']['error'] == 'Model unavailable: HTTP 503'
    assert [e['type'] for e in stream].count('generation.retry') == 2


def test_an_answer_cut_off_midway_keeps_what_arrived(tmp_path, ws):
    model, _ = model_with([('token', 'Negative feedback subtracts the output [1].'), HTTPError(502)])
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        result, _ = done(ask(client, ws, 'What is negative feedback?', mode='keyword'))
    assert result['status'] == 'interrupted' and result['answer'].startswith('Negative feedback subtracts')
    assert 'mid-answer' in result['generation']['error']


def test_small_matches_grow_to_their_section_within_the_budget(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        client.put('/api/settings', json={'chunkWords': 40}, headers=headers(ws))
        question = 'What is negative feedback?'
        grown, stream = done(ask(client, ws, question, mode='keyword', chunking='fixed', **BASELINE))
        context = next(e for e in stream if e['type'] == 'context')['trace']
        kept, _ = done(ask(client, ws, question, mode='keyword', chunking='fixed', expand=False, **BASELINE))
        whole, _ = done(ask(client, ws, question, mode='keyword', chunking='section', **BASELINE))
    top = grown['sources'][0]
    assert top['expanded'] and top['id'] == 'controls:feedback' and top['words'] == top['sectionWords'] == 101
    assert len(top['matchedChunkIds']) == 3 and EXCEPTION in top['text']
    assert context['budget']['usedWords'] <= context['budget']['budgetWords'] == 250
    assert context['chunking'] == 'fixed' and len(context['corpusVersion']) == 64 and len(top['contentHash']) == 64
    assert all(not s['expanded'] and s['words'] <= 40 for s in kept['sources'])
    assert kept['sources'][0]['sectionWords'] == 101  # a fragment knows how much it was cut from
    assert all(not s['expanded'] and s['words'] == s['sectionWords'] for s in whole['sources'])
    assert whole['sources'][0]['id'] == 'controls:feedback:0'


def test_the_budget_leaves_out_what_does_not_fit_and_says_so(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        result, stream = done(ask(client, ws, 'Compare open-loop and closed-loop control', mode='keyword',
                                  k=5, budgetWords=120, expandBelowWords=60))
    budget = next(e for e in stream if e['type'] == 'context')['trace']['budget']
    assert budget['usedWords'] <= 120 and budget['skipped'] and not budget['overBudget']
    assert all('budget' in s['reason'] for s in budget['skipped'])
    assert sum(s['words'] for s in result['sources']) == budget['usedWords']


def test_questions_can_be_limited_to_chosen_notes(tmp_path, ws):
    other = [{'id': 'biology', 'title': 'Biology', 'sections': [
        {'id': 'feedback', 'title': 'Hormone feedback', 'text': 'Negative feedback keeps hormone levels stable.'}]}]
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        load_sample(client, ws, other)
        result, _ = done(ask(client, ws, 'negative feedback', mode='keyword', documentIds=['biology']))
    assert {s['docId'] for s in result['sources']} == {'biology'}


def test_ask_rejects_invalid_requests(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        bad = [{'message': ''}, {'message': 'x' * 4001}, {'message': 'ok', 'mode': 'sql'},
               {'message': 'ok', 'chunking': 'sentence'}, {'message': 'ok', 'expand': 'yes'},
               {'message': 'ok', 'followUp': 'maybe'}, {'message': 'ok', 'earlier': 'What is gain?'},
               {'message': 'ok', 'earlier': ['q'] * 13}, {'message': 'ok', 'k': 0}, {'message': 'ok', 'k': 2.5},
               {'message': 'ok', 'budgetWords': 5}, {'message': 'ok', 'documentIds': 'controls'},
               {'message': 'ok', 'history': []}]
        for body in bad:
            response = client.post('/api/ask', json=body, headers=headers(ws))
            assert response.status_code == 400 and response.json()['error'], body
        assert client.post('/api/ask', content='{"message": "ok"}', headers=headers(ws)).status_code == 415

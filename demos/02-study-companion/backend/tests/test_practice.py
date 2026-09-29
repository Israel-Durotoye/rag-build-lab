import json
import random

import pytest

from backend.practice import check_items, quote_found, select_sections
from conftest import HTTPError, events, headers, load_sample, make_client, model_with, workspace_of

QUOTE = 'negative feedback does not guarantee stability'


def quiz_item(**changes):
    return {'question': 'Does negative feedback guarantee stability?',
            'options': ['No, it can still oscillate', 'Yes, always', 'Only in open loop', 'Only with a toaster'],
            'answer': 0, 'explanation': 'The notes state the exception.', 'source': 1, 'quote': QUOTE, **changes}


def card(**changes):
    return {'front': 'Negative feedback', 'back': 'It subtracts the measured output from the reference.',
            'source': 1, 'quote': 'subtracts the measured output from the reference signal', **changes}


def reply(*items):
    return [('reasoning', 'Picking the key ideas. ' * 20), ('token', json.dumps({'items': list(items)}))]


def practise(client, ws, **body):
    return events(client.post('/api/practice', json=body, headers=headers(ws)))


@pytest.fixture
def sections(tmp_path, ws):
    with make_client(tmp_path) as client:
        load_sample(client, ws)
        yield select_sections(workspace_of(client, ws), document_ids=None, focus='negative feedback stability',
                              embedder=None)


def test_a_quiz_is_written_checked_and_saved(tmp_path, ws):
    model, completions = model_with(reply(quiz_item(), quiz_item(question='What can high loop gain cause?',
                                                                 quote='a negative feedback loop can overshoot')))
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        stream = practise(client, ws, kind='quiz', count=3, focus='negative feedback')
        stages = [e['stage'] for e in stream if e['type'] == 'progress']
        assert stages[0] == 'selecting' and stages[-1] == 'checking' and {'thinking', 'writing'} <= set(stages)
        made = stream[-1]['set']
        assert stream[-1]['type'] == 'done' and made['kind'] == 'quiz' and made['title'] == 'Quiz: negative feedback'
        assert [i['id'] for i in made['items']] == ['i01', 'i02'] and made['dropped'] == 0
        first = made['items'][0]
        assert first['options'][first['answer']] == 'No, it can still oscillate' and len(first['options']) == 4
        assert first['verified'] and made['sources'][first['source'] - 1]['sectionId'] == 'feedback'
        assert made['model'] == 'deepseek-v4-flash' and made['level'] == 'standard'

        call = completions.calls[0]
        assert call['stream'] and call['response_format'] == {'type': 'json_object'}
        assert 'exactly 4 short strings' in call['messages'][0]['content']
        assert '[1] Synthetic control systems study notes — Negative feedback' in call['messages'][1]['content']
        assert call['messages'][1]['content'].endswith('Concentrate on: negative feedback')

        listed = client.get('/api/practice', headers=headers(ws)).json()['sets']
        assert listed == [{'id': made['id'], 'kind': 'quiz', 'title': made['title'], 'createdAt': made['createdAt'],
                           'count': 2, 'focus': 'negative feedback', 'documentNames': made['documentNames'],
                           'model': 'deepseek-v4-flash', 'verified': 2, 'dropped': 0}]
        assert client.get(f"/api/practice/{made['id']}", headers=headers(ws)).json() == made
        assert client.delete(f"/api/practice/{made['id']}", headers=headers(ws)).json() == {'deleted': made['id']}
        assert client.get(f"/api/practice/{made['id']}", headers=headers(ws)).status_code == 404
        assert client.get('/api/practice/../../settings', headers=headers(ws)).status_code == 404


def test_items_that_cannot_be_tied_to_the_notes_are_dropped_or_flagged(sections):
    items, dropped = check_items('quiz', {'items': [
        quiz_item(),
        quiz_item(source=99),                                    # a section that was not given
        quiz_item(source='[1]', quote='Feedback always makes a system stable.'),  # the quote is not in the notes
        quiz_item(options=['A', 'B', 'C']),                      # three options
        quiz_item(options=['Same', 'same', 'Other', 'More']),    # duplicate options
        quiz_item(answer=4), quiz_item(answer='0'), quiz_item(question=''), 'not an object',
    ]}, sections, random.Random(1))
    assert dropped == 7 and [i['verified'] for i in items] == [True, False]
    assert items[1]['source'] == 1 and items[1]['quote'] == 'Feedback always makes a system stable.'


def test_the_right_answer_does_not_stay_in_one_position(sections):
    positions = set()
    for seed in range(12):
        items, _ = check_items('quiz', {'items': [quiz_item()]}, sections, random.Random(seed))
        assert items[0]['options'][items[0]['answer']] == 'No, it can still oscillate'
        assert sorted(items[0]['options']) == sorted(quiz_item()['options'])
        positions.add(items[0]['answer'])
    assert len(positions) > 1


def test_quotes_must_appear_in_the_section_word_for_word(sections):
    text = sections[0]['text']
    assert quote_found('Negative feedback  does not guarantee stability.', text)   # spacing and the full stop
    assert quote_found('“negative feedback does not guarantee stability”', text)   # quote marks
    assert not quote_found('negative feedback guarantees stability', text)
    assert not quote_found('not', text)                                             # too short to prove anything


def test_flashcards_are_checked_the_same_way(tmp_path, ws):
    model, _ = model_with(reply(card(), card(front=''), card(source=0), card(quote='Invented words here.')))
    with make_client(tmp_path, model=model) as client:
        load_sample(client, ws)
        made = practise(client, ws, kind='flashcards', count=6)[-1]['set']
    assert made['kind'] == 'flashcards' and made['dropped'] == 2
    assert [(i['front'], i['verified']) for i in made['items']] == [('Negative feedback', True), ('Negative feedback', False)]
    assert made['title'] == 'Flashcards on Synthetic control systems study notes' and 'options' not in made['items'][0]


def test_recall_cards_need_no_model_and_quote_the_notes(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        made = practise(client, ws, kind='recall', count=4)[-1]['set']
        assert made['kind'] == 'recall' and made['model'] is None and len(made['items']) == 4
        for item in made['items']:
            source = made['sources'][item['source'] - 1]
            assert item['back'] == source['text'] and source['title'] in item['front'] and item['verified']
        refused = client.post('/api/practice', json={'kind': 'quiz'}, headers=headers(ws))
        assert refused.status_code == 503 and 'Recall cards work without one' in refused.json()['error']


def test_without_a_focus_sections_are_spread_across_the_notes(tmp_path, ws):
    long_notes = [{'id': 'long', 'title': 'Long notes', 'sections': [
        {'id': f's{i}', 'title': f'Topic {i}', 'text': ' '.join([f'word{i}'] * 40)} for i in range(40)]}]
    with make_client(tmp_path) as client:
        load_sample(client, ws, long_notes)
        chosen = select_sections(workspace_of(client, ws), document_ids=None, focus='', embedder=None,
                                 rng=random.Random(3))
    picked = [int(s['sectionId'][1:]) for s in chosen]
    assert len(picked) == 8 and [s['n'] for s in chosen] == list(range(1, 9))
    assert max(picked) - min(picked) >= 30 and sum(s['words'] for s in chosen) <= 1600


def test_a_reply_that_is_not_a_practice_set_is_reported_plainly(tmp_path, ws):
    for script, message in (([('token', 'Here are some questions for you!')], 'could not be read'),
                            (reply(quiz_item(source=42)), 'could be tied to your notes'),
                            (HTTPError(401), 'could not be reached: Model unavailable: key rejected')):
        model, _ = model_with(script, retries=0)
        with make_client(tmp_path, model=model) as client:
            load_sample(client, ws)
            stream = practise(client, ws, kind='quiz', count=3)
            assert stream[-1]['type'] == 'error' and message in stream[-1]['error'], stream[-1]
            assert client.get('/api/practice', headers=headers(ws)).json() == {'sets': []}


def test_a_focus_nothing_matches_is_reported(tmp_path, ws):
    with make_client(tmp_path, model=None, embedder=None) as client:
        load_sample(client, ws)
        stream = practise(client, ws, kind='recall', count=3, focus='xylophone meteorite')
    assert stream[-1] == {'type': 'error', 'error': 'Nothing in your notes matches that focus. Try other words, or leave it empty.'}


def test_practice_rejects_invalid_requests(tmp_path, ws):
    with make_client(tmp_path) as client:
        assert client.post('/api/practice', json={'kind': 'recall'}, headers=headers(ws)).status_code == 409
        load_sample(client, ws)
        for body in ({'kind': 'essay'}, {'count': 2}, {'count': 13}, {'count': '5'}, {'focus': 'x' * 201},
                     {'documentIds': 'controls'}, {'level': 'exam'}):
            assert client.post('/api/practice', json=body, headers=headers(ws)).status_code == 400, body

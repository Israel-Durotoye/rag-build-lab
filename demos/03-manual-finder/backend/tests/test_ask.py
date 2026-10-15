"""One question through the pipeline (/api/ask): which model, the fault card,
filtered retrieval, the context the model reads, and the answer."""
import time

import pytest

from rag_core.web.retrieval import MODES

from backend.context import verbatim
from backend.preferences import DEFAULT_NOT_FOUND
from conftest import (SAMPLE_MODELS, HTTPError, ask, chunk_applies, done, event, generating, headers, workspace_id,
                      workspace_of)

P102 = 'Which header pin is RA4M1 port P102?'
OUT_OF_THE_BOX = 'Can the 3B+ boot from USB mass storage out of the box?'
ANSWER = [('reasoning', 'The P102 row gives the pin. '), ('token', 'Port P102 is header pin D13 [1]. '),
          ('token', 'It is timer output GTIOC2B [1][9].')]


def chunks_of(sample):
    client, library = sample
    return workspace_of(client, library).library.chunks()


def prompt_of(stream):
    return event(stream, 'context')['trace']['prompt']['messages'][1]['content']


# ------------------------------------------------------------------ which model

def test_without_a_model_finder_asks_and_offers_every_model(sample):
    client, library = sample
    result, stream = done(ask(client, library, 'Which header pin is port P102?'))
    assert [e['type'] for e in stream] == ['stage', 'identify', 'clarification', 'done']
    assert result['status'] == 'clarification' and result['answer'] is None and result['sources'] == []
    clarification = result['clarification']
    assert clarification == event(stream, 'clarification')['clarification']
    assert clarification['reason'] == 'no_model' and clarification['question'] == 'Which header pin is port P102?'
    candidates = clarification['candidates']
    assert sorted(c['id'] for c in candidates) == sorted(SAMPLE_MODELS)
    # Only the choices: no preview of what any manual says.
    assert all(set(c) == {'id', 'name', 'short', 'family', 'matched', 'kind'} and c['kind'] == 'model'
               for c in candidates)
    matched = [c['matched'] for c in candidates]
    assert matched == sorted(matched, reverse=True) and not all(matched)  # boards that match come first
    # The boards whose manuals have P102, not every board whose passages share a word.
    assert {c['id'] for c in candidates if c['matched']} == {'uno-r4-minima', 'uno-r4-wifi'}
    assert event(stream, 'identify')['trace']['chosen'] == {'model': None, 'revision': None, 'source': 'none'}


def test_a_family_name_makes_finder_ask_which_model(sample):
    client, library = sample
    result, _ = done(ask(client, library, 'Does my Pi 3 boot from USB out of the box?'))
    clarification = result['clarification']
    assert clarification['reason'] == 'ambiguous_name' and '“Pi 3”' in clarification['message']
    assert sorted(c['id'] for c in clarification['candidates']) == ['rpi-3b', 'rpi-3b-plus']
    assert result['model'] is None
    r4, _ = done(ask(client, library, 'Does the UNO R4 have a DAC?', model='uno-r4-wifi'))
    assert r4['clarification']['reason'] == 'ambiguous_name'
    assert sorted(c['id'] for c in r4['clarification']['candidates']) == ['uno-r4-minima', 'uno-r4-wifi']
    # A family with one model in the library names that model: nothing to ask.
    only, stream = done(ask(client, library, 'Does my Raspberry Pi 2 boot from USB?', mode='keyword'))
    assert only['status'] == 'sources_only' and only['model']['id'] == 'rpi-2b'
    assert event(stream, 'identify')['trace']['chosen']['source'] == 'question'


def test_a_question_about_another_model_than_the_one_picked_asks_which(sample):
    client, library = sample
    result, _ = done(ask(client, library, 'Can the 2B boot from USB?', model='rpi-3b-plus'))
    clarification = result['clarification']
    assert clarification['reason'] == 'conflict'
    assert sorted(c['id'] for c in clarification['candidates']) == ['rpi-2b', 'rpi-3b-plus']
    assert 'Raspberry Pi 2 Model B' in clarification['message']
    assert 'Raspberry Pi 3 Model B+' in clarification['message']
    # Naming the picked model is no conflict, and a named model needs no picker.
    for body in ({'model': 'rpi-3b-plus'}, {}):
        answered, stream = done(ask(client, library, OUT_OF_THE_BOX, mode='keyword', **body))
        assert answered['status'] == 'sources_only' and answered['model']['id'] == 'rpi-3b-plus'
        assert event(stream, 'identify')['trace']['chosen']['source'] == 'question'


def test_gpio_22_on_the_3b_asks_which_revision(sample):
    client, library = sample
    result, stream = done(ask(client, library, 'What does GPIO 22 select in GPIO boot mode?', model='rpi-3b'))
    clarification = result['clarification']
    assert clarification['reason'] == 'revision' and result['model']['id'] == 'rpi-3b'
    assert [(c['id'], c['kind'], c['matched']) for c in clarification['candidates']] == [
        ('bcm2837', 'revision', True), ('bcm2837b0', 'revision', True)]
    assert 'card' not in [e['type'] for e in stream] and result['card'] is None
    # The 3B+ has one GPIO table: no question.
    plus, _ = done(ask(client, library, 'What does GPIO 22 select in GPIO boot mode?', model='rpi-3b-plus',
                       mode='keyword'))
    assert plus['status'] == 'sources_only'
    assert plus['card']['meaning'] == '22 | 39 | NAND (no Linux support at present)'


# ------------------------------------------------------------------ fault cards

def test_with_the_revision_chosen_the_card_is_read_from_its_table(sample):
    client, library = sample
    result, stream = done(ask(client, library, 'What does gpio-22 select in GPIO boot mode?', model='rpi-3b',
                              revision='bcm2837b0', mode='keyword'))
    card = result['card']
    assert card == event(stream, 'card')['card']
    assert (card['kind'], card['code'], card['display'], card['scheme']) == ('found', 'GPIO22', 'GPIO 22', 'gpio')
    assert card['meaning'] == '22 | 39 | NAND (no Linux support at present)'
    assert card['header'] == 'Bank 1 | Bank 2 | boot type' and card['revision']['id'] == 'bcm2837b0'
    assert [m['id'] for m in card['sameIn']] == ['rpi-3b-plus'] and card['differsIn'] == []
    assert result['revision']['id'] == 'bcm2837b0' and result['readAs'] == ['GPIO 22']
    identify = event(stream, 'identify')['trace']
    assert identify['readAs'] == ['GPIO 22'] and identify['codes'][0]['raw'] == 'gpio-22'
    retrieval = event(stream, 'retrieval')['trace']
    assert 'GPIO 22' in retrieval['query'] and 'gpio-22' not in retrieval['query']
    first = result['sources'][0]
    assert first['n'] == 1 and first['pinned'] and first['matchedChunkIds'][0] == card['chunkId']
    assert '22 | 39 | NAND' in first['text'] and '22 | 39 | SD0' not in prompt_of(stream)

    original, _ = done(ask(client, library, 'What does GPIO 22 select in GPIO boot mode?', model='rpi-3b',
                           revision='bcm2837', mode='keyword'))
    assert original['card']['meaning'] == '22 | 39 | SD0' and original['readAs'] == []
    assert [m['id'] for m in original['card']['differsIn']] == ['rpi-3b-plus']


@pytest.mark.parametrize('model, pin, other', [('uno-r4-minima', 'D5', 'uno-r4-wifi'),
                                               ('uno-r4-wifi', 'D13', 'uno-r4-minima')])
def test_port_p102_is_read_from_each_boards_own_table(sample, model, pin, other):
    client, library = sample
    result, stream = done(ask(client, library, P102, model=model, mode='keyword'))
    card = result['card']
    assert (card['kind'], card['code'], card['model']['id']) == ('found', 'P102', model)
    assert card['meaning'] == f'{pin} | P102 | GTIOC2B' and card['header'] == 'Pin | RA4M1 | Timer'
    assert [m['id'] for m in card['differsIn']] == [other] and card['sameIn'] == []
    assert card['docId'] == f'{model}-manual' and chunk_applies(chunks_of(sample)[card['chunkId']], model)
    first = result['sources'][0]
    assert first['pinned'] and first['matchedChunkIds'][0] == card['chunkId']
    assert f'{pin} | P102 | GTIOC2B' in prompt_of(stream)
    other_pin = 'D5' if pin == 'D13' else 'D13'
    assert f'{other_pin} | P102 | GTIOC2B' not in prompt_of(stream)


@pytest.mark.parametrize('question', ['Which header pin is port P120?', 'Which header pin is RA4M1 port P120?'])
def test_a_code_the_manual_lacks_gets_the_nearest_codes(sample, question):
    client, library = sample
    result, _ = done(ask(client, library, question, model='uno-r4-wifi', mode='keyword'))
    card = result['card']
    assert (card['kind'], card['code'], card['model']['id']) == ('not_found', 'P120', 'uno-r4-wifi')
    assert 'P102' in [c['code'] for c in card['didYouMean']] and len(card['didYouMean']) <= 3
    assert card['elsewhere'] == [] and not any(s['pinned'] for s in result['sources'])


# ------------------------------------------------------------------ the model filter

CASES = [('What board is revision code a020d3?', 'rpi-3b-plus', None),
         (P102, 'uno-r4-wifi', None),
         ('What does GPIO 22 select in GPIO boot mode?', 'rpi-3b', 'bcm2837b0'),
         ('How do I enable USB host boot mode with OTP?', 'rpi-3b-plus', None),
         ('The little red light on the board keeps flickering and sometimes goes out', 'rpi-2b', 'v1-1')]


@pytest.mark.parametrize('mode', MODES)
@pytest.mark.parametrize('question, model, revision', CASES)
def test_no_passage_for_another_model_reaches_the_prompt(sample, mode, question, model, revision):
    client, library = sample
    chunks = chunks_of(sample)
    result, stream = done(ask(client, library, question, model=model, revision=revision, mode=mode, k=8))
    assert result['status'] == 'sources_only' and result['model']['id'] == model
    retrieval = event(stream, 'retrieval')['trace']
    assert retrieval['mode'] == mode and retrieval['filter']['model'] == model
    assert retrieval['filter']['excluded'] > 0
    found = [*retrieval['selected'], *(r['id'] for r in retrieval['keyword']['results']),
             *(r['id'] for r in retrieval['semantic']['results']), *(r['id'] for r in retrieval['fused']['results'])]
    assert found and all(chunk_applies(chunks[c], model, revision) for c in found)

    context = event(stream, 'context')['trace']
    prompt = context['prompt']['messages'][1]['content']
    assert result['sources'] == context['items'] and result['sources']
    shown, masked = [], []
    for item in result['sources']:
        assert all(chunk_applies(chunks[c], model, revision) for c in item['matchedChunkIds'])
        assert item['text'] in prompt
        for unit in item['units']:
            # Every unit of the section is in the trace; those for other models are marked masked.
            assert unit['masked'] is not chunk_applies(chunks[unit['chunkId']], model, revision)
            (masked if unit['masked'] else shown).append(unit)
    assert context['masked'] == len(masked)
    kept = [unit['text'] for unit in shown]
    for unit in masked:
        # A row's own cells (its header line is shared with the rows that are kept).
        lines = unit['text'].split('\n')[1:] if unit['kind'] == 'row' and unit['header'] else unit['text'].split('\n')
        for line in lines:
            if not any(line in text for text in kept):
                assert line not in prompt, unit['chunkId']
    for item in (result['excluded'] or {'items': []})['items']:
        assert not chunk_applies(chunks[item['id']], model, revision)


def test_rows_for_other_models_are_masked_and_never_sent(sample):
    client, library = sample
    result, stream = done(ask(client, library, 'What board is revision code a020d3?', model='rpi-3b-plus',
                              mode='keyword'))
    assert result['card']['code'] == 'A020D3' and result['card']['meaning'] == 'a020d3 | 3B+ | 1.3 | 1 GB | Sony UK'
    table = result['sources'][0]
    assert table['pinned'] and table['partial'] is False
    masked = [u['text'] for u in table['units'] if u['masked']]
    assert 'Code | Model | Revision | RAM | Manufacturer\na01041 | 2B | 1.1 | 1 GB | Sony UK' in masked
    prompt = prompt_of(stream)
    assert 'a020d3 | 3B+ | 1.3 | 1 GB | Sony UK' in prompt and 'a01041' not in prompt
    # The rows that are kept are read under their header, written once.
    assert 'Code | Model | Revision | RAM | Manufacturer\na020d3 | 3B+ |' in table['text']
    assert table['text'].count('Code | Model | Revision | RAM | Manufacturer') == 1


def test_other_models_matches_are_listed_apart_and_never_sent(sample):
    client, library = sample
    chunks = chunks_of(sample)
    result, stream = done(ask(client, library, P102, model='uno-r4-wifi', mode='keyword'))
    excluded = result['excluded']
    assert excluded == event(stream, 'excluded')['excluded']
    assert 0 < len(excluded['items']) <= 5 and excluded['count'] >= len(excluded['items'])
    assert [i['rank'] for i in excluded['items']] == list(range(1, len(excluded['items']) + 1))
    minima_row = next(cid for cid, c in chunks.items()
                      if c['docId'] == 'uno-r4-minima-manual' and c['text'].endswith('\nD5 | P102 | GTIOC2B'))
    assert minima_row in [i['id'] for i in excluded['items']]
    for item in excluded['items']:
        assert not chunk_applies(chunks[item['id']], 'uno-r4-wifi')
        assert 'uno-r4-wifi' not in [m['id'] for m in item['models']] and item['text'] == chunks[item['id']]['text']
    assert 'D5 | P102 | GTIOC2B' not in prompt_of(stream)
    # The trace counts every passage the filter left out.
    assert event(stream, 'retrieval')['trace']['filter']['excluded'] == len(chunks) - len(
        workspace_of(client, library).library.allowed('uno-r4-wifi'))


# ------------------------------------------------------------------ the answer

def test_a_written_answer_is_streamed_with_checked_citations(sample):
    client, library = sample
    with generating(client, ANSWER) as completions:
        result, stream = done(ask(client, library, P102, model='uno-r4-wifi', mode='keyword'))
    kinds = [e['type'] for e in stream]
    assert kinds.index('card') < kinds.index('retrieval') < kinds.index('context') < kinds.index('token')
    assert kinds[-1] == 'done'
    assert 'generation.attempt' in kinds and 'reasoning' in kinds
    assert {'type': 'stage', 'stage': 'generation'} in stream
    assert result['status'] == 'answered' and result['explanation'] is None
    assert result['answer'] == 'Port P102 is header pin D13 [1]. It is timer output GTIOC2B [1].'
    assert result['generation']['citations'] == {'valid': [1], 'invalid': [9]}
    assert result['citations'] == [{'n': 1, 'id': result['sources'][0]['id']}]
    assert result['generation']['usage']['total_tokens'] == 940
    assert result['generation']['reasoning'] == 'The P102 row gives the pin. '

    call = completions.calls[0]
    assert call['stream'] is True and call['temperature'] == 0.2
    system, user = call['messages']
    assert 'They come from the manual for the Arduino UNO R4 WiFi' in system['content']
    assert 'Never add steps, tools, settings' in system['content']
    assert user['content'].startswith('Passages from the manual for the Arduino UNO R4 WiFi:\n\n[1] ')
    assert user['content'].endswith(f'Question: {P102}')
    assert user['content'] == prompt_of(stream)
    assert 'D13 | P102 | GTIOC2B' in user['content'] and 'D5 | P102 | GTIOC2B' not in user['content']


def test_a_slow_model_gets_blank_heartbeat_lines_and_the_answer_still_arrives(sample, monkeypatch):
    # A proxy that cuts idle responses (a Next.js rewrite allows 30 s) sees a
    # blank line whenever the stream has been quiet this long.
    client, library = sample
    monkeypatch.setattr('backend.app.HEARTBEAT_SECONDS', 0.05)

    def slow(_):
        time.sleep(0.4)
        return ANSWER

    with generating(client, slow):
        response = ask(client, library, P102, model='uno-r4-wifi', mode='keyword')
    assert '\n\n' in response.text
    result, _ = done(response)
    assert result['status'] == 'answered' and 'D13' in result['answer']


def test_an_answer_without_citations_is_marked_uncited(sample):
    client, library = sample
    with generating(client, [('token', 'Port P102 is header pin D13.')]):
        result, _ = done(ask(client, library, P102, model='uno-r4-wifi', mode='keyword'))
    assert result['status'] == 'uncited' and result['citations'] == []


def test_without_a_model_key_the_manuals_own_sentences_are_shown(sample):
    client, library = sample
    result, stream = done(ask(client, library, OUT_OF_THE_BOX, mode='keyword'))
    assert 'token' not in [e['type'] for e in stream]
    assert result['status'] == 'sources_only' and result['answer'] is None and result['citations'] == []
    explanation = result['explanation']
    assert explanation['kind'] == 'extractive' and 'Not a generated explanation' in explanation['label']
    sentences = explanation['sentences']
    assert any(s['text'] == 'The Raspberry Pi 3B+ and Zero 2 W support USB mass storage boot out of the box.'
               for s in sentences)
    items = {item['n']: item for item in result['sources']}
    assert all(s['text'] in items[s['n']]['text'].replace('\n', ' ') for s in sentences)  # copied, never written
    assert 'No model key' in result['generation']['error']


def test_the_manuals_sentences_leave_out_ones_sharing_a_single_word_with_the_question():
    items = [{'id': 'a', 'n': 1, 'text': 'Officially supported pins are: Pin | RA4M1 | Timer D5 | P102 | GTIOC2B'},
             {'id': 'b', 'n': 2, 'text': 'The COM port number will be reflected on Arduino IDE.'}]
    assert [s['n'] for s in verbatim('Which header pin is port P102?', items)['sentences']] == [1]
    # With nothing better, a sentence sharing one word still stands in.
    assert [s['n'] for s in verbatim('Which port?', items[1:])['sentences']] == [2]


def test_when_the_model_cannot_be_reached_the_manuals_sentences_stand_in(sample):
    client, library = sample
    with generating(client, HTTPError(503), retries=0):
        result, stream = done(ask(client, library, OUT_OF_THE_BOX, mode='keyword'))
    assert result['status'] == 'unavailable' and result['answer'] is None
    assert result['explanation']['kind'] == 'extractive' and result['explanation']['sentences']
    assert result['generation']['error'] == 'Model unavailable: HTTP 503'
    assert result['generation']['attempts'][-1]['ok'] is False
    assert 'generation.retry' in [e['type'] for e in stream]


def test_a_reply_that_begins_with_the_not_found_sentence_is_not_found(sample):
    client, library = sample
    reply = [('token', f'{DEFAULT_NOT_FOUND} The passages only cover USB boot.')]
    with generating(client, reply) as completions:
        result, _ = done(ask(client, library, OUT_OF_THE_BOX, mode='keyword'))
    assert result['status'] == 'not_found' and result['answer'].startswith(DEFAULT_NOT_FOUND)
    assert f'begin your reply with exactly "{DEFAULT_NOT_FOUND}"' in completions.calls[0]['messages'][0]['content']


def test_nothing_matched_means_no_model_is_asked(sample):
    client, library = sample
    with generating(client, ANSWER) as completions:
        result, stream = done(ask(client, library, 'xylophonemeteoritezz', model='rpi-2b', mode='keyword'))
    assert result['status'] == 'no_passages' and result['sources'] == [] and result['answer'] is None
    assert completions.calls == [] and 'token' not in [e['type'] for e in stream]


# ------------------------------------------------------------------ conversation and safety

def test_a_follow_up_that_names_no_model_keeps_the_earlier_questions_model(sample):
    client, library = sample
    earlier = ['Can the 3B+ boot from USB mass storage?']
    question = 'Does it need program_usb_boot_mode?'
    result, stream = done(ask(client, library, question, earlier=earlier, mode='keyword'))
    assert result['status'] == 'sources_only' and result['model']['id'] == 'rpi-3b-plus'
    assert result['conversation'] == {'topic': [*earlier, question], 'followUp': True}
    identify = event(stream, 'identify')['trace']
    assert identify['chosen'] == {'model': 'rpi-3b-plus', 'revision': None, 'source': 'question'}
    assert identify['rewrite']['method'] == 'first question + follow-up' and identify['rewrite']['carried'] == earlier
    assert event(stream, 'retrieval')['trace']['filter']['model'] == 'rpi-3b-plus'
    # As a new topic it names no model, so Finder asks.
    fresh, _ = done(ask(client, library, question, earlier=earlier, followUp=False))
    assert fresh['clarification']['reason'] == 'no_model'
    # An earlier question about two models settles nothing either.
    two, _ = done(ask(client, library, question, earlier=['Do the 3B and the 3B+ boot from USB?']))
    assert two['clarification']['reason'] == 'no_model'


def test_safety_notes_quote_the_manuals_warning(sample):
    client, library = sample
    warning = 'WARNING: Any change you make to OTP (one-time programmable) memory is permanent and cannot be undone.'
    result, _ = done(ask(client, library, 'How do I enable USB host boot mode with OTP?', model='rpi-3b',
                         mode='keyword'))
    notes = result['safetyNotes']
    assert 0 < len(notes) <= 3
    note = next(n for n in notes if n['text'] == warning)
    assert warning in result['sources'][note['n'] - 1]['text']
    # The 3B+ boots from USB without the OTP step: the warning is not part of its answer.
    plus, _ = done(ask(client, library, 'How do I enable USB host boot mode with OTP?', model='rpi-3b-plus',
                       mode='keyword'))
    assert all(n['text'] != warning for n in plus['safetyNotes'])
    assert all(warning not in s['text'] for s in plus['sources'])


# ------------------------------------------------------------------ requests

@pytest.mark.parametrize('body', [
    {'message': ''}, {'message': '   '}, {'message': 'x' * 4001}, {'message': 5}, {'message': 'ok', 'mode': 'sql'},
    {'message': 'ok', 'model': 'Bad Id'}, {'message': 'ok', 'model': 'unknown-board'}, {'message': 'ok', 'model': 5},
    {'message': 'ok', 'revision': 'v1-1'}, {'message': 'ok', 'model': 'rpi-3b', 'revision': 'v1-1'},
    {'message': 'ok', 'followUp': 'maybe'}, {'message': 'ok', 'followUp': 1}, {'message': 'ok', 'earlier': 'E17?'},
    {'message': 'ok', 'earlier': ['q'] * 13}, {'message': 'ok', 'earlier': [5]}, {'message': 'ok', 'k': 0},
    {'message': 'ok', 'k': 2.5}, {'message': 'ok', 'rrfConstant': 0}, {'message': 'ok', 'budgetWords': 50},
    {'message': 'ok', 'history': []},
])
def test_ask_rejects_invalid_requests(sample, body):
    client, library = sample
    response = client.post('/api/ask', json=body, headers=headers(library))
    assert response.status_code == 400 and response.json()['error'], body


def test_ask_needs_json_and_manuals(sample):
    client, library = sample
    assert client.post('/api/ask', content='{"message": "ok"}', headers=headers(library)).status_code == 415
    assert client.post('/api/ask', content='[]', headers={**headers(library), 'Content-Type': 'application/json'}
                       ).status_code == 400
    empty = client.post('/api/ask', json={'message': 'What does E17 mean?'}, headers=headers(workspace_id()))
    assert empty.status_code == 409 and 'Add manuals' in empty.json()['error']


# ------------------------------------------------------------------ found in review

def test_the_manuals_sentences_never_quote_ones_about_other_products_only(sample):
    # The power-supply passage covers the 3B+, but two of its sentences recommend supplies for the Pi 4,
    # 400 and 5 only. A sentence that compares the Pi 3 with them still applies.
    client, library = sample
    result, _ = done(ask(client, library, 'Which USB-C power supply should I use?', model='rpi-3b-plus',
                         mode='keyword'))
    quoted = [s['text'] for s in result['explanation']['sentences']]
    assert quoted and not [s for s in quoted if s.startswith(('For Raspberry Pi 4', 'For Raspberry Pi 5'))]
    assert any(s.startswith('All models up to the Raspberry Pi 3 require a micro USB') for s in quoted)


def test_a_code_in_a_table_with_a_column_per_model_belongs_to_its_column(sample):
    client, library = sample
    for question, code in (('What does the ESP32 do on my board?', 'ESP32'), ('Does it use the RA4M1?', 'RA4M1')):
        result, _ = done(ask(client, library, question, model='uno-r3', mode='keyword'))
        assert (result['card']['code'], result['card']['kind']) == (code, 'not_found'), question
    found, _ = done(ask(client, library, 'Does it use the RA4M1?', model='uno-r4-minima', mode='keyword'))
    assert found['card']['kind'] == 'found'


def test_a_code_only_some_revisions_have_makes_finder_ask_which(sample):
    client, library = sample
    question = 'What does GPIO 20 select in GPIO boot mode?'
    result, _ = done(ask(client, library, question, model='rpi-3b', mode='keyword'))
    assert result['status'] == 'clarification' and result['clarification']['reason'] == 'revision'
    assert [(c['id'], c['matched']) for c in result['clarification']['candidates']] == [
        ('bcm2837', False), ('bcm2837b0', True)]
    original, _ = done(ask(client, library, question, model='rpi-3b', revision='bcm2837', mode='keyword'))
    assert original['card']['kind'] == 'not_found'
    # A revision code names its own revision: no question.
    code, _ = done(ask(client, library, 'a01041', model='rpi-2b', mode='keyword'))
    assert code['status'] != 'clarification' and code['card']['kind'] == 'found'


def test_a_quoted_sentence_keeps_the_revision_it_is_limited_to(sample):
    client, library = sample
    result, _ = done(ask(client, library, 'How do I set the USB host bit in OTP to boot from USB?', model='rpi-2b',
                         mode='keyword'))
    otp = [s for s in result['explanation']['sentences'] if 'OTP' in s['text']]
    assert otp and all(s['only'] == 'v1.2' and not s['text'].startswith('(Only') for s in otp)


def test_a_revision_the_library_lacks_applies_to_no_chosen_revision(sample):
    client, library = sample
    result, _ = done(ask(client, library, 'a01040', model='rpi-2b', revision='v1-2', mode='keyword'))
    assert result['card']['kind'] == 'not_found'


def test_the_original_3bs_gpio_banks_never_reach_the_3b_plus(sample):
    client, library = sample
    _, stream = done(ask(client, library, 'Which GPIOs are in bank 1 for GPIO boot mode?', model='rpi-3b-plus',
                         mode='keyword'))
    assert 'Bank 1 is GPIOs 22-26' not in prompt_of(stream)

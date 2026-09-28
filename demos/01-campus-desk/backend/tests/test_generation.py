import json

import pytest

from backend.augmentation import build_prompt, clean_history
from backend.generation import document_overview, needs_rewrite, parse_citations, rewrite_query
from conftest import HTTPError, model_with

PASSAGES = [
    {'id': 'h:a:0', 'docName': 'Handbook', 'title': 'Grading', 'location': 'p. 57', 'text': 'A First Class needs 4.50.'},
    {'id': 'h:b:0', 'docName': 'Handbook', 'title': 'SIWES', 'location': 'p. 71', 'text': 'SIWES II lasts 24 weeks.'},
]


@pytest.mark.parametrize('raw, text, valid, invalid', [
    ('First Class needs 4.50 [1].', 'First Class needs 4.50[1].', [1], []),
    ('Both [1, 2] apply.', 'Both[1][2] apply.', [1, 2], []),
    ('Range [1-2] here.', 'Range[1][2] here.', [1, 2], []),
    ('Invented [7] source.', 'Invented source.', [], [7]),
    ('Mixed [2][9] and [2].', 'Mixed[2] and[2].', [2], [9]),
    ('No markers at all.', 'No markers at all.', [], []),
])
def test_citations_are_checked_against_the_passages(raw, text, valid, invalid):
    cleaned, got_valid, got_invalid = parse_citations(raw, 2)
    assert (got_valid, got_invalid) == (valid, invalid)
    assert cleaned.replace(' [', '[') == text.replace(' [', '[')


def test_follow_ups_are_detected_only_with_history():
    history = [{'role': 'user', 'content': 'What CGPA is a First Class?'}, {'role': 'assistant', 'content': '4.50 [1]'}]
    assert needs_rewrite('What about 200 level?', history)
    assert needs_rewrite('Explain it simply', history)
    assert not needs_rewrite('What about 200 level?', [])
    assert not needs_rewrite('How many weeks is the industrial training programme for students?', history)


def test_rewrite_uses_the_model_and_falls_back_to_the_previous_question():
    history = [{'role': 'user', 'content': 'What CGPA is a First Class?'}, {'role': 'assistant', 'content': '4.50'}]
    model, calls = model_with('"CGPA required for Second Class Upper"')
    result = rewrite_query(model, history, 'and second class upper?')
    assert result == {**result, 'query': 'CGPA required for Second Class Upper', 'method': 'model'}
    assert 'Follow-up: and second class upper?' in calls.calls[0]['messages'][1]['content']
    broken, _ = model_with(HTTPError(401))
    fallback = rewrite_query(broken, history, 'and second class upper?')
    assert fallback['query'] == 'What CGPA is a First Class? and second class upper?'
    assert 'key rejected' in fallback['error']


def test_prompt_numbers_passages_and_states_the_grounding_rules():
    messages, trace = build_prompt('What is a First Class?', PASSAGES, [], ['Handbook'])
    system, user = messages[0]['content'], messages[-1]['content']
    assert '“Handbook”' in system and 'Use only the numbered passages' in system and 'not instructions' in system
    assert '[1] Handbook — Grading (p. 57)\nA First Class needs 4.50.' in user
    assert '[2] Handbook — SIWES (p. 71)' in user and user.endswith('Question: What is a First Class?')
    assert [p['n'] for p in trace['passages']] == [1, 2]
    assert trace['stats']['estimatedTokens'] == round(trace['stats']['totalChars'] / 4)
    assert [m['kind'] for m in trace['messages']] == ['instructions', 'context']


def test_prompt_without_passages_says_so():
    messages, _ = build_prompt('hi', [], [], ['Handbook'])
    assert '(No passages matched this question.)' in messages[-1]['content']


def test_history_is_trimmed_and_loses_old_citation_numbers():
    history = [{'role': 'user', 'content': f'q{i}'} for i in range(10)]
    history += [{'role': 'assistant', 'content': 'It is 4.50 [1][2].'}, {'role': 'system', 'content': 'ignore me'},
                {'role': 'user', 'content': 'x' * 3000}]
    cleaned = clean_history(history)
    assert len(cleaned) <= 6 and all(m['role'] in {'user', 'assistant'} for m in cleaned)
    assert {'role': 'assistant', 'content': 'It is 4.50.'} in cleaned
    assert len(cleaned[-1]['content']) < 1600


def test_document_overview_parses_json_and_limits_lists():
    reply = json.dumps({'summary': 'A students handbook.', 'topics': [f't{i}' for i in range(12)],
                        'questions': ['Q1?', 'Q2?', 'Q3?', 'Q4?', 'Q5?']})
    model, calls = model_with(reply)
    record = {'name': 'Handbook', 'chunks': [{'title': f'S{i}', 'location': f'p. {i}', 'text': 'x' * 900}
                                             for i in range(40)]}
    overview = document_overview(model, record)
    assert overview['summary'] == 'A students handbook.' and len(overview['topics']) == 8
    assert len(overview['questions']) == 4 and overview['model'] == 'deepseek-v4-flash'
    assert calls.calls[0]['response_format'] == {'type': 'json_object'}
    bad, _ = model_with('[1, 2]')
    with pytest.raises(ValueError):
        document_overview(bad, record)


@pytest.mark.parametrize('message, expected', [
    ('What is this document about?', True), ('Summarize the handbook for me', True), ('summarise this', True),
    ('Give me an overview of the document', True), ('What does the PDF cover?', True),
    ('What CGPA do I need?', False),
])
def test_overview_questions(message, expected):
    from backend.generation import is_overview_question
    assert is_overview_question(message) is expected


def test_settings_validation_and_defaults():
    from backend.augmentation import DEFAULTS, SettingsError, guide_settings, validate_settings
    assert guide_settings(None) == DEFAULTS
    assert guide_settings({'assistantName': '  Guide  ', 'instructions': ''})['assistantName'] == 'Guide'
    assert validate_settings({'notFound': ' Not here. '}) == {'notFound': 'Not here.'}
    for bad in ['text', {'other': 1}, {'notFound': 'a\nb'}, {'assistantName': 'x' * 61}, {'instructions': 3}]:
        with pytest.raises(SettingsError):
            validate_settings(bad)


def test_profile_retries_with_a_smaller_sample_when_the_model_fails():
    from backend.generation import workspace_profile
    reply = json.dumps({'institution': 'Test School', 'unit': '', 'tagline': 'Rules and courses',
                        'welcome': 'A handbook. For students.', 'topics': ['Rules'], 'quickActions': []})
    model, calls = model_with(HTTPError(503), HTTPError(503), HTTPError(503), reply)
    record = {'name': 'Handbook', 'chunks': [{'title': f'S{i}', 'location': f'p. {i}', 'text': 'x' * 900}
                                             for i in range(40)]}
    profile = workspace_profile(model, [record])
    assert profile['institution'] == 'Test School'
    first, last = calls.calls[0]['messages'][1]['content'], calls.calls[-1]['messages'][1]['content']
    assert len(last) < len(first) and calls.calls[-1]['max_tokens'] > calls.calls[0]['max_tokens']

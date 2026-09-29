import pytest

from conftest import BASELINE, EXCEPTION, QUESTIONS, headers, load_sample, make_client


def compare(client, ws, query, **body):
    response = client.post('/api/compare', json={'query': query, 'mode': 'keyword', **body}, headers=headers(ws))
    assert response.status_code == 200, response.text
    return response.json()


def query_for(case):
    return f"{case['previous']}\nFollow-up: {case['question']}" if case.get('previous') else case['question']


@pytest.fixture
def client(tmp_path, ws):
    with make_client(tmp_path, model=None) as client:
        load_sample(client, ws)
        yield client


def test_both_chunkings_answer_the_same_question_side_by_side(client, ws):
    result = compare(client, ws, 'What is negative feedback?')
    section, fixed = result['runs']['section'], result['runs']['fixed']
    assert (section['chunking'], section['chunkWords'], section['totalChunks']) == ('section', None, 8)
    assert fixed['chunkWords'] == 50 and fixed['totalChunks'] == 11
    assert section['expanded'] == 0 and fixed['expanded'] > 0
    assert section['retrieved'][0]['id'] == 'controls:feedback:0' and section['retrieved'][0]['rank'] == 1
    # 101 words are two windows, not 50 + 50 + 1: the one-word tail joins the second.
    assert sorted(c['words'] for c in fixed['retrieved'] if c['sectionId'] == 'feedback') == [50, 51]
    assert fixed['retrieved'][0]['pieces'] == 2 and fixed['retrieved'][0]['sectionWords'] == 101
    assert fixed['context'][0]['id'] == 'controls:feedback' and fixed['context'][0]['expanded']
    for run in (section, fixed):
        assert run['sections'][0] == 'controls:feedback' and run['budget']['usedWords'] <= 600
        assert any(EXCEPTION in c['text'] for c in run['caveats'])
    assert result['agreement']['both'][0] == 'controls:feedback'
    assert result['titles']['controls:feedback']['title'] == 'Negative feedback'
    assert 'neither chunking is declared better' in result['scope']
    assert result['options'] == {'k': 5, 'budgetWords': 600, 'expandBelowWords': 60, 'chunkWords': 50}


def test_a_difference_between_the_chunkings_is_reported_not_judged(client, ws):
    client.put('/api/settings', json={'chunkWords': 40}, headers=headers(ws))
    result = compare(client, ws, 'How does proportional control differ from integral action?', **BASELINE)
    assert 'controls:gain' in result['runs']['section']['sections']
    assert 'controls:gain' not in result['runs']['fixed']['sections']
    assert result['agreement']['sectionOnly'] == ['controls:gain']
    assert set(result) >= {'runs', 'agreement', 'scope'} and 'winner' not in result and 'better' not in result['agreement']


def test_expansion_can_be_switched_off(client, ws):
    # Only the first window of the feedback section mentions the thermostat.
    on = compare(client, ws, 'thermostat heater')['runs']['fixed']
    off = compare(client, ws, 'thermostat heater', expand=False)['runs']['fixed']
    assert [c['id'] for c in on['retrieved']] == [c['id'] for c in off['retrieved']]
    assert on['retrieved'][0]['id'] == 'controls:feedback:0' and on['expanded'] == 1
    assert (on['context'][0]['id'], on['context'][0]['words']) == ('controls:feedback', 101)
    assert 'does not guarantee stability' in on['context'][0]['text']

    assert off['expanded'] == 0 and off['budget']['expansion'] is False
    fragment = off['context'][0]
    assert (fragment['id'], fragment['words'], fragment['sectionWords']) == ('controls:feedback:0', 50, 101)
    assert 'does not guarantee stability' not in fragment['text']  # the exception is in the next window
    assert off['budget']['usedWords'] == on['budget']['usedWords'] - 51
    assert all(item['words'] < 50 + 50 // 4 and not item['expanded'] for item in off['context'])


@pytest.mark.parametrize('case', [c for c in QUESTIONS if c.get('expected_sections')], ids=lambda c: c['id'])
def test_the_question_set_reaches_its_sections_with_section_chunking(client, ws, case):
    run = compare(client, ws, query_for(case))['runs']['section']
    found = [s.split(':')[1] for s in run['sections']]
    assert all(section in found for section in case['expected_sections'])
    if case.get('exception_check'):
        assert any(case['exception_check'] in item['text'] for item in run['context'])


def test_the_absent_topic_finds_nothing_by_keyword(client, ws):
    case = next(c for c in QUESTIONS if c.get('expected_status') == 'insufficient_evidence')
    result = compare(client, ws, case['question'])
    assert all(run['context'] == [] and run['retrieved'] == [] for run in result['runs'].values())
    assert result['agreement'] == {'both': [], 'sectionOnly': [], 'fixedOnly': []}


def test_compare_rejects_invalid_requests(client, ws):
    for body in ({'query': ''}, {'query': 'x', 'mode': 'sql'}, {'query': 'x', 'k': 99}, {'query': 'x', 'chunking': 'fixed'}):
        assert client.post('/api/compare', json=body, headers=headers(ws)).status_code == 400, body

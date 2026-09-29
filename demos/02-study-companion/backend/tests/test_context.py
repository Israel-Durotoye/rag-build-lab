from backend.context import caveats, verbatim

ITEMS = [
    {'n': 1, 'id': 'notes:feedback', 'text': (
        'Negative feedback subtracts the measured output from the reference. '
        'Important exception: negative feedback does not guarantee stability. '
        'Always check stability separately.')},
    {'n': 2, 'id': 'notes:open-loop', 'text': (
        'An open-loop controller sends a command without measuring the result. '
        'Open-loop control cannot become unstable through feedback, but it cannot correct for disturbances.')},
    {'n': 3, 'id': 'notes:gain', 'text': (
        'Raising the gain makes the response faster. '
        'The gain must not be raised further unless the loop stays stable.')},
]


def test_a_caveat_is_a_qualified_sentence_about_what_was_asked():
    found = caveats('Does negative feedback guarantee stability?', ITEMS)
    assert found == [{'text': 'Important exception: negative feedback does not guarantee stability.', 'n': 1}]


def test_a_sentence_that_only_mentions_the_subject_is_not_a_caveat():
    # The open-loop sentence shares one word ("feedback") with a four-word question.
    assert all(c['n'] != 2 for c in caveats('Does negative feedback guarantee stability?', ITEMS))
    # Asked about open-loop control itself, it shares two and is one.
    assert caveats('Can open-loop control become unstable?', ITEMS) == [{
        'text': 'Open-loop control cannot become unstable through feedback, but it cannot correct for disturbances.',
        'n': 2}]


def test_a_one_word_question_needs_one_shared_word():
    assert caveats('gain', ITEMS) == [
        {'text': 'The gain must not be raised further unless the loop stays stable.', 'n': 3}]


def test_sentences_without_a_qualifier_are_never_caveats():
    # These words are all in the open-loop section's first sentence, which qualifies nothing.
    assert caveats('controller sends command measuring result', ITEMS[1:2]) == []
    assert caveats('Explain the Kalman filter', ITEMS) == []
    assert caveats('negative feedback', []) == []


def test_at_most_three_caveats_in_reading_order_with_the_strongest_kept():
    items = [{'n': n, 'id': f'notes:s{n}', 'text': f'Loop gain {word} changes stability here.'}
             for n, word in enumerate(['cannot', 'not', 'never', 'unless', 'but'], 1)]
    found = caveats('loop gain stability', items)
    assert [c['n'] for c in found] == [1, 3, 4]  # "not" and "but" are the weaker qualifiers


def test_the_offline_explanation_is_copied_from_the_context():
    explanation = verbatim('Does negative feedback guarantee stability?', ITEMS)
    assert explanation['kind'] == 'extractive' and 'Not a generated explanation' in explanation['label']
    assert {'text': 'Important exception: negative feedback does not guarantee stability.', 'n': 1} in explanation['sentences']
    assert all(any(s['text'] in item['text'] for item in ITEMS if item['n'] == s['n']) for s in explanation['sentences'])
    assert len(explanation['sentences']) <= 4
    assert verbatim('anything', []) is None

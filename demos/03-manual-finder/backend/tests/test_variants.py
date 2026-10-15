import pytest

from backend.variants import Registry, VariantError, applies, suggest, tag, validate_models

# The matching rules, tested on a fixed registry shaped like the sample
# library's (library/models.json may still change after a review).
MODELS = [
    {'id': 'rpi-2b', 'name': 'Raspberry Pi 2 Model B', 'short': '2B', 'family': 'rpi-2',
     'aliases': ['Raspberry Pi 2B', 'Pi 2B', '2B'],
     'revisions': [{'id': 'v1-1', 'label': 'v1.1'}, {'id': 'v1-2', 'label': 'v1.2', 'aliases': ['BCM2837']}]},
    {'id': 'rpi-3b', 'name': 'Raspberry Pi 3 Model B', 'short': '3B', 'family': 'rpi-3',
     'aliases': ['Raspberry Pi 3B', 'Pi 3B', '3B'],
     'revisions': [{'id': 'bcm2837', 'label': 'BCM2837 (original)', 'aliases': ['BCM2837']},
                   {'id': 'bcm2837b0', 'label': 'BCM2837B0 (metal lid)', 'aliases': ['BCM2837B0', 'metal lid']}]},
    {'id': 'rpi-3b-plus', 'name': 'Raspberry Pi 3 Model B+', 'short': '3B+', 'family': 'rpi-3',
     'aliases': ['Raspberry Pi 3B+', 'Pi 3B+', '3B+']},
    {'id': 'uno-r4-wifi', 'name': 'Arduino UNO R4 WiFi', 'short': 'R4 WiFi', 'aliases': ['UNO R4 WiFi']},
]
FAMILIES = [{'id': 'rpi-2', 'name': 'Raspberry Pi 2', 'aliases': ['Pi 2'], 'members': ['rpi-2b']},
            {'id': 'rpi-3', 'name': 'Raspberry Pi 3', 'aliases': ['Pi 3'], 'members': ['rpi-3b', 'rpi-3b-plus']}]
OUTSIDE = ['Raspberry Pi 1', 'Raspberry Pi 4', 'Raspberry Pi 5', 'Compute Module 3', 'Compute Module 3+']
REGISTRY = Registry.from_lists(MODELS, FAMILIES, OUTSIDE)
RPI = {'rpi-2b': None, 'rpi-3b': None, 'rpi-3b-plus': None}


def named(text, registry=REGISTRY, scope=None):
    return [(m.kind, m.models, m.revision) for m in registry.mentions(text, scope)]


def models_in(text, registry=REGISTRY):
    return [m for mention in registry.mentions(text) for m in mention.models]


@pytest.mark.parametrize('text', ['3B+', 'Raspberry Pi 3B+', 'Raspberry Pi 3 Model B+', '3 B+', '3-B+', '3B-plus',
                                  '3B plus', 'the 3b+'])
def test_every_spelling_of_the_3b_plus_is_the_3b_plus(text):
    assert models_in(text) == ['rpi-3b-plus']


@pytest.mark.parametrize('text', ['3B', 'the 3B boots', 'Raspberry Pi 3 Model B', '(3B)', 'the 3B.', '3 B'])
def test_the_3b_is_named_only_whole(text):
    assert models_in(text) == ['rpi-3b']


@pytest.mark.parametrize('text', ['13B', '3B2', 'X3B', 'a3B', '3Bx', 'Pi 33B'])
def test_a_name_never_matches_inside_another_token(text):
    assert models_in(text) == []


def test_3b_never_matches_inside_3b_plus():
    assert named('The 3B and the 3B+ differ') == [('model', ('rpi-3b',), None), ('model', ('rpi-3b-plus',), None)]
    assert named('3B+ boards') == [('model', ('rpi-3b-plus',), None)]


def test_the_longest_name_wins():
    registry = Registry.from_lists([{'id': 'nano-33-ble', 'name': 'Nano 33 BLE'},
                                    {'id': 'nano-33-ble-sense', 'name': 'Nano 33 BLE Sense'}])
    assert models_in('The Nano 33 BLE Sense has a microphone.', registry) == ['nano-33-ble-sense']
    assert models_in('The Nano 33 BLE has none.', registry) == ['nano-33-ble']
    assert models_in('Nano 33 BLE and Nano 33 BLE Sense', registry) == ['nano-33-ble', 'nano-33-ble-sense']
    # "Raspberry Pi 3 Model B+" is never read as the family "Raspberry Pi 3".
    assert named('Raspberry Pi 3 Model B+') == [('model', ('rpi-3b-plus',), None)]


def test_a_family_name_stands_for_its_members():
    assert named('Does my Pi 3 boot from USB?') == [('family', ('rpi-3b', 'rpi-3b-plus'), None)]
    assert named('pi3') == [('family', ('rpi-3b', 'rpi-3b-plus'), None)]
    resolved = REGISTRY.resolve('Does my Pi 3 boot from USB?')
    assert resolved['models'] == ['rpi-3b', 'rpi-3b-plus'] and resolved['family'] == 'rpi-3'
    assert resolved['named'] == []
    assert REGISTRY.resolve('Does my Pi 3B boot from USB?')['models'] == ['rpi-3b']


def test_an_enumeration_names_every_numbered_model():
    mentions = REGISTRY.mentions('This applies to Raspberry Pi 1, 2, 3, and 4')
    assert [(m.kind, m.models) for m in mentions] == [
        ('outside', ()), ('family', ('rpi-2b',)), ('family', ('rpi-3b', 'rpi-3b-plus')), ('outside', ())]
    assert [m.alias for m in mentions] == ['Raspberry Pi 1', 'Raspberry Pi 2', 'Raspberry Pi 3', 'Raspberry Pi 4']
    found = tag('The Raspberry Pi 1, 2, 3, and 4 have a red power LED', [], REGISTRY, RPI)
    assert found['models'] == ['rpi-2b', 'rpi-3b', 'rpi-3b-plus'] and found['source'] == 'text'
    # A number that is no name in the library ends the enumeration.
    assert models_in('Raspberry Pi 2, 7 and 3') == ['rpi-2b']
    # A decimal is not a model number.
    assert models_in('Raspberry Pi 2 and 3.3V logic') == ['rpi-2b']


def test_an_enumeration_may_end_a_sentence():
    assert models_in('The power LED is red on the Raspberry Pi 2 and 3.') == ['rpi-2b', 'rpi-3b', 'rpi-3b-plus']
    assert [m.alias for m in REGISTRY.mentions('It works on Raspberry Pi 1, 2, 3, and 4.')][-1] == 'Raspberry Pi 4'


@pytest.mark.parametrize('text', ['[pi3]', '[pi3+]', 'Add [pi3] to config.txt'])
def test_a_bracketed_literal_is_not_a_mention(text):
    assert REGISTRY.mentions(text) == []


def test_a_revision_counts_right_after_or_before_its_model():
    assert named('Raspberry Pi 2B v1.2') == [('model', ('rpi-2b',), None), ('revision', ('rpi-2b',), 'v1-2')]
    assert named('revision 1.2 of the 2B') == [('revision', ('rpi-2b',), 'v1-2'), ('model', ('rpi-2b',), None)]
    assert REGISTRY.resolve('Can the 2B v1.2 boot from USB?')['revisions'] == {'rpi-2b': 'v1-2'}
    assert REGISTRY.resolve('revision 1.2 of the 2B')['models'] == ['rpi-2b']


def test_a_revision_label_next_to_another_model_is_not_attached():
    # BCM2837B0 is a revision of the 3B; beside the 3B+ it names the 3B+'s chip.
    assert named('Raspberry Pi 3B+ (BCM2837B0)') == [('model', ('rpi-3b-plus',), None)]
    assert named('3B+ (BCM2837B0)') == [('model', ('rpi-3b-plus',), None)]
    assert named('the 3B (BCM2837B0)') == [('model', ('rpi-3b',), None), ('revision', ('rpi-3b',), 'bcm2837b0')]
    found = tag('The 3B+ (BCM2837B0) boots from USB.', [], REGISTRY, RPI)
    assert found['models'] == ['rpi-3b-plus'] and found['revisions'] == {}


def test_a_lone_revision_label_needs_exactly_one_owner_in_scope():
    assert named('Boards with the metal lid') == [('revision', ('rpi-3b',), 'bcm2837b0')]
    # "BCM2837" is a revision of both the 2B (v1.2) and the 3B (original): alone it is nobody's ...
    assert named('the BCM2837 chip') == []
    # ... unless only one of them is in scope.
    assert named('the BCM2837 chip', scope=['rpi-2b']) == [('revision', ('rpi-2b',), 'v1-2')]


def test_tag_reads_the_text_first():
    assert tag('The 3B+ boots from USB.', ['Raspberry Pi hardware', 'Raspberry Pi 3B'], REGISTRY, RPI) == {
        'models': ['rpi-3b-plus'], 'revisions': {}, 'outside': False, 'source': 'text'}
    assert tag('2B v1.2 and 3B boot from USB.', [], REGISTRY, RPI) == {
        'models': ['rpi-2b', 'rpi-3b'], 'revisions': {'rpi-2b': ['v1-2']}, 'outside': False, 'source': 'text'}
    # A model named both bare and with a revision applies to every revision.
    assert tag('The 2B v1.2 and the 2B both boot.', [], REGISTRY, RPI)['revisions'] == {}


def test_tag_falls_back_to_the_deepest_heading_then_the_document():
    headings = ['Raspberry Pi hardware', 'Raspberry Pi 2B', 'Raspberry Pi 3B+']
    assert tag('It boots from USB.', headings, REGISTRY, RPI) == {
        'models': ['rpi-3b-plus'], 'revisions': {}, 'outside': False, 'source': 'heading'}
    assert tag('It boots from USB.', ['Raspberry Pi hardware', 'Boot modes'], REGISTRY, RPI) == {
        'models': None, 'revisions': {}, 'outside': False, 'source': 'document'}
    # A document that covers only some revisions passes them on to its shared passages.
    assert tag('It boots.', [], REGISTRY, {'rpi-2b': ['v1-2'], 'rpi-3b': None})['revisions'] == {'rpi-2b': ['v1-2']}


def test_tag_marks_a_passage_about_other_products_only():
    assert tag('The Raspberry Pi 4 and 5 boot from USB.', [], REGISTRY, RPI) == {
        'models': [], 'revisions': {}, 'outside': True, 'source': 'text'}
    assert tag('It boots.', ['Raspberry Pi hardware', 'Raspberry Pi 4'], REGISTRY, RPI) == {
        'models': [], 'revisions': {}, 'outside': True, 'source': 'heading'}
    # A model the document does not cover counts as another product too.
    assert tag('The UNO R4 WiFi has an LED matrix.', [], REGISTRY, RPI)['outside'] is True
    # An outside name beside a library model does not hide the library model.
    assert tag('The Raspberry Pi 4 and 3B+ boot from USB.', [], REGISTRY, RPI)['models'] == ['rpi-3b-plus']


def test_applies_follows_models_and_revisions():
    shared = {'models': None, 'revisions': {}}
    assert applies(shared, ['rpi-2b', 'rpi-3b'], 'rpi-3b') and not applies(shared, ['rpi-2b', 'rpi-3b'], 'uno-r3')
    tagged = {'models': ['rpi-2b', 'rpi-3b'], 'revisions': {'rpi-2b': ['v1-2']}}
    every = ['rpi-2b', 'rpi-3b', 'rpi-3b-plus']
    assert applies(tagged, every, 'rpi-3b') and not applies(tagged, every, 'rpi-3b-plus')
    assert applies(tagged, every, 'rpi-2b') and applies(tagged, every, 'rpi-2b', 'v1-2')
    assert not applies(tagged, every, 'rpi-2b', 'v1-1')
    # A model with no revision list on the passage: every revision of it.
    assert applies(tagged, every, 'rpi-3b', 'bcm2837b0')
    # A manual that lists no models at all applies to every model.
    assert applies(shared, [], 'anything') and applies(shared, [], 'anything', 'v2')
    # An empty model list (other products only) applies to nothing.
    assert not applies({'models': [], 'revisions': {}}, ['rpi-2b'], 'rpi-2b')


def test_validate_models_fills_in_ids_and_short_names():
    models, families = validate_models(
        [{'name': '  Nano 33   BLE ', 'aliases': ['Nano BLE', 'Nano BLE'],
          'revisions': [{'label': 'Rev 2'}, {'label': 'v3', 'id': 'third', 'aliases': ['Rev 3']}]},
         {'name': 'Nano 33 BLE Sense', 'id': 'sense', 'short': 'Sense', 'family': 'nano'}],
        [{'name': 'Nano 33', 'members': ['nano-33-ble', 'sense', 'unknown', 7], 'aliases': ['Nano']}])
    assert models == [
        {'id': 'nano-33-ble', 'name': 'Nano 33 BLE', 'short': 'Nano 33 BLE', 'family': None, 'aliases': ['Nano BLE'],
         'revisions': [{'id': 'rev-2', 'label': 'Rev 2', 'aliases': []},
                       {'id': 'third', 'label': 'v3', 'aliases': ['Rev 3']}]},
        {'id': 'sense', 'name': 'Nano 33 BLE Sense', 'short': 'Sense', 'family': 'nano', 'aliases': [],
         'revisions': []}]
    assert families == [{'id': 'nano-33', 'name': 'Nano 33', 'members': ['nano-33-ble', 'sense'], 'aliases': ['Nano']}]
    assert validate_models([], None) == ([], [])


@pytest.mark.parametrize('models, families, message', [
    ('Nano', None, 'up to 60 models'),
    ([{'name': f'Board {n}'} for n in range(61)], None, 'up to 60 models'),
    (['Nano'], None, 'must be an object'),
    ([{'name': ''}], None, 'name must be text'),
    ([{'id': 'nano'}], None, 'name must be text'),
    ([{'name': 'x' * 81}], None, 'under 80 characters'),
    ([{'name': 'Nano', 'id': 'Not An ID'}], None, 'needs an ID'),
    ([{'name': 'Nano'}, {'name': 'nano'}], None, 'share the ID'),
    ([{'name': 'Nano', 'aliases': 'Nano 33'}], None, 'other names'),
    ([{'name': 'Nano', 'aliases': ['n'] * 25}], None, 'other names'),
    ([{'name': 'Nano', 'aliases': ['']}], None, 'must be text'),
    ([{'name': 'Nano', 'short': 'x' * 25}], None, 'under 24 characters'),
    ([{'name': 'Nano', 'revisions': [{'label': f'v{n}'} for n in range(13)]}], None, 'up to 12 revisions'),
    ([{'name': 'Nano', 'revisions': ['v1']}], None, 'must be an object'),
    ([{'name': 'Nano', 'revisions': [{'label': ''}]}], None, 'must be text'),
    ([{'name': 'Nano', 'revisions': [{'label': 'v1'}, {'label': 'V1'}]}], None, 'unique ID'),
    ([{'name': 'Nano', 'family': 'Nano Family'}], None, 'must be an ID'),
    ([{'name': 'Nano'}], 'Nano', 'up to 20 families'),
    ([{'name': 'Nano'}], ['Nano'], 'must be an object'),
    ([{'name': 'Nano'}], [{'name': ''}], 'must be text'),
    ([{'name': 'Nano'}], [{'name': 'Nano', 'id': 'NANO'}], 'needs an ID'),
    ([{'name': 'Nano'}], [{'name': 'Nano', 'aliases': 'Nano'}], 'other names'),
])
def test_validate_models_rejects_invalid_lists(models, families, message):
    with pytest.raises(VariantError, match=message):
        validate_models(models, families)


def test_a_menu_path_is_not_suggested_as_a_model_name():
    # From the Help Center's "Reset your board": the menu path must not become "File Examples 01".
    text = ('In the menu bar, select File > Examples > 01.Basics > Blink. Then upload it to the Nano 33 BLE. '
            'Select File > Examples > 01.Basics > BareMinimum to open it. The Nano 33 BLE then resets.')
    assert [s['name'] for s in suggest([text])] == ['Nano 33 BLE']

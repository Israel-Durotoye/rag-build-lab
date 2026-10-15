from rag_core.web.extraction import Block, extract

from backend.sectioning import UNIT_MAX_WORDS, block_units, build_sections, split_long
from backend.variants import Registry
from conftest import MANUAL

REGISTRY = Registry.from_lists([{'id': 'box-7', 'name': 'Demo Box 7', 'aliases': ['B7']},
                                {'id': 'box-7-pro', 'name': 'Demo Box 7 Pro'}])


def names_differ(items):
    named = [frozenset(m for mention in REGISTRY.mentions(item) for m in mention.models) for item in items]
    return len({n for n in named if n}) > 1


def sections_of(text, differ=lambda items: False, name='Synthetic test manual.md'):
    result = next(e['result'] for e in extract(text.encode(), name, None) if e['type'] == 'extracted')
    sections, truncated = build_sections(result.blocks, result.name, differ)
    assert not truncated
    return {s.id: s for s in sections}


def test_a_markdown_manual_becomes_sections_of_units():
    sections = sections_of(MANUAL)
    assert list(sections) == ['synthetic-test-manual', 'error-codes', 'status-lights', 'cleaning']
    assert sections['error-codes'].path == ['Synthetic test manual', 'Error codes']
    assert sections['synthetic-test-manual'].path == ['Synthetic test manual']
    unit = sections['synthetic-test-manual'].units[0]
    assert (unit.id, unit.kind, unit.section_id) == ('synthetic-test-manual-u01', 'paragraph', 'synthetic-test-manual')
    assert unit.text.startswith('This synthetic manual covers') and unit.location == '¶ 2'


def test_each_table_row_is_a_unit_that_carries_the_header():
    rows = sections_of(MANUAL)['error-codes'].units
    assert [(u.id, u.kind, u.header) for u in rows] == [('error-codes-u01', 'row', 'Code | Meaning'),
                                                        ('error-codes-u02', 'row', 'Code | Meaning')]
    assert rows[0].text == 'Code | Meaning\nE17 | Demo Box 7 (B7): the fan has stalled.'
    assert rows[1].text == 'Code | Meaning\nE18 | Demo Box 7 Pro: the lid sensor is open.'


def test_a_list_splits_only_when_its_items_name_different_models():
    together = sections_of(MANUAL)['status-lights'].units
    assert [u.kind for u in together] == ['list'] and together[0].text.count('\n') == 1
    apart = sections_of(MANUAL, names_differ)['status-lights'].units
    assert [(u.kind, u.text) for u in apart] == [
        ('item', '- Demo Box 7: the green light blinks while it starts.'),
        ('item', '- Demo Box 7 Pro: the blue light blinks while it starts.')]
    # Items that name the same model, or none, stay one list.
    assert block_units('- Demo Box 7 starts.\n- B7 stops.', names_differ) == [
        ('list', '- Demo Box 7 starts.\n- B7 stops.', None)]
    assert block_units('- Wipe the case.\n- Keep the vents clear.', names_differ)[0][0] == 'list'


def test_notes_are_recognised():
    units = sections_of(MANUAL)['cleaning'].units
    assert (units[0].kind, units[0].text) == ('note', 'Warning: unplug the box before cleaning it.')
    for text in ('Note: the fan is quiet.', 'CAUTION hot surface.', 'Important. Read this first.',
                 'Tip: keep the vents clear.'):
        assert block_units(text, lambda items: False)[0][0] == 'note', text
    assert block_units('Notebooks are not covered here.', lambda items: False)[0][0] == 'paragraph'


def test_long_paragraphs_are_split_at_sentence_ends():
    units = [u for u in sections_of(MANUAL)['cleaning'].units if u.kind == 'paragraph']
    assert [u.words for u in units] == [120, 120, 60]
    assert all(u.text.startswith('Step ') and u.text.endswith('casing.') for u in units)
    assert ' '.join(u.text for u in units).split() == MANUAL.split('Warning: unplug the box before cleaning it.')[
        1].split()  # nothing lost or changed
    assert [u.id for u in units] == ['cleaning-u02', 'cleaning-u03', 'cleaning-u04']


def test_split_long_breaks_an_overlong_sentence_at_words():
    text = 'Short one. ' + ' '.join(['Word'] * (UNIT_MAX_WORDS + 30)) + '. Last one.'
    pieces = split_long(text)
    # The rest of the overlong sentence and the next one fit together.
    assert [len(p.split()) for p in pieces] == [2, UNIT_MAX_WORDS, 32]
    assert ' '.join(pieces).split() == text.split()
    assert split_long('Fits.') == ['Fits.']


def test_small_fragments_are_joined_and_pages_kept():
    blocks = [Block('Fault codes', page=1, heading=True), Block('E17 means', page=1, heading=False),
              Block('the fan stopped.', page=2, heading=False),
              Block('Check the fan before you restart the device and wait for it to cool down.', page=2, heading=False)]
    sections, truncated = build_sections(blocks, 'Scanned manual')
    assert not truncated and [s.id for s in sections] == ['fault-codes']
    units = sections[0].units
    assert [(u.text, u.location, u.pages) for u in units] == [
        ('E17 means the fan stopped.', 'p. 1–2', [1, 2]),
        ('Check the fan before you restart the device and wait for it to cool down.', 'p. 2', [2, 2])]


def test_text_before_any_heading_is_a_section_named_after_the_manual():
    sections, _ = build_sections([Block('This paragraph comes before any heading in the manual.', para=1)],
                                 'Loose notes')
    assert [(s.id, s.title, s.path) for s in sections] == [('loose-notes', 'Loose notes', ['Loose notes'])]

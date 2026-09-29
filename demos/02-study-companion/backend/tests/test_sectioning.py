from rag_core.web.extraction import Block

from backend.sectioning import SECTION_MAX_WORDS, build_sections


def words(n, word='alpha'):
    return ' '.join([word] * n) + '.'


def test_each_heading_becomes_a_section_with_its_text_and_location():
    blocks = [Block('Feedback', page=1, heading=True), Block('Feedback subtracts the output.', page=1),
              Block('It shrinks the error.', page=2),
              Block('Stability', page=2, heading=True), Block('A stable system settles.', page=3)]
    sections, truncated = build_sections(blocks, 'Controls')
    assert not truncated
    assert [(s.id, s.title, s.location, s.pages) for s in sections] == [
        ('s001', 'Feedback', 'p. 1–2', [1, 2]), ('s002', 'Stability', 'p. 3', [3, 3])]
    assert sections[0].text == 'Feedback subtracts the output.\n\nIt shrinks the error.'
    assert sections[0].words == 8 and sections[0].parts == 1


def test_text_before_any_heading_takes_the_document_title():
    sections, _ = build_sections([Block('These notes cover control.', para=1),
                                  Block('Gain', para=2, heading=True), Block('Gain scales the error.', para=3)],
                                 'Week 3')
    assert [(s.title, s.location) for s in sections] == [('Week 3', '¶ 1'), ('Gain', '¶ 3')]


def test_a_chapter_heading_directly_above_a_section_heading_names_it_too():
    sections, _ = build_sections([Block('Chapter 2', heading=True, para=1), Block('Negative feedback', heading=True, para=2),
                                  Block('The controller acts on the error.', para=3),
                                  Block('Trailing heading', heading=True, para=4)], 'Notes')
    assert [s.title for s in sections] == ['Chapter 2 · Negative feedback']  # a heading with nothing under it is dropped


def test_a_long_heading_is_split_into_parts_at_paragraph_boundaries():
    blocks = [Block('Integral action', heading=True, page=1)] + [Block(words(90, f'w{i}'), page=1 + i) for i in range(5)]
    sections, _ = build_sections(blocks, 'Notes')
    assert [s.title for s in sections] == [f'Integral action (part {n} of 3)' for n in (1, 2, 3)]
    assert [s.words for s in sections] == [180, 180, 90]
    assert all(s.words <= SECTION_MAX_WORDS and s.heading == 'Integral action' for s in sections)
    assert [s.location for s in sections] == ['p. 1–2', 'p. 3–4', 'p. 5']
    assert 'w0' in sections[0].text and 'w2' not in sections[0].text  # no paragraph is cut in two


def test_a_small_last_part_rejoins_the_part_before_it():
    blocks = [Block('Windup', heading=True)] + [Block(words(200)), Block(words(30))]
    sections, _ = build_sections(blocks, 'Notes')
    assert [s.words for s in sections] == [230] and sections[0].title == 'Windup'


def test_one_paragraph_longer_than_a_section_is_cut_at_sentences():
    paragraph = ' '.join(words(50, f's{i}') for i in range(10))  # ten 50-word sentences
    sections, _ = build_sections([Block(paragraph, para=1)], 'Notes')
    assert len(sections) == 3 and all(s.words <= SECTION_MAX_WORDS for s in sections)
    assert sum(s.words for s in sections) == 500
    assert all(s.text.endswith('.') for s in sections)


def test_headings_are_detected_from_the_text_when_not_marked():
    sections, _ = build_sections([Block('2.1 Open-loop control'), Block('A toaster heats for a fixed time.')], 'Notes')
    assert [(s.title, s.text) for s in sections] == [('2.1 Open-loop control', 'A toaster heats for a fixed time.')]

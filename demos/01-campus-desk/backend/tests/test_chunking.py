from backend import chunking
from backend.chunking import chunk_blocks
from backend.extraction import Block


def paragraph(n, words=40):
    return ' '.join(f'word{n}x{i}' for i in range(words)) + '.'


def test_chunks_respect_size_bounds_and_cite_their_pages():
    blocks = [Block(paragraph(i), page=1 + i // 4) for i in range(24)]
    chunks, truncated = chunk_blocks(blocks, 'Handbook')
    assert not truncated and len(chunks) > 3
    assert all(c.chars <= chunking.MAXIMUM for c in chunks)
    assert all(c.chars >= chunking.MINIMUM for c in chunks[:-1])
    assert chunks[0].location.startswith('p. 1') and chunks[-1].location.endswith('6')
    assert [c.id for c in chunks] == [f'c{i:03d}' for i in range(1, len(chunks) + 1)]


def test_headings_start_chunks_and_become_titles():
    blocks = [Block('1.1 Introduction', page=1), Block(paragraph(1, 60), page=1),
              Block('1.2 Philosophy', page=2), Block(paragraph(2, 60), page=2)]
    chunks, _ = chunk_blocks(blocks, 'Handbook')
    assert [c.title for c in chunks] == ['1.1 Introduction', '1.2 Philosophy']
    assert chunks[1].text.startswith('1.2 Philosophy') and chunks[1].location == 'p. 2'


def test_untitled_opening_text_takes_the_document_title():
    chunks, _ = chunk_blocks([Block(paragraph(1, 60), page=1)], 'Staff Manual')
    assert chunks[0].title == 'Staff Manual'


def test_short_sections_share_a_chunk_with_joined_titles():
    blocks = [Block('1.3 Vision', page=7), Block('To be a world-class department.', page=7),
              Block('1.4 Mission', page=7), Block(paragraph(4, 60), page=7)]
    chunks, _ = chunk_blocks(blocks, 'Handbook')
    assert len(chunks) == 1 and chunks[0].title == '1.3 Vision · 1.4 Mission'


def test_short_final_paragraph_overlaps_into_the_next_chunk():
    bridge = 'The fee is paid at the bursary before registration closes.'
    blocks = [Block(paragraph(1, 80), page=1), Block(bridge, page=1), Block(paragraph(2, 80), page=2)]
    chunks, _ = chunk_blocks(blocks, 'Handbook')
    assert bridge in chunks[0].text and chunks[1].text.startswith(bridge)
    # The overlap does not claim its page for the next chunk's citation.
    assert chunks[1].location == 'p. 2'


def test_a_new_heading_never_starts_with_the_previous_overlap():
    blocks = [Block(paragraph(1, 150), page=1), Block('Short closing line.', page=1),
              Block('2.0 Next Section', page=2), Block(paragraph(2, 60), page=2)]
    chunks, _ = chunk_blocks(blocks, 'Handbook')
    assert chunks[-1].text.startswith('2.0 Next Section') and chunks[-1].title == '2.0 Next Section'
    # The short tail rejoins its own section's chunk instead.
    assert chunks[-2].text.endswith('Short closing line.') and chunks[-2].location == 'p. 1'


def test_oversized_paragraphs_are_split_at_sentences():
    long = ' '.join(f'Sentence number {i} explains a rule in some detail.' for i in range(80))
    chunks, _ = chunk_blocks([Block(long, page=3)], 'Handbook')
    assert len(chunks) >= 3 and all(c.chars <= chunking.MAXIMUM for c in chunks)
    assert all(c.text.rstrip().endswith('.') for c in chunks[:-1])


def test_word_paragraph_citations_and_ocr_flags():
    blocks = [Block('Leave policy', para=1, heading=True), Block(paragraph(1, 60), para=2),
              Block('Text in images (OCR)', para=3, heading=True, ocr=True), Block(paragraph(3, 60), para=3, ocr=True)]
    chunks, _ = chunk_blocks(blocks, 'Manual')
    assert [c.location for c in chunks] == ['¶ 1–2', '¶ 3']
    assert [c.ocr for c in chunks] == [False, True]


def test_chunk_limit_truncates_with_a_flag(monkeypatch):
    monkeypatch.setitem(chunking.LIMITS, 'chunks_per_document', 2)
    chunks, truncated = chunk_blocks([Block(paragraph(i, 200), page=i) for i in range(6)], 'Big')
    assert len(chunks) == 2 and truncated


def test_opening_text_takes_the_first_heading_and_joined_titles_stay_short():
    blocks = [Block('A short cover line.', page=1), Block('FEDERAL UNIVERSITY OF TECHNOLOGY', page=1),
              Block('A second short line.', page=1), Block('DEPARTMENT OF MECHATRONICS ENGINEERING', page=1),
              Block('STUDENTS HANDBOOK OF RULES AND REGULATIONS', page=1), Block(paragraph(1, 60), page=1)]
    chunks, _ = chunk_blocks(blocks, 'DOME_100_300HB-1')
    assert not chunks[0].title.startswith('DOME_100_300HB-1')
    assert chunks[0].title.startswith('FEDERAL UNIVERSITY OF TECHNOLOGY') and len(chunks[0].title) <= 90

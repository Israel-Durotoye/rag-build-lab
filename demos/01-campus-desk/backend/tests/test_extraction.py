"""Extraction runs the real libraries: PyMuPDF, python-docx and RapidOCR."""
import pymupdf
import pytest

from backend.extraction import OCR_MARKER, ExtractionError, extract
from backend.ocr import get_engine
from conftest import pdf_bytes


def run(data, filename, ocr='default'):
    events = list(extract(data, filename, get_engine() if ocr == 'default' else ocr))
    assert events[-1]['type'] == 'extracted'
    return events[:-1], events[-1]['result']


def test_text_layer_pdf_gives_page_blocks_without_page_numbers():
    data = pdf_bytes([(['STUDENT HANDBOOK', '', 'Students register for courses each semester.'], None, False),
                      (['2.7 Grading System', '', 'The university operates a 5.0 grading scale.'], None, False)])
    progress, result = run(data, 'handbook.pdf', ocr=None)
    stages = [e['stage'] for e in progress]
    assert stages[0] == 'reading' and 'ocr' not in stages
    assert (result.format, result.page_count, result.ocr_pages, result.ocr_failed) == ('pdf', 2, 0, False)
    assert [p['method'] for p in result.pages] == ['text', 'text']
    texts = [b.text for b in result.blocks]
    assert 'STUDENT HANDBOOK' in texts and '2.7 Grading System' in texts
    assert not any(text.strip() in {'1', '2'} for text in texts), 'running page numbers are dropped'
    assert {b.page for b in result.blocks} == {1, 2}


def test_scanned_page_is_read_with_ocr():
    data = pdf_bytes([(['Hostel Rules', 'Lights out is at 11:00 pm every night.',
                        'Visitors must sign the register at the gate.'], None, True)])
    assert pymupdf.open(stream=data, filetype='pdf')[0].get_text().strip() == ''
    progress, result = run(data, 'scan.pdf')
    assert any(e['stage'] == 'ocr' for e in progress)
    assert result.ocr_pages == 1 and result.pages[0]['method'] == 'ocr'
    text = '\n'.join(b.text for b in result.blocks)
    assert 'Lights out is at 11:00 pm' in text and all(b.ocr for b in result.blocks)


def test_text_inside_images_on_a_text_page_is_added_once():
    data = pdf_bytes([(['Opening hours', '', 'The library opens at 08:00 on weekdays.'],
                       ['Workshop Room 204 closes at 18:00', 'Opening hours', 'Bring your student card',
                        'Safety boots are required'], False)])
    _, result = run(data, 'mixed.pdf')
    ocr_blocks = [b for b in result.blocks if b.ocr]
    assert result.image_regions == 1 and result.pages[0]['method'] == 'text+ocr'
    assert len(ocr_blocks) == 1 and ocr_blocks[0].text.startswith(OCR_MARKER)
    assert 'Room 204 closes at 18:00' in ocr_blocks[0].text
    # Lines the text layer already has are not duplicated from the image.
    assert 'Opening hours' not in ocr_blocks[0].text


def test_scan_without_ocr_engine_fails_clearly():
    data = pdf_bytes([(['Only an image here'], None, True)])
    with pytest.raises(ExtractionError, match='OCR could not run'):
        list(extract(data, 'scan.pdf', None))


def test_bad_inputs_have_plain_messages():
    with pytest.raises(ExtractionError, match='could not be opened'):
        list(extract(b'%PDF-1.7 not really', 'broken.pdf', None))
    with pytest.raises(ExtractionError, match='Legacy .doc'):
        list(extract(b'x', 'old.doc', None))
    with pytest.raises(ExtractionError, match='PDF'):
        list(extract(b'x', 'photo.png', None))
    with pytest.raises(ExtractionError, match='empty'):
        list(extract(b'', 'notes.txt', None))
    locked = pymupdf.open()
    locked.new_page().insert_text((72, 72), 'secret')
    data = locked.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw='pw', owner_pw='pw')
    with pytest.raises(ExtractionError, match='password'):
        list(extract(data, 'locked.pdf', None))


def test_word_headings_tables_and_pictures(docx_bytes):
    progress, result = run(docx_bytes(picture_lines=['Fire assembly point: front lawn']), 'Staff Manual.docx')
    assert result.format == 'word' and result.image_regions == 1
    assert any(e['stage'] == 'ocr' for e in progress)
    headings = [b.text for b in result.blocks if b.heading]
    assert headings[:2] == ['Leave policy', 'Laboratory safety'] and headings[-1] == 'Text in images (OCR)'
    assert any(b.text == 'Workshop | 17:30' for b in result.blocks)
    assert 'front lawn' in result.blocks[-1].text and result.blocks[-1].ocr
    assert all(b.para for b in result.blocks)


def test_plain_text_and_markdown_headings():
    _, result = run('# Rules\nNo food in the lab.\n\n# Hours\nOpen until 20:00.'.encode(), 'rules.md', ocr=None)
    assert [(b.text, b.heading) for b in result.blocks] == [
        ('Rules', True), ('No food in the lab.', None), ('Hours', True), ('Open until 20:00.', None)]


def test_symbol_font_bullets_are_normalised():
    _, result = run(' LABORATORY 16: CAD CAM'.encode(), 'labs.txt', ocr=None)
    assert result.blocks[0].text.startswith('•')

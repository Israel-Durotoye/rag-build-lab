import pytest

from backend.identifiers import did_you_mean, edit_distance, find, heading_codes, row_codes


def codes(text, **options):
    return [(c.code, c.display, c.scheme) for c in find(text, **options)]


@pytest.mark.parametrize('text, code, display', [
    ('4 long, 4 short', 'FLASH:L4S4', '4 long · 4 short'),
    ('four long flashes followed by four short', 'FLASH:L4S4', '4 long · 4 short'),
    ('The LED blinks 7 long and 2 short', 'FLASH:L7S2', '7 long · 2 short'),
    ('twelve long, one short', 'FLASH:L12S1', '12 long · 1 short'),
])
def test_flash_patterns_are_read_in_digits_or_words(text, code, display):
    assert codes(text) == [(code, display, 'flash')]


@pytest.mark.parametrize('text', ['GPIO 22', 'gpio22', 'gpio-22', 'GPIO_22', 'GPIO022'])
def test_every_spelling_of_a_gpio_is_one_code(text):
    assert [c[0] for c in codes(text)] == ['GPIO22'] and codes(text)[0][2] == 'gpio'


def test_the_unmistakable_schemes():
    assert codes('revision 0x2763') == [('0x2763', '0x2763', 'hex')]
    assert codes('0x1a') == [('0x1A', '0x1A', 'hex')]
    assert codes('Failed uploading: exit status 74') == [('EXIT STATUS 74', 'exit status 74', 'exit')]
    assert codes('Use the [pi3+] filter') == [('[PI3+]', '[pi3+]', 'filter')]
    assert codes('[ALL]') == [('[ALL]', '[all]', 'filter')]


@pytest.mark.parametrize('text, code, display', [
    ('P102', 'P102', 'P102'), ('a020d3', 'A020D3', 'a020d3'), ('E17', 'E17', 'E17'), ('e-17', 'E17', 'e-17'),
    ('P-102', 'P102', 'P-102'), ('ATmega328P', 'ATMEGA328P', 'ATmega328P'),
])
def test_letters_and_digits_together_are_tokens(text, code, display):
    assert codes(text) == [(code, display, 'token')]


def test_find_reports_spans_and_raw_text():
    found = find('Is gpio-22 the same as P102?')
    assert [(c.code, c.raw, c.start, c.end) for c in found] == [('GPIO22', 'gpio-22', 3, 10), ('P102', 'P102', 23, 27)]


@pytest.mark.parametrize('text', ['5V', '2.5A', '3.3V', '1GB', '1 GB', '500mA', '1.4GHz', '48 MHz', '60°C', '7-12V',
                                  '12x8', '1920x1080', '40 pins', 'v1.2', 'USB-C'])
def test_measurements_and_sizes_are_not_codes(text):
    assert codes(text) == []


def test_a_prefix_and_number_written_apart_count_only_when_known():
    assert codes('What does E 17 mean?') == []
    assert codes('What does E 17 mean?', known={'E17'}) == [('E17', 'E 17', 'token')]
    assert codes('What does E 17 mean?', known={'E18'}) == []


def test_skipped_spans_and_unmistakable_only():
    assert codes('The UNO R4 has P102', skip=[(4, 10)]) == [('P102', 'P102', 'token')]
    assert codes('RA4M1 port P102 or GPIO 22', tokens=False) == [('GPIO22', 'GPIO 22', 'gpio')]


def test_row_codes_read_a_flash_pattern_from_long_and_short_columns():
    found = row_codes('4 | 4 | Undervoltage detected', 'Long flashes | Short flashes | Status')
    assert [(c.code, c.display, c.scheme) for c in found] == [('FLASH:L4S4', '4 long · 4 short', 'flash')]


def test_row_codes_read_a_gpio_under_a_bank_column_only_in_a_gpio_section():
    header = 'Bank 1 | Bank 2 | boot type'
    found = row_codes('22 | 39 | SD0', header, context=['Raspberry Pi hardware', 'GPIO boot mode'])
    assert [(c.code, c.display) for c in found] == [('GPIO22', 'GPIO 22'), ('GPIO39', 'GPIO 39'), ('SD0', 'SD0')]
    assert [c.code for c in row_codes('22 | 39 | SD0', header, context=['Power supply'])] == ['SD0']
    # A column named GPIO is enough anywhere.
    assert [c.code for c in row_codes('17 | Fan', 'GPIO | Use')] == ['GPIO17']


def test_row_codes_find_a_code_in_any_cell():
    found = row_codes('D13 | P102 | GTIOC2B', 'Pin | RA4M1 | Timer')
    assert [c.code for c in found] == ['D13', 'P102', 'GTIOC2B']


def test_row_codes_skip_model_names():
    header = 'Model | Code | Meaning'
    assert [c.code for c in row_codes('TD1 | E17 | Fan stalled', header)] == ['TD1', 'E17']
    assert [c.code for c in row_codes('TD1 | E17 | Fan stalled', header, skip_names=['TD1'])] == ['E17']


def test_heading_codes():
    assert [c.code for c in heading_codes('Error E17: fan stalled')] == ['E17']
    assert heading_codes('Raspberry Pi R3 board', skip_names=['R3']) == []


def test_edit_distance_counts_a_swap_once():
    assert edit_distance('E17', 'E71') == 1
    assert edit_distance('P102', 'P120') == 1
    assert edit_distance('ab', 'ba') == 1
    assert edit_distance('abc', 'abc') == 0
    assert edit_distance('', 'ab') == 2
    assert edit_distance('kitten', 'sitting') == 3


def test_did_you_mean_offers_codes_one_edit_or_swap_away_in_the_same_scheme():
    candidates = {'P102': ('P102', 'token'), 'P104': ('P104', 'token'), 'P120': ('P120', 'token'),
                  'D13': ('D13', 'token'), 'GPIO12': ('GPIO 12', 'gpio')}
    assert did_you_mean('P120', 'token', candidates) == [{'code': 'P102', 'display': 'P102'}]
    assert did_you_mean('E71', 'token', {'E17': ('E17', 'token'), 'X99': ('X99', 'token')}) == [
        {'code': 'E17', 'display': 'E17'}]
    # Another scheme never counts, however close.
    assert did_you_mean('GPIO21', 'gpio', {'GPIO22': ('GPIO 22', 'gpio'), 'P21': ('P21', 'token')}) == [
        {'code': 'GPIO22', 'display': 'GPIO 22'}]
    assert did_you_mean('P121', 'token', {'P102': ('P102', 'token')}) == []
    # Longer codes may be two edits away; at most three, closest first.
    near = did_you_mean('A020D3', 'token', {'A020D2': ('a020d2', 'token'), 'A0D3': ('a0d3', 'token'),
                                            'A02D03': ('a02d03', 'token'), 'A020E3': ('a020e3', 'token')})
    assert [n['code'] for n in near] == ['A020D2', 'A020E3', 'A02D03']

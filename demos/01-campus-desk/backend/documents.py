"""Shared document rules: limits, IDs, heading detection and validation of
pre-sectioned documents (such as the fixture ``corpus.json``)."""
from __future__ import annotations

import re
import unicodedata

LIMITS = {
    'file_bytes': 40 * 1024 * 1024,
    'documents_per_workspace': 5,
    'chunks_per_document': 1200,
    'characters_per_document': 2_000_000,
    'sections': 1200,
    'title': 200,
    'location': 120,
    'section_text': 8000,
}
DOCUMENT_FIELDS = {'id', 'title', 'version', 'metadata', 'sections'}
SECTION_FIELDS = {'id', 'title', 'text', 'location'}
ID_PATTERN = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')

# Numbered clauses ("2.7 Grading System"), chapters, course codes ("ELE 314:").
HEADING_SHAPE = re.compile(r'^(#{1,6}\s+\S|\d+(\.\d+)*\.?\s+[A-Z]|CHAPTER\b|SECTION\b|PART\b|[A-Z]{2,4}\s?\d{3}\b)')
DANGLING = {'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with'}


class DocumentError(ValueError):
    """A plain, user-facing validation message."""


def slugify(value: str) -> str:
    ascii_text = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', ascii_text.lower()).strip('-')[:48]


def clean_line(text: str) -> str:
    return ' '.join(text.split())


def is_heading(text: str) -> bool:
    """Short single lines shaped like headings: markdown hashes, numbered
    clauses, chapters, course codes, or ALL-CAPS phrases."""
    lines = [line for line in text.strip().split('\n') if line.strip()]
    if not lines or len(lines) > 2:
        return False
    line = clean_line(' '.join(lines))
    words = line.split()
    if not 3 <= len(line) <= 100 or line.endswith(('.', ',', ';', ':')) or '....' in line:
        return False
    if words[-1].lower() in DANGLING:
        return False
    if HEADING_SHAPE.match(line):
        return True
    letters = re.sub(r'[^A-Za-z]', '', line)
    return len(letters) >= 4 and letters.isupper() and len(words) <= 12


def _string(value, field, limit, fallback=None):
    if value is None and fallback is not None:
        return fallback
    if not isinstance(value, str):
        raise DocumentError(f'{field} must be text.')
    text = value.strip()
    if not text:
        if fallback is not None:
            return fallback
        raise DocumentError(f'{field} must not be empty.')
    if len(text) > limit:
        raise DocumentError(f'{field} must stay under {limit} characters.')
    return text


def validate_documents(value) -> list[dict]:
    """Validate pre-sectioned documents, or raise DocumentError."""
    if not isinstance(value, list) or not value:
        raise DocumentError('Provide at least one document.')
    documents, document_ids = [], set()
    for item in value:
        if not isinstance(item, dict):
            raise DocumentError('Each document must be an object.')
        unknown = sorted(set(item) - DOCUMENT_FIELDS)
        if unknown:
            raise DocumentError(f'Unsupported document field “{unknown[0]}”.')
        doc_id = _string(item.get('id'), 'Document ID', 64).lower()
        if not ID_PATTERN.match(doc_id):
            raise DocumentError('Document IDs may only use lowercase letters, numbers and hyphens.')
        if doc_id in document_ids:
            raise DocumentError(f'Duplicate document ID “{doc_id}”.')
        document_ids.add(doc_id)
        metadata = item.get('metadata', {})
        if not isinstance(metadata, dict):
            raise DocumentError('Document metadata must be an object.')
        # The public index never accepts tenant-scoped documents.
        if metadata.get('tenant') is not None:
            raise DocumentError('Tenant documents are not supported in Campus Guide.')
        sections = item.get('sections')
        if not isinstance(sections, list) or not sections:
            raise DocumentError('Each document needs at least one section.')
        if len(sections) > LIMITS['sections']:
            raise DocumentError(f"A document may hold at most {LIMITS['sections']} sections.")
        section_ids, clean = set(), []
        for index, entry in enumerate(sections, 1):
            if not isinstance(entry, dict):
                raise DocumentError(f'Section {index} must be an object.')
            unknown = sorted(set(entry) - SECTION_FIELDS)
            if unknown:
                raise DocumentError(f'Unsupported section field “{unknown[0]}”.')
            section_id = _string(entry.get('id'), f'Section {index} ID', 64).lower()
            if not ID_PATTERN.match(section_id):
                raise DocumentError('Section IDs may only use lowercase letters, numbers and hyphens.')
            if section_id in section_ids:
                raise DocumentError(f'Duplicate section ID “{section_id}”.')
            section_ids.add(section_id)
            title = _string(entry.get('title'), f'Section {index} title', LIMITS['title'])
            clean.append({
                'id': section_id,
                'title': title,
                'text': _string(entry.get('text'), f'Section “{title}” text', LIMITS['section_text']),
                'location': _string(entry.get('location'), f'Section “{title}” location', LIMITS['location'], section_id),
            })
        documents.append({
            'id': doc_id,
            'title': _string(item.get('title'), 'Document title', LIMITS['title']),
            'version': _string(item.get('version'), 'Document version', 40, '1'),
            'metadata': dict(metadata),
            'sections': clean,
        })
    return documents

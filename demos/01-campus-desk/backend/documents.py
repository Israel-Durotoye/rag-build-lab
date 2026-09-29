"""Shared document rules, now in ``rag_core.web.documents`` so every web demo
uses one copy."""
from rag_core.web.documents import (DANGLING, DOCUMENT_FIELDS, HEADING_SHAPE, ID_PATTERN, LIMITS,  # noqa: F401
                                    SECTION_FIELDS, DocumentError, clean_line, is_heading, slugify,
                                    validate_documents)

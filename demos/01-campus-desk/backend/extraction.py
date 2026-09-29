"""Reading PDF, Word and text files, now in ``rag_core.web.extraction`` so
every web demo uses one copy."""
from rag_core.web.extraction import (IMAGE_COVERAGE, MIN_IMAGE_SHARE, OCR_DPI, OCR_LIMIT, OCR_MARKER,  # noqa: F401
                                     OCR_MAX_SIDE_PX, SUPPORTED, TEXT_LAYER_THRESHOLD, Block, Extracted,
                                     ExtractionError, document_name, extract, file_format)

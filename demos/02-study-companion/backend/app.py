"""Study Companion API (FastAPI).

Run from demos/02-study-companion:
    .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001

Every route except /api/status needs an ``X-Workspace-Id`` header: 32 hex
characters the browser generates once and keeps.

    GET    /api/status                   capabilities
    GET    /api/documents                notes in the workspace
    POST   /api/documents                upload (multipart) -> NDJSON progress -> document
    GET    /api/documents/{id}           one set of notes: its sections and how it was chunked
    DELETE /api/documents/{id}
    POST   /api/documents/{id}/overview  model-written summary, key terms, questions
    GET    /api/sample                   the bundled sample notes and their question set
    POST   /api/sample                   add the sample notes to the workspace
    GET    /api/settings                 the student's settings
    PUT    /api/settings                 change them (a new chunk size re-indexes the notes)
    POST   /api/ask                      one question -> NDJSON pipeline events
    POST   /api/compare                  the same question against both chunkings (no model)
    GET    /api/practice                 saved quizzes and flashcards
    POST   /api/practice                 write a new set -> NDJSON progress -> set
    GET    /api/practice/{id}
    DELETE /api/practice/{id}
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, FastAPI, File, Header, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from rag_core.providers import ProviderError
from rag_core.web.documents import LIMITS, DocumentError
from rag_core.web.embeddings import get_embedder, status as embedding_status
from rag_core.web.extraction import ExtractionError, file_format
from rag_core.web.http import failure, ndjson as stream_ndjson, read_json
from rag_core.web.ocr import get_engine
from rag_core.web.retrieval import MODES

from . import practice as practice_layer
from .compare import compare
from .ingest import ingest, ingest_sections, sample_documents, sample_info
from .overview import document_overview
from .preferences import DEFAULTS, LEVELS, RANGES, PreferencesError, options, preferences, validate
from .prompting import system_prompt
from .sectioning import SECTION_MAX_WORDS
from .settings import Settings, load_env_file
from .store import CHUNKINGS, DOCUMENT_ID, DocumentStore, Workspace, WorkspaceError, summary
from .turn import run_turn

log = logging.getLogger('study_companion')
API_VERSION = 1
API_VERSION_HEADER = 'X-Study-API-Version'
MAX_MESSAGE_CHARS = 4000
MAX_EARLIER_QUESTIONS = 12
UNSET = object()


@dataclass
class Services:
    settings: Settings
    store: DocumentStore
    model: object | None
    embedder: Callable[[], object | None]
    ocr: Callable[[], object | None]


def ndjson(work: Callable[[Callable[[dict], None], Callable[[], bool]], None]):
    return stream_ndjson(work, log=log, expected=(ExtractionError, DocumentError, WorkspaceError,
                                                  practice_layer.PracticeError))


def create_app(settings: Settings | None = None, *, model=UNSET, embedder=UNSET, ocr=UNSET,
               preload: bool = True, app_factory=FastAPI, route_prefix: str = '/api',
               public_prefix: str | None = None) -> FastAPI:
    route_prefix = '/' + route_prefix.strip('/')
    public_prefix = '/' + (public_prefix or route_prefix).strip('/')
    if settings is None:
        load_env_file()
        settings = Settings.from_env()
    store = DocumentStore(settings.data_dir, settings.workspace_ttl_days)
    services = Services(
        settings=settings,
        store=store,
        model=settings.model_client() if model is UNSET else model,
        embedder=(lambda: get_embedder(settings.embeddings_enabled, settings.embedding_model,
                                       settings.embedding_dir)) if embedder is UNSET else (lambda: embedder),
        ocr=(lambda: get_engine(settings.ocr_enabled)) if ocr is UNSET else (lambda: ocr),
    )
    model_info = {'model': settings.model, 'provider': settings.provider,
                  'endpoint': f"{settings.base_url.rstrip('/')}/chat/completions",
                  'fallbackModels': list(settings.fallback_models), 'retries': settings.retries}

    @asynccontextmanager
    async def lifespan(_app):
        removed = store.cleanup()
        if removed:
            log.info('Removed %d idle workspaces', removed)
        if preload:
            # Load the embedding and OCR models now so the first upload is quick.
            threading.Thread(target=lambda: (services.embedder(), services.ocr()), daemon=True).start()
        yield
        store.close()

    app = app_factory(title='Study Companion API', docs_url=f'{route_prefix}/docs',
                      openapi_url=f'{route_prefix}/openapi.json', redoc_url=None, lifespan=lifespan)
    app.state.services = services
    origins = [o.strip() for o in os.environ.get('STUDY_CORS_ORIGINS', '').split(',') if o.strip()]
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['*'], allow_headers=['*'],
                           expose_headers=[API_VERSION_HEADER])

    @app.middleware('http')
    async def no_store(request: Request, call_next):
        path = request.scope.get('path', '')
        if public_prefix != route_prefix and (path == public_prefix or path.startswith(public_prefix + '/')):
            request.scope['path'] = route_prefix + path[len(public_prefix):]
        response = await call_next(request)
        response.headers.setdefault('Cache-Control', 'no-store')
        response.headers[API_VERSION_HEADER] = str(API_VERSION)
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, _exc):
        return failure('Invalid request.', 400)

    @app.exception_handler(WorkspaceError)
    async def workspace_error(_request, exc):
        return failure(str(exc), 400)

    def current(x_workspace_id: str | None = Header(default=None)) -> Workspace:
        """The caller's workspace. Notes chunked under older rules, or whose
        re-chunking was cut short, are re-chunked before anything reads them."""
        workspace = store.workspace(x_workspace_id)
        if workspace.needs_rechunk:
            with workspace.lock:
                if workspace.needs_rechunk:
                    log.info('Re-chunking workspace %s', workspace.id[:8])
                    workspace.rechunk(services.embedder())
        return workspace

    def semantic_status() -> str:
        if embedder is not UNSET:
            return 'off' if embedder is None else 'ready'
        return embedding_status(settings.embeddings_enabled)

    @app.get(f'{route_prefix}/status')
    def health():
        semantic = semantic_status()
        return {
            'status': 'ok',
            'apiVersion': API_VERSION,
            'name': 'Study Companion',
            'generation': services.model is not None,
            'model': settings.model,
            'provider': settings.provider,
            'fallbackModels': list(settings.fallback_models),
            'embeddings': {'status': semantic, 'model': settings.embedding_model},
            'ocr': {'engine': 'RapidOCR', 'enabled': settings.ocr_enabled},
            'retrieval': {'modes': list(MODES), 'default': 'keyword' if semantic in {'off', 'failed'} else 'hybrid'},
            'chunking': {'modes': list(CHUNKINGS), 'default': 'section', 'sectionMaxWords': SECTION_MAX_WORDS},
            'practice': {'kinds': list(practice_layer.KINDS), 'count': list(practice_layer.COUNT_RANGE)},
            'limits': {'fileBytes': LIMITS['file_bytes'], 'documents': settings.max_documents},
        }

    # ------------------------------------------------------------ documents

    @app.get(f'{route_prefix}/documents')
    def list_documents(workspace: Workspace = Depends(current)):
        return {'documents': [summary(r) for r in workspace.records()]}

    @app.get(f'{route_prefix}/documents/{{doc_id}}')
    def get_document(doc_id: str, workspace: Workspace = Depends(current)):
        record = workspace.record(doc_id) if DOCUMENT_ID.match(doc_id) else None
        if record is None:
            return failure('Notes not found.', 404)
        return {**summary(record), 'version': record['version'],
                **{k: record[k] for k in ('extraction', 'sectioning', 'index', 'embeddings', 'timings')},
                'chunking': workspace.chunk_stats(record), 'sections': record['sections'],
                'embeddings': record['embeddings']}

    @app.delete(f'{route_prefix}/documents/{{doc_id}}')
    def delete_document(doc_id: str, workspace: Workspace = Depends(current)):
        if not DOCUMENT_ID.match(doc_id) or not workspace.delete(doc_id):
            return failure('Notes not found.', 404)
        return {'deleted': doc_id}

    @app.post(f'{route_prefix}/documents')
    async def upload(file: UploadFile = File(...), workspace: Workspace = Depends(current)):
        try:
            file_format(file.filename or '')
        except ExtractionError as error:
            return failure(str(error), 400)
        data = await file.read(LIMITS['file_bytes'] + 1)
        await file.close()
        if len(data) > LIMITS['file_bytes']:
            return failure('This file is over 40 MB. Export a smaller version and try again.', 413)
        filename = file.filename or 'notes'

        def work(emit, cancelled):
            ingest(data, filename, workspace, max_documents=settings.max_documents, ocr=services.ocr(),
                   embedder=services.embedder(), emit=emit, cancelled=cancelled)

        return ndjson(work)

    @app.post(f'{route_prefix}/documents/{{doc_id}}/overview')
    async def overview(doc_id: str, workspace: Workspace = Depends(current)):
        record = workspace.record(doc_id) if DOCUMENT_ID.match(doc_id) else None
        if record is None:
            return failure('Notes not found.', 404)
        if record.get('overview'):
            return record['overview']
        if services.model is None:
            return failure('No model key is configured, so an overview cannot be written.', 503)
        try:
            result = await run_in_threadpool(document_overview, services.model, record)
        except (ProviderError, ValueError) as error:
            return failure(f'The overview could not be written: {error}', 502)
        with workspace.lock:
            current = workspace.record(doc_id)
            if current is not None:
                workspace.save({**current, 'overview': result}, replace_vectors=False)
        return result

    @app.get(f'{route_prefix}/sample')
    def get_sample(workspace: Workspace = Depends(current)):
        return sample_info(workspace)

    @app.post(f'{route_prefix}/sample')
    async def load_sample(workspace: Workspace = Depends(current)):
        try:
            records = await run_in_threadpool(ingest_sections, workspace, sample_documents(), services.embedder(),
                                              max_documents=settings.max_documents)
        except DocumentError as error:
            return failure(str(error), 409)
        return {'documents': [summary(r) for r in records]}

    # ------------------------------------------------------------- settings

    def settings_reply(workspace) -> dict:
        current = preferences(workspace.settings())
        names = [r['name'] for r in workspace.records()]
        return {'settings': current, 'defaults': DEFAULTS, 'prompt': system_prompt(current, names),
                'levels': [{'id': key, 'label': label, 'style': style} for key, (label, style) in LEVELS.items()],
                'ranges': {field: list(bounds) for field, bounds in RANGES.items()}}

    @app.get(f'{route_prefix}/settings')
    def get_settings(workspace: Workspace = Depends(current)):
        return settings_reply(workspace)

    @app.put(f'{route_prefix}/settings')
    async def put_settings(request: Request, workspace: Workspace = Depends(current)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        try:
            clean = validate(body)
        except PreferencesError as error:
            return failure(str(error), 400)
        before = workspace.chunk_words
        stored = {**workspace.settings(), **clean}
        workspace.save_settings({k: v for k, v in stored.items() if v != ''})
        reply = settings_reply(workspace)
        if workspace.chunk_words != before:
            # Only the fixed-length chunking depends on the chunk size.
            reply['rechunked'] = await run_in_threadpool(workspace.rechunk, services.embedder())
        return reply

    # --------------------------------------------------- asking, comparing

    def parse_search(body: dict, workspace) -> dict | JSONResponse:
        """What every search request carries: mode, expansion, documents and context options."""
        mode = body.get('mode', 'hybrid')
        if mode not in MODES:
            return failure('This retrieval mode is not available.', 400)
        expand = body.get('expand', True)
        if type(expand) is not bool:
            return failure('expand must be true or false.', 400)
        ids = body.get('documentIds')
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(ids) > 50):
            return failure('Invalid selection of notes.', 400)
        try:
            chosen = options(body, preferences(workspace.settings()))
        except PreferencesError as error:
            return failure(str(error), 400)
        return {'mode': mode, 'expand': expand, 'document_ids': ids or None, 'options': chosen,
                'embedder': services.embedder() if mode != 'keyword' else None}

    def parse_question(body: dict, field: str) -> str | JSONResponse:
        text = body.get(field)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE_CHARS:
            return failure('Enter a question between 1 and 4,000 characters.', 400)
        return text.strip()

    SEARCH_FIELDS = {'mode', 'expand', 'documentIds', 'k', 'budgetWords', 'expandBelowWords'}

    @app.post(f'{route_prefix}/ask')
    async def ask(request: Request, workspace: Workspace = Depends(current)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - SEARCH_FIELDS - {'message', 'earlier', 'followUp', 'chunking'}:
            return failure('Unsupported option.', 400)
        message = parse_question(body, 'message')
        if isinstance(message, JSONResponse):
            return message
        earlier = body.get('earlier', [])
        if (not isinstance(earlier, list) or len(earlier) > MAX_EARLIER_QUESTIONS
                or not all(isinstance(q, str) and len(q) <= MAX_MESSAGE_CHARS for q in earlier)):
            return failure('Invalid earlier questions.', 400)
        follow = body.get('followUp', 'auto')
        if follow != 'auto' and type(follow) is not bool:
            return failure('followUp must be true, false or "auto".', 400)
        chunking = body.get('chunking', 'section')
        if chunking not in CHUNKINGS:
            return failure('This chunking is not available.', 400)
        search = parse_search(body, workspace)
        if isinstance(search, JSONResponse):
            return search
        if not workspace.records():
            return failure('Add notes before asking questions.', 409)

        def work(emit, cancelled):
            for event in run_turn(workspace, message, earlier=earlier, follow=follow, chunking=chunking,
                                  model=services.model, model_info=model_info, cancelled=cancelled, **search):
                if cancelled():
                    break
                emit(event)

        return ndjson(work)

    @app.post(f'{route_prefix}/compare')
    async def compare_route(request: Request, workspace: Workspace = Depends(current)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - SEARCH_FIELDS - {'query'}:
            return failure('Unsupported option.', 400)
        query = parse_question(body, 'query')
        if isinstance(query, JSONResponse):
            return query
        search = parse_search(body, workspace)
        if isinstance(search, JSONResponse):
            return search
        if not workspace.records():
            return failure('Add notes before comparing.', 409)
        return await run_in_threadpool(lambda: compare(workspace, query, **search))

    # ------------------------------------------------------------- practice

    @app.get(f'{route_prefix}/practice')
    def list_practice(workspace: Workspace = Depends(current)):
        return {'sets': [practice_layer.summary(s) for s in workspace.practice_sets()]}

    @app.get(f'{route_prefix}/practice/{{set_id}}')
    def get_practice(set_id: str, workspace: Workspace = Depends(current)):
        found = workspace.practice_set(set_id)
        return found if found is not None else failure('Practice set not found.', 404)

    @app.delete(f'{route_prefix}/practice/{{set_id}}')
    def delete_practice(set_id: str, workspace: Workspace = Depends(current)):
        if not workspace.delete_practice(set_id):
            return failure('Practice set not found.', 404)
        return {'deleted': set_id}

    @app.post(f'{route_prefix}/practice')
    async def make_practice(request: Request, workspace: Workspace = Depends(current)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - {'kind', 'count', 'focus', 'documentIds'}:
            return failure('Unsupported option.', 400)
        kind = body.get('kind', 'quiz')
        if kind not in practice_layer.KINDS:
            return failure('Choose a quiz, flashcards or recall cards.', 400)
        low, high = practice_layer.COUNT_RANGE
        count = body.get('count', 5)
        if type(count) is not int or not low <= count <= high:
            return failure(f'Choose between {low} and {high} items.', 400)
        focus = body.get('focus', '')
        if not isinstance(focus, str) or len(focus) > practice_layer.FOCUS_LIMIT:
            return failure(f'Keep the focus under {practice_layer.FOCUS_LIMIT} characters.', 400)
        ids = body.get('documentIds')
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(ids) > 50):
            return failure('Invalid selection of notes.', 400)
        if not workspace.records():
            return failure('Add notes before practising.', 409)
        if kind != 'recall' and services.model is None:
            return failure('Quizzes and flashcards are written by a model, and no model key is configured. '
                           'Recall cards work without one.', 503)
        level = preferences(workspace.settings())['level']

        def work(emit, cancelled):
            practice_layer.generate(workspace, kind=kind, count=count, focus=focus.strip(), document_ids=ids or None,
                                    level=level, model=services.model, embedder=services.embedder(), emit=emit,
                                    cancelled=cancelled)

        return ndjson(work)

    return app


app = create_app()

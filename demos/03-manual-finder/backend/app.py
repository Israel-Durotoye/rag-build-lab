"""Finder API (FastAPI).

Run from demos/03-manual-finder:
    .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8002

Every route except /api/status needs an ``X-Workspace-Id`` header: 32 hex
characters the browser generates once and keeps.

    GET    /api/status                    capabilities
    GET    /api/library                   manuals, models, families, the sample library
    POST   /api/sample                    add the sample library to the workspace
    POST   /api/documents                 upload (multipart) -> NDJSON progress -> manual
    GET    /api/documents/{id}            one manual: sections, units and their tags, codes
    PUT    /api/documents/{id}/models     the models it covers -> re-tagged manual
    DELETE /api/documents/{id}
    GET    /api/models/{id}/guide         how to tell a model from its look-alikes
    GET    /api/codes                     every code x every model (?q=&family=&differs=1)
    GET    /api/codes/suggest             codes starting with what was typed (?q=&model=)
    POST   /api/ask                       one question -> NDJSON pipeline events
    POST   /api/lab                       one query, three search modes (no model)
    GET    /api/evaluation                the labelled queries and saved runs
    POST   /api/evaluation/run            run them -> NDJSON progress -> run
    GET    /api/evaluation/runs/{id}      one run;  DELETE likewise
    GET    /api/settings                  the workspace's settings
    PUT    /api/settings                  change them
"""
from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, FastAPI, Header, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from rag_core.web.documents import LIMITS, DocumentError
from rag_core.web.embeddings import get_embedder, status as embedding_status
from rag_core.web.extraction import ExtractionError, file_format
from rag_core.web.http import failure, ndjson as stream_ndjson, read_json
from rag_core.web.ocr import get_engine
from rag_core.web.retrieval import CANDIDATES, MODES, RRF_CONSTANT

from . import cards, evaluation, guide, lab
from .ingest import apply_models, ingest, load_sample, sample_info, sample_queries
from .preferences import DEFAULTS, RANGES, STYLES, PreferencesError, options, preferences, validate
from .prompting import POLICY, rules, system_prompt
from .settings import Settings, load_env_file
from .store import DOCUMENT_ID, DocumentStore, Workspace, WorkspaceError, chunk_id, summary
from .turn import TIE_BREAK, run_turn
from .variants import VariantError, adopt_known

log = logging.getLogger('manual_finder')
API_VERSION = 1
API_VERSION_HEADER = 'X-Manual-API-Version'
MAX_MESSAGE_CHARS = 4000
MAX_EARLIER_QUESTIONS = 12
# A blank line after this many silent seconds keeps a stream open through
# proxies that cut idle responses (the Next.js rewrite allows 30 s) while the
# model is slow to start or a retry waits.
HEARTBEAT_SECONDS = 10.0
# Multipart boundaries and part headers around an uploaded file.
FORM_OVERHEAD = 64 * 1024
# An upload holds its file in memory from the moment it arrives until it has
# been read, and files are read one at a time. Beyond these numbers a request
# is refused at once rather than queued: files being received, and files
# waiting to be read.
MAX_RECEIVING = 4
MAX_WAITING = 4
UNSET = object()


class Slots:
    """A counter that refuses instead of waiting."""

    def __init__(self, size: int):
        self.size, self.used, self.lock = size, 0, threading.Lock()

    def take(self) -> bool:
        with self.lock:
            if self.used >= self.size:
                return False
            self.used += 1
            return True

    def give(self) -> None:
        with self.lock:
            self.used -= 1


@dataclass
class Services:
    settings: Settings
    store: DocumentStore
    model: object | None
    embedder: Callable[[], object | None]
    ocr: Callable[[], object | None]


def ndjson(work: Callable[[Callable[[dict], None], Callable[[], bool]], None]):
    return stream_ndjson(work, log=log, expected=(ExtractionError, DocumentError, WorkspaceError, VariantError),
                         heartbeat=HEARTBEAT_SECONDS)


def document_detail(record: dict) -> dict:
    units = [{'id': u['id'], 'chunkId': chunk_id(record['id'], u['id']), 'sectionId': u['sectionId'],
              'text': u['text'], 'location': u['location'], 'kind': u['kind'], 'models': u['models'],
              'revisions': u.get('revisions', {}), 'codes': u.get('codes', []), 'header': u.get('header'),
              'pages': u.get('pages'), 'words': len(u['text'].split()), 'tag': u.get('tag'),
              'tagReason': u.get('tagReason')} for u in record['units']]
    return {**summary(record), 'sections': record['sections'], 'units': units, 'codeEntries': record.get('codes', []),
            'modelDefs': record.get('modelDefs', []), 'families': record.get('families', []),
            'suggestedModels': record.get('suggestedModels', []), 'extraction': record.get('extraction')}


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
            # Load the embedding and OCR models now so the first question is quick.
            threading.Thread(target=lambda: (services.embedder(), services.ocr()), daemon=True).start()
        yield
        store.close()

    app = app_factory(title='Finder API', docs_url=f'{route_prefix}/docs',
                      openapi_url=f'{route_prefix}/openapi.json', redoc_url=None, lifespan=lifespan)
    app.state.services = services
    origins = [o.strip() for o in os.environ.get('MANUAL_CORS_ORIGINS', '').split(',') if o.strip()]
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

    receiving, waiting = Slots(MAX_RECEIVING), Slots(MAX_WAITING)

    def current(x_workspace_id: str | None = Header(default=None)) -> Workspace:
        """The browser's workspace, created on first use (routes that write)."""
        return store.workspace(x_workspace_id)

    def existing(x_workspace_id: str | None = Header(default=None)) -> Workspace:
        """The browser's workspace for reading. One that doesn't exist yet is
        not created: an empty one stands in, so requests with ever-new IDs
        leave nothing behind."""
        return store.workspace(x_workspace_id, create=False)

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
            'name': 'Finder',
            'generation': services.model is not None,
            'model': settings.model,
            'provider': settings.provider,
            'fallbackModels': list(settings.fallback_models),
            'embeddings': {'status': semantic, 'model': settings.embedding_model},
            'ocr': {'engine': 'RapidOCR', 'enabled': settings.ocr_enabled},
            'retrieval': {'modes': list(MODES), 'default': 'keyword' if semantic in {'off', 'failed'} else 'hybrid',
                          'rrfConstant': RRF_CONSTANT, 'tieBreak': TIE_BREAK, 'candidates': CANDIDATES},
            'limits': {'fileBytes': LIMITS['file_bytes'], 'documents': settings.max_documents},
        }

    # ------------------------------------------------------------ library

    def library_reply(workspace: Workspace) -> dict:
        registry = workspace.library.registry()
        return {'documents': [summary(r) for r in workspace.records()],
                'models': guide.library_models(workspace),
                'families': list(registry.families.values()),
                'sample': sample_info(workspace),
                'corpusVersion': workspace.library.index.version}

    @app.get(f'{route_prefix}/library')
    def get_library(workspace: Workspace = Depends(existing)):
        return library_reply(workspace)

    @app.post(f'{route_prefix}/sample')
    async def add_sample(workspace: Workspace = Depends(current)):
        try:
            # The embedder may still be loading: wait for it off the event loop.
            records = await run_in_threadpool(lambda: load_sample(workspace, services.embedder(),
                                                                  max_documents=settings.max_documents))
        except DocumentError as error:
            return failure(str(error), 409)
        return {'documents': [summary(r) for r in records]}

    @app.get(f'{route_prefix}/documents/{{doc_id}}')
    def get_document(doc_id: str, workspace: Workspace = Depends(existing)):
        record = workspace.record(doc_id) if DOCUMENT_ID.match(doc_id) else None
        if record is None:
            return failure('Manual not found.', 404)
        return document_detail(record)

    @app.delete(f'{route_prefix}/documents/{{doc_id}}')
    def delete_document(doc_id: str, workspace: Workspace = Depends(existing)):
        if not DOCUMENT_ID.match(doc_id) or not workspace.delete(doc_id):
            return failure('Manual not found.', 404)
        return {'deleted': doc_id}

    @app.post(f'{route_prefix}/documents')
    async def upload(request: Request, workspace: Workspace = Depends(current)):
        # The size is checked before the body is read: the form parser would
        # otherwise spool any amount to disk first.
        too_big = failure('This file is over 40 MB. Export a smaller version and try again.', 413)
        length = request.headers.get('content-length', '')
        if not length.isdigit():
            return failure('Send the file with its size (a Content-Length header).', 411)
        if int(length) > LIMITS['file_bytes'] + FORM_OVERHEAD:
            return too_big
        if not receiving.take():
            return failure('Finder is receiving other uploads. Try again in a moment.', 503)
        try:
            try:
                form = await request.form(max_files=1, max_fields=1)
            except HTTPException:
                return failure('Send one file as multipart form data, in a field named "file".', 400)
            try:
                file = form.get('file')
                if not isinstance(file, UploadFile):
                    return failure('Send one file as multipart form data, in a field named "file".', 400)
                filename = file.filename or 'manual'
                try:
                    file_format(filename)
                except ExtractionError as error:
                    return failure(str(error), 400)
                data = await file.read(LIMITS['file_bytes'] + 1)
            finally:
                await form.close()
        finally:
            receiving.give()
        if len(data) > LIMITS['file_bytes']:
            return too_big

        def work(emit, cancelled):
            if not waiting.take():
                raise DocumentError('Finder is reading other uploads. Try again in a minute.')
            try:
                ingest(data, filename, workspace, max_documents=settings.max_documents, ocr=services.ocr(),
                       embedder=services.embedder(), emit=emit, cancelled=cancelled)
            finally:
                waiting.give()

        return ndjson(work)

    @app.put(f'{route_prefix}/documents/{{doc_id}}/models')
    async def put_models(doc_id: str, request: Request, workspace: Workspace = Depends(existing)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        record = workspace.record(doc_id) if DOCUMENT_ID.match(doc_id) else None
        if record is None:
            return failure('Manual not found.', 404)
        if record['format'] == 'sample':
            return failure("The sample library's models are fixed.", 409)
        if set(body) - {'models', 'families'}:
            return failure('Unsupported option.', 400)
        def tag():
            # A model the library already has keeps its ID: the upload joins it.
            models = adopt_known(body.get('models', []), workspace.library.registry().models)
            updated = apply_models(record, models, body.get('families', []))
            workspace.save(updated, replace_vectors=False)
            return updated

        try:
            updated = await run_in_threadpool(tag)  # tagging reads every passage: off the event loop
        except VariantError as error:
            return failure(str(error), 400)
        return document_detail(updated)

    # ------------------------------------------------------------ models and codes

    @app.get(f'{route_prefix}/models/{{model_id}}/guide')
    def model_guide(model_id: str, workspace: Workspace = Depends(existing)):
        found = guide.guide(workspace, model_id)
        return found if found is not None else failure('Model not found.', 404)

    @app.get(f'{route_prefix}/codes')
    def code_matrix(q: str = '', family: str = '', differs: str = '', workspace: Workspace = Depends(existing)):
        if len(q) > 80 or len(family) > 64:
            return failure('Invalid request.', 400)
        return cards.matrix(workspace, workspace.library.registry(), q=q, family=family, differs=differs == '1')

    @app.get(f'{route_prefix}/codes/suggest')
    def code_suggestions(q: str = '', model: str = '', workspace: Workspace = Depends(existing)):
        if len(q) > 40 or len(model) > 64:
            return failure('Invalid request.', 400)
        return {'suggestions': cards.suggest(workspace, workspace.library.registry(), q, model or None)}

    # ------------------------------------------------------------ settings

    def settings_reply(workspace: Workspace) -> dict:
        chosen = preferences(workspace.settings())
        return {'settings': chosen, 'defaults': DEFAULTS, 'prompt': system_prompt(chosen),
                'rules': rules(chosen), 'policy': {'alwaysAsk': True, 'text': POLICY},
                'styles': [{'id': key, 'label': label, 'style': style} for key, (label, style) in STYLES.items()],
                'ranges': {field: list(bounds) for field, bounds in RANGES.items()}}

    @app.get(f'{route_prefix}/settings')
    def get_settings(workspace: Workspace = Depends(existing)):
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
        stored = {**workspace.settings(), **clean}
        workspace.save_settings({k: v for k, v in stored.items() if v != ''})
        return settings_reply(workspace)

    # ------------------------------------------------------------ asking

    def parse_question(body: dict, field: str) -> str | JSONResponse:
        text = body.get(field)
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_MESSAGE_CHARS:
            return failure('Enter a question between 1 and 4,000 characters.', 400)
        return text.strip()

    def parse_choice(body: dict, workspace: Workspace) -> tuple[str | None, str | None] | JSONResponse:
        model, revision = body.get('model'), body.get('revision')
        if model is not None and (not isinstance(model, str) or not DOCUMENT_ID.match(model)):
            return failure('Invalid model.', 400)
        if revision is not None and (not isinstance(revision, str) or not DOCUMENT_ID.match(revision)):
            return failure('Invalid revision.', 400)
        registry = workspace.library.registry()
        if model is not None and model not in registry.models:
            return failure('This model is not in the library.', 400)
        if revision is not None and (model is None or revision not in {
                r['id'] for r in registry.models[model].get('revisions', [])}):
            return failure('This revision does not belong to the chosen model.', 400)
        return model, revision

    @app.post(f'{route_prefix}/ask')
    async def ask(request: Request, workspace: Workspace = Depends(existing)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - {'message', 'model', 'revision', 'mode', 'k', 'rrfConstant', 'budgetWords', 'earlier',
                        'followUp'}:
            return failure('Unsupported option.', 400)
        message = parse_question(body, 'message')
        if isinstance(message, JSONResponse):
            return message
        chosen = parse_choice(body, workspace)
        if isinstance(chosen, JSONResponse):
            return chosen
        mode = body.get('mode', preferences(workspace.settings())['mode'])
        if mode not in MODES:
            return failure('This search mode is not available.', 400)
        earlier = body.get('earlier', [])
        if (not isinstance(earlier, list) or len(earlier) > MAX_EARLIER_QUESTIONS
                or not all(isinstance(q, str) and len(q) <= MAX_MESSAGE_CHARS for q in earlier)):
            return failure('Invalid earlier questions.', 400)
        follow = body.get('followUp', 'auto')
        if follow != 'auto' and type(follow) is not bool:
            return failure('followUp must be true, false or "auto".', 400)
        try:
            chosen_options = options(body, preferences(workspace.settings()))
        except PreferencesError as error:
            return failure(str(error), 400)
        if not workspace.records():
            return failure('Add manuals before asking questions.', 409)
        # Semantic search needs the embedding model; while it loads, this
        # question goes by keyword rather than waiting on the event loop.
        embedder_now = services.embedder() if mode != 'keyword' and semantic_status() == 'ready' else None

        def work(emit, cancelled):
            for event in run_turn(workspace, message, picker_model=chosen[0], picker_revision=chosen[1], mode=mode,
                                  options=chosen_options, model=services.model, embedder=embedder_now,
                                  model_info=model_info, earlier=earlier, follow=follow, cancelled=cancelled):
                if cancelled():
                    break
                emit(event)

        return ndjson(work)

    @app.post(f'{route_prefix}/lab')
    async def lab_route(request: Request, workspace: Workspace = Depends(existing)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - {'query', 'model', 'revision', 'k', 'constant'}:
            return failure('Unsupported option.', 400)
        query = parse_question(body, 'query')
        if isinstance(query, JSONResponse):
            return query
        chosen = parse_choice(body, workspace)
        if isinstance(chosen, JSONResponse):
            return chosen
        stored = preferences(workspace.settings())
        k, constant = body.get('k', stored['k']), body.get('constant', stored['rrfConstant'])
        for name, value in (('k', k), ('rrfConstant', constant)):
            low, high = RANGES[name]
            if type(value) is not int or not low <= value <= high:
                return failure(f'{name} must be a whole number from {low} to {high}.', 400)
        if not workspace.records():
            return failure('Add manuals before comparing search modes.', 409)
        return await run_in_threadpool(lambda: lab.run(workspace, query, model=chosen[0], revision=chosen[1], k=k,
                                                       constant=constant, embedder=services.embedder(),
                                                       labelled=sample_queries()))

    # ------------------------------------------------------------ evaluation

    @app.get(f'{route_prefix}/evaluation')
    def get_evaluation(workspace: Workspace = Depends(existing)):
        return {'queries': sample_queries(), 'runs': [evaluation.summary(r) for r in workspace.runs()],
                'scope': evaluation.SCOPE}

    @app.get(f'{route_prefix}/evaluation/runs/{{run_id}}')
    def get_run(run_id: str, workspace: Workspace = Depends(existing)):
        found = workspace.run(run_id)
        return found if found is not None else failure('Run not found.', 404)

    @app.delete(f'{route_prefix}/evaluation/runs/{{run_id}}')
    def delete_run(run_id: str, workspace: Workspace = Depends(existing)):
        if not workspace.delete_run(run_id):
            return failure('Run not found.', 404)
        return {'deleted': run_id}

    @app.post(f'{route_prefix}/evaluation/run')
    async def run_evaluation(request: Request, workspace: Workspace = Depends(existing)):
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - {'modes', 'k', 'constant'}:
            return failure('Unsupported option.', 400)
        modes = body.get('modes')
        if modes is not None and (not isinstance(modes, list) or not modes or not set(modes) <= set(MODES)):
            return failure('Choose search modes from: ' + ', '.join(MODES) + '.', 400)
        stored = preferences(workspace.settings())
        k, constant = body.get('k', stored['k']), body.get('constant', stored['rrfConstant'])
        for name, value in (('k', k), ('rrfConstant', constant)):
            low, high = RANGES[name]
            if type(value) is not int or not low <= value <= high:
                return failure(f'{name} must be a whole number from {low} to {high}.', 400)
        if not sample_info(workspace)['loaded']:
            return failure('Load the sample library first: the labelled queries are about its manuals.', 409)

        def work(emit, cancelled):
            record = evaluation.run(workspace, sample_queries(), modes=modes, k=k, constant=constant,
                                    embedder=services.embedder(), emit=emit, cancelled=cancelled)
            workspace.save_run(record)
            emit({'type': 'done', 'run': record})

        return ndjson(work)

    return app


app = create_app()

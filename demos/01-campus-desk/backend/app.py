"""Campus Guide API (FastAPI).

Run from demos/01-campus-desk:
    .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000

Every route except /api/status (and the legacy /api/health alias) needs an ``X-Workspace-Id`` header: 32 hex
characters the browser generates once and keeps.

    GET    /api/status                   capabilities
    GET    /api/documents                documents in the workspace
    POST   /api/documents                upload (multipart) -> NDJSON progress -> document
    GET    /api/documents/{id}           the full breakdown of one document
    DELETE /api/documents/{id}
    POST   /api/documents/{id}/overview  AI-written summary, topics, questions
    GET    /api/profile                  model-written welcome page content (school, quick actions)
    POST   /api/profile                  write or refresh it
    GET    /api/settings                 the guide owner's answer settings
    PUT    /api/settings                 change them
    POST   /api/chat                     one chat turn -> NDJSON pipeline events
    POST   /api/retrieve                 retrieval layer only (for inspection and evaluation)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Callable

from fastapi import FastAPI, File, Header, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from rag_core.providers import ProviderError

from .chat import run_turn
from .augmentation import DEFAULTS, SettingsError, guide_settings, system_prompt, validate_settings
from .documents import LIMITS, DocumentError
from .embeddings import get_embedder, status as embedding_status
from .extraction import ExtractionError, file_format
from .generation import document_overview, workspace_profile
from .ingest import ingest
from .ocr import get_engine
from .retrieval import MODES, retrieve
from .settings import Settings, load_env_file
from .store import DOCUMENT_ID, DocumentStore, WorkspaceError, summary

log = logging.getLogger('campus_guide')
API_VERSION = 2
API_VERSION_HEADER = 'X-Campus-API-Version'
MAX_JSON_BYTES = 256 * 1024
MAX_MESSAGE_CHARS = 4000
UNSET = object()


def failure(message: str, status: int) -> JSONResponse:
    return JSONResponse({'error': message}, status_code=status)


@dataclass
class Services:
    settings: Settings
    store: DocumentStore
    model: object | None
    embedder: Callable[[], object | None]
    ocr: Callable[[], object | None]


def ndjson(work: Callable[[Callable[[dict], None], Callable[[], bool]], None]) -> StreamingResponse:
    """Run ``work(emit, cancelled)`` on a thread and stream what it emits as
    newline-delimited JSON. A client disconnect sets ``cancelled``."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()

    def emit(event) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except RuntimeError:
            stop.set()  # the event loop is gone

    def runner() -> None:
        try:
            work(emit, stop.is_set)
        except (ExtractionError, DocumentError, WorkspaceError) as error:
            emit({'type': 'error', 'error': str(error)})
        except Exception:
            log.exception('Streaming request failed')
            emit({'type': 'error', 'error': 'Something went wrong on the server. Please try again.'})
        finally:
            emit(None)

    async def stream():
        threading.Thread(target=runner, daemon=True).start()
        try:
            while (event := await queue.get()) is not None:
                yield json.dumps(event, ensure_ascii=False) + '\n'
        finally:
            stop.set()

    return StreamingResponse(stream(), media_type='application/x-ndjson',
                             headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store'})


async def read_json(request: Request) -> dict | JSONResponse:
    if not request.headers.get('content-type', '').lower().startswith('application/json'):
        return failure('Send a JSON request.', 415)
    size, parts = 0, []
    async for part in request.stream():
        size += len(part)
        if size > MAX_JSON_BYTES:
            return failure('Request is too large.', 413)
        parts.append(part)
    try:
        body = json.loads(b''.join(parts) or b'null')
    except ValueError:
        return failure('Send a valid JSON object.', 400)
    if not isinstance(body, dict):
        return failure('Send a valid JSON object.', 400)
    return body


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
                                       settings.model_dir)) if embedder is UNSET else (lambda: embedder),
        ocr=(lambda: get_engine(settings.ocr_enabled)) if ocr is UNSET else (lambda: ocr),
    )
    model_info = {'model': settings.model, 'provider': 'AgentRouter',
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

    app = app_factory(title='Campus Guide API', docs_url=f'{route_prefix}/docs',
                      openapi_url=f'{route_prefix}/openapi.json', redoc_url=None, lifespan=lifespan)
    app.state.services = services
    origins = [o.strip() for o in os.environ.get('CAMPUS_CORS_ORIGINS', '').split(',') if o.strip()]
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

    @app.get(f'{route_prefix}/health', include_in_schema=False)
    @app.get(f'{route_prefix}/status')
    def health():
        semantic = 'ready' if embedder is not UNSET and embedder is not None else (
            'off' if embedder is None else embedding_status(settings.embeddings_enabled))
        return {
            'status': 'ok',
            'apiVersion': API_VERSION,
            'name': 'Campus Guide',
            'generation': services.model is not None,
            'model': settings.model,
            'provider': 'AgentRouter',
            'fallbackModels': list(settings.fallback_models),
            'embeddings': {'status': semantic, 'model': settings.embedding_model},
            'ocr': {'engine': 'RapidOCR', 'enabled': settings.ocr_enabled},
            'retrieval': {'modes': list(MODES), 'default': 'keyword' if semantic in {'off', 'failed'} else 'hybrid',
                          'topK': settings.top_k},
            'limits': {'fileBytes': LIMITS['file_bytes'], 'documents': settings.max_documents},
        }

    @app.get(f'{route_prefix}/documents')
    def list_documents(x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        return {'documents': [summary(r) for r in workspace.records()]}

    @app.get(f'{route_prefix}/documents/{{doc_id}}')
    def get_document(doc_id: str, x_workspace_id: str | None = Header(default=None)):
        record = store.workspace(x_workspace_id).record(doc_id) if DOCUMENT_ID.match(doc_id) else None
        if record is None:
            return failure('Document not found.', 404)
        return {**summary(record), **{k: record[k] for k in ('extraction', 'chunking', 'index', 'embeddings', 'timings',
                                                              'chunks')}}

    @app.delete(f'{route_prefix}/documents/{{doc_id}}')
    def delete_document(doc_id: str, x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        if not DOCUMENT_ID.match(doc_id) or not workspace.delete(doc_id):
            return failure('Document not found.', 404)
        return {'deleted': doc_id}

    @app.post(f'{route_prefix}/documents')
    async def upload(file: UploadFile = File(...), x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        try:
            file_format(file.filename or '')
        except ExtractionError as error:
            return failure(str(error), 400)
        data = await file.read(LIMITS['file_bytes'] + 1)
        await file.close()
        if len(data) > LIMITS['file_bytes']:
            return failure('This file is over 40 MB. Export a smaller version and try again.', 413)
        filename = file.filename or 'document'

        def work(emit, cancelled):
            ingest(data, filename, workspace, max_documents=settings.max_documents, ocr=services.ocr(),
                   embedder=services.embedder(), emit=emit, cancelled=cancelled)

        return ndjson(work)

    @app.post(f'{route_prefix}/documents/{{doc_id}}/overview')
    async def overview(doc_id: str, x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        record = workspace.record(doc_id) if DOCUMENT_ID.match(doc_id) else None
        if record is None:
            return failure('Document not found.', 404)
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

    @app.get(f'{route_prefix}/settings')
    def get_settings(x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        current = guide_settings(workspace.settings())
        names = [r['name'] for r in workspace.records()]
        return {'settings': current, 'defaults': DEFAULTS, 'prompt': system_prompt(current, names)}

    @app.put(f'{route_prefix}/settings')
    async def put_settings(request: Request, x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        try:
            clean = validate_settings(body)
        except SettingsError as error:
            return failure(str(error), 400)
        stored = {**workspace.settings(), **clean}
        workspace.save_settings({k: v for k, v in stored.items() if v})
        current = guide_settings(workspace.settings())
        names = [r['name'] for r in workspace.records()]
        return {'settings': current, 'defaults': DEFAULTS, 'prompt': system_prompt(current, names)}

    profile_locks: dict[str, threading.Lock] = {}

    @app.get(f'{route_prefix}/profile')
    def get_profile(x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        return {'profile': workspace.profile(), 'documents': len(workspace.records()),
                'generation': services.model is not None}

    @app.post(f'{route_prefix}/profile')
    async def make_profile(x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        if not workspace.records():
            return failure('Add a document first.', 409)
        if services.model is None:
            return failure('No model key is configured, so the welcome page cannot be written.', 503)
        lock = profile_locks.setdefault(workspace.id, threading.Lock())

        def build():
            # One writer per workspace: a second request waits, then reuses the result.
            with lock:
                cached = workspace.profile()
                if cached:
                    return cached
                result = {**workspace_profile(services.model, workspace.records()),
                          'signature': workspace.signature()}
                workspace.save_profile(result)
                return result

        try:
            result = await run_in_threadpool(build)
        except (ProviderError, ValueError) as error:
            return failure(f'The welcome page could not be written: {error}', 502)
        return {'profile': result, 'documents': len(workspace.records()), 'generation': True}

    def parse_options(body: dict) -> tuple[str, list[str] | None] | JSONResponse:
        mode = body.get('mode', 'hybrid')
        if mode not in MODES:
            return failure('This retrieval mode is not available.', 400)
        ids = body.get('documentIds')
        if ids is not None and (not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(ids) > 50):
            return failure('Invalid document selection.', 400)
        return mode, ids

    @app.post(f'{route_prefix}/chat')
    async def chat(request: Request, x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        if set(body) - {'message', 'history', 'mode', 'documentIds'}:
            return failure('Unsupported chat option.', 400)
        message = body.get('message')
        if not isinstance(message, str) or not message.strip() or len(message) > MAX_MESSAGE_CHARS:
            return failure('Enter a message between 1 and 4,000 characters.', 400)
        history = body.get('history', [])
        if not isinstance(history, list) or len(history) > 40 or not all(isinstance(m, dict) for m in history):
            return failure('Invalid conversation history.', 400)
        options = parse_options(body)
        if isinstance(options, JSONResponse):
            return options
        mode, document_ids = options
        if not workspace.records():
            return failure('Add a document before asking questions.', 409)

        def work(emit, cancelled):
            for event in run_turn(workspace, message.strip(), history, model=services.model,
                                  embedder=services.embedder() if mode != 'keyword' else None, mode=mode,
                                  k=settings.top_k, model_info=model_info, document_ids=document_ids,
                                  cancelled=cancelled):
                if cancelled():
                    break
                emit(event)

        return ndjson(work)

    @app.post(f'{route_prefix}/retrieve')
    async def retrieve_route(request: Request, x_workspace_id: str | None = Header(default=None)):
        workspace = store.workspace(x_workspace_id)
        body = await read_json(request)
        if isinstance(body, JSONResponse):
            return body
        query = body.get('query')
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_MESSAGE_CHARS:
            return failure('Enter a query between 1 and 4,000 characters.', 400)
        options = parse_options(body)
        if isinstance(options, JSONResponse):
            return options
        mode, document_ids = options
        k = body.get('k', settings.top_k)
        if not isinstance(k, int) or not 1 <= k <= 20:
            return failure('k must be a whole number from 1 to 20.', 400)
        embedder_now = services.embedder() if mode != 'keyword' else None
        return await run_in_threadpool(retrieve, workspace, query.strip(), mode=mode, k=k, embedder=embedder_now,
                                       document_ids=document_ids)

    return app


app = create_app()

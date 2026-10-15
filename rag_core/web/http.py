"""FastAPI helpers shared by the web backends."""
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

MAX_JSON_BYTES = 256 * 1024


def failure(message: str, status: int) -> JSONResponse:
    return JSONResponse({'error': message}, status_code=status)


def ndjson(work: Callable[[Callable[[dict], None], Callable[[], bool]], None], *,
           expected: tuple[type[Exception], ...] = (), log: logging.Logger | None = None,
           heartbeat: float | None = None) -> StreamingResponse:
    """Run ``work(emit, cancelled)`` on a thread and stream what it emits as
    newline-delimited JSON. A client disconnect sets ``cancelled``.

    ``expected`` exceptions carry a message written for the user and are sent
    as an error event; anything else is logged and reported in general terms.

    With ``heartbeat`` (seconds), a blank line is sent whenever nothing else
    has been for that long. Proxies with an idle timeout (a Next.js rewrite
    cuts a silent response after 30 s) then keep the response open while a
    model is slow to answer. NDJSON readers skip blank lines."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    stop = threading.Event()
    log = log or logging.getLogger('rag_core.web')

    def emit(event) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except RuntimeError:
            stop.set()  # the event loop is gone

    def runner() -> None:
        try:
            work(emit, stop.is_set)
        except expected as error:
            emit({'type': 'error', 'error': str(error)})
        except Exception:
            log.exception('Streaming request failed')
            emit({'type': 'error', 'error': 'Something went wrong on the server. Please try again.'})
        finally:
            emit(None)

    async def stream():
        threading.Thread(target=runner, daemon=True).start()
        pending = None
        try:
            while True:
                # One get() is kept across heartbeats, so no event is lost to a timeout.
                if pending is None:
                    pending = asyncio.ensure_future(queue.get())
                done, _ = await asyncio.wait({pending}, timeout=heartbeat)
                if not done:
                    yield '\n'
                    continue
                event, pending = pending.result(), None
                if event is None:
                    break
                yield json.dumps(event, ensure_ascii=False) + '\n'
        finally:
            if pending is not None:
                pending.cancel()
            stop.set()

    return StreamingResponse(stream(), media_type='application/x-ndjson',
                             headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store'})


async def read_json(request: Request, limit: int = MAX_JSON_BYTES) -> dict | JSONResponse:
    """The request's JSON object, or the error response to return instead."""
    if not request.headers.get('content-type', '').lower().startswith('application/json'):
        return failure('Send a JSON request.', 415)
    size, parts = 0, []
    async for part in request.stream():
        size += len(part)
        if size > limit:
            return failure('Request is too large.', 413)
        parts.append(part)
    try:
        body = json.loads(b''.join(parts) or b'null')
    except ValueError:
        return failure('Send a valid JSON object.', 400)
    if not isinstance(body, dict):
        return failure('Send a valid JSON object.', 400)
    return body

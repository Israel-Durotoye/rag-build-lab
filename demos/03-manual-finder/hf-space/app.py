"""Gradio status page served beside the Finder FastAPI backend."""
from __future__ import annotations

import spaces  # Must precede Gradio on ZeroGPU Spaces.
import gradio as gr

from backend.app import API_VERSION, create_app


# preload=True: the embedding and OCR models load in a background thread as
# soon as the Space starts, so /api/status reports "ready" before the first
# visitor and the first question does not carry the model download.
api = create_app(preload=True, app_factory=gr.Server,
                 route_prefix='/manual-api', public_prefix='/api')


def backend_status() -> dict:
    """Return the capabilities that the matching Finder frontend checks."""
    services = api.state.services
    settings = services.settings
    return {
        'status': 'ok',
        'apiVersion': API_VERSION,
        'name': 'Finder',
        'generation': services.model is not None,
        'model': settings.model,
        'provider': settings.provider,
        'apiDocs': '/api/docs',
    }


@spaces.GPU(duration=1)
def zero_gpu_marker() -> str:
    """ZeroGPU registration marker; the backend itself stays on CPU."""
    return 'registered'


CSS = """
#finder-demo { max-width: 880px; margin: 0 auto; }
.dark .gradio-container { color: var(--body-text-color); }
"""

with gr.Blocks() as demo:
    with gr.Column(elem_id='finder-demo'):
        gr.Markdown(
            f"""# 🔎 Finder API

The live backend for Finder: the exact passage for the exact device model.
Manuals are split into passages that each record the models they apply to;
every search is filtered to the chosen model before ranking, and answers
are cited. The sample library is Raspberry Pi and Arduino documentation
(CC BY-SA 4.0; see NOTICE.md). Its API contract is locked to the matching
Next.js frontend.

**API contract v{API_VERSION}** · [Open interactive API docs](/api/docs)
"""
        )
        check = gr.Button('Check backend', variant='primary')
        result = gr.JSON(label='Current backend contract')
        check.click(backend_status, outputs=result, api_name='backend_status', queue=False)

        # A registered but hidden handler satisfies the free ZeroGPU runtime.
        # Normal frontend/API traffic never invokes it or consumes GPU quota.
        marker = gr.Button('ZeroGPU marker', visible=False)
        marker.click(zero_gpu_marker, outputs=gr.Textbox(visible=False), api_visibility='private')


# Gradio owns the homepage and queue; FastAPI keeps every /api/* product route.
# Gradio replaces the startup hook of an app it is handed with its own, built
# from app_kwargs. Passing ours along is what makes the models preload and
# idle workspaces get cleaned up here, as they are under uvicorn.
demo.launch(_app=api, app_kwargs={'lifespan': api.router.lifespan_context}, ssr_mode=False,
            theme=gr.themes.Soft(primary_hue='teal'), css=CSS)

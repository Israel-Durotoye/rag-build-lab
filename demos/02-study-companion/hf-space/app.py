"""Gradio status page served beside the Study Companion FastAPI backend."""
from __future__ import annotations

import spaces  # Must precede Gradio on ZeroGPU Spaces.
import gradio as gr

from backend.app import API_VERSION, create_app


# preload=True: the embedding and OCR models load in a background thread as
# soon as the Space starts, so /api/status reports "ready" before the first
# visitor and the first upload does not carry the model download.
api = create_app(preload=True, app_factory=gr.Server,
                 route_prefix='/study-api', public_prefix='/api')


def backend_status() -> dict:
    """Return the capabilities that the matching Study Companion frontend checks."""
    services = api.state.services
    settings = services.settings
    return {
        'status': 'ok',
        'apiVersion': API_VERSION,
        'name': 'Study Companion',
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
#study-demo { max-width: 880px; margin: 0 auto; }
.dark .gradio-container { color: var(--body-text-color); }
"""

with gr.Blocks() as demo:
    with gr.Column(elem_id='study-demo'):
        gr.Markdown(
            f"""# 📓 Study Companion API

The live backend for a student's own notes: upload, section-aware and
fixed-length chunking, hybrid retrieval, streamed cited explanations, and
quizzes and flashcards checked against the notes. Its API contract is locked
to the matching Next.js frontend.

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
demo.launch(_app=api, ssr_mode=False, theme=gr.themes.Soft(primary_hue='indigo'), css=CSS)

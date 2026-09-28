"""Gradio demo served by the Campus Guide FastAPI backend."""
from __future__ import annotations

import spaces  # Must precede Gradio on ZeroGPU Spaces.
import gradio as gr

from backend.app import API_VERSION, create_app


api = create_app(preload=False, app_factory=gr.Server,
                 route_prefix='/campus-api', public_prefix='/api')


def backend_status() -> dict:
    """Return the capabilities that the matching Campus Guide frontend checks."""
    services = api.state.services
    settings = services.settings
    return {
        'status': 'ok',
        'apiVersion': API_VERSION,
        'name': 'Campus Guide',
        'generation': services.model is not None,
        'model': settings.model,
        'provider': 'AgentRouter',
        'apiDocs': '/api/docs',
    }


@spaces.GPU(duration=1)
def zero_gpu_marker() -> str:
    """ZeroGPU registration marker; the backend itself stays on CPU."""
    return 'registered'


CSS = """
#campus-demo { max-width: 880px; margin: 0 auto; }
.dark .gradio-container { color: var(--body-text-color); }
"""

with gr.Blocks() as demo:
    with gr.Column(elem_id='campus-demo'):
        gr.Markdown(
            f"""# 🎓 Campus Guide API

The live backend for document upload, hybrid retrieval, and streamed cited
answers. Its API contract is locked to the matching Next.js frontend.

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
demo.launch(_app=api, ssr_mode=False, theme=gr.themes.Citrus(), css=CSS)

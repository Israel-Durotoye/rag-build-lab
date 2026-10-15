"""Server-only configuration, read from the environment and ``.env.local``."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse

DEMO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = 'https://agentrouter.org/v1'
DEFAULT_MODEL = 'deepseek-v4-flash'
DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5'
# AgentRouter only serves requests that identify as one of its supported CLI
# clients; other providers ignore the header.
DEFAULT_USER_AGENT = 'claude-cli/2.0.1 (external, cli)'


def load_env_file() -> None:
    """Load demos/03-manual-finder/.env.local; real environment variables win."""
    from dotenv import load_dotenv

    load_dotenv(DEMO_DIR / '.env.local', override=False)


def _flag(value: str | None, default: bool) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in {'off', '0', 'false', 'no'}


def _text(env: Mapping[str, str], *keys: str) -> str:
    """The first of ``keys`` that is set. The AGENTROUTER_* names the other
    sites use are accepted after the MANUAL_* ones, so one .env.local serves all."""
    for key in keys:
        value = env.get(key, '').strip()
        if value:
            return value
    return ''


def _number(env: Mapping[str, str], keys: tuple[str, ...], default: float, low: float, high: float) -> float:
    key = next((k for k in keys if env.get(k, '').strip()), keys[0])
    raw = env.get(key, '').strip()
    try:
        value = float(raw) if raw else default
    except ValueError:
        raise ValueError(f'{key} must be a number') from None
    if not low <= value <= high:
        raise ValueError(f'{key} must be between {low:g} and {high:g}')
    return value


@dataclass(frozen=True)
class Settings:
    api_key: str
    model: str
    fallback_models: tuple[str, ...]
    base_url: str
    timeout: float
    retries: int
    user_agent: str
    ocr_enabled: bool
    embeddings_enabled: bool
    embedding_model: str
    data_dir: Path
    embedding_dir: Path
    max_documents: int
    workspace_ttl_days: float

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> 'Settings':
        data_dir = Path(env.get('MANUAL_DATA_DIR', '').strip() or DEMO_DIR / '.state')
        fallbacks = _text(env, 'MANUAL_MODEL_FALLBACKS', 'AGENTROUTER_FALLBACK_MODELS')
        return cls(
            api_key=_text(env, 'MANUAL_MODEL_API_KEY', 'AGENTROUTER_API_KEY'),
            model=_text(env, 'MANUAL_MODEL', 'AGENTROUTER_MODEL') or DEFAULT_MODEL,
            fallback_models=tuple(m.strip() for m in fallbacks.split(',') if m.strip()),
            base_url=_text(env, 'MANUAL_MODEL_BASE_URL', 'AGENTROUTER_BASE_URL') or DEFAULT_BASE_URL,
            timeout=_number(env, ('MANUAL_MODEL_TIMEOUT_MS', 'AGENTROUTER_TIMEOUT_MS'), 60000, 1000, 120000) / 1000,
            retries=int(_number(env, ('MANUAL_MODEL_RETRIES', 'AGENTROUTER_RETRIES'), 2, 0, 5)),
            user_agent=_text(env, 'MANUAL_MODEL_USER_AGENT', 'AGENTROUTER_USER_AGENT') or DEFAULT_USER_AGENT,
            ocr_enabled=_flag(env.get('MANUAL_OCR'), True),
            embeddings_enabled=_flag(env.get('MANUAL_EMBEDDINGS'), True),
            embedding_model=env.get('MANUAL_EMBEDDING_MODEL', '').strip() or DEFAULT_EMBEDDING_MODEL,
            data_dir=data_dir,
            # Embedding weights can live apart from the data (e.g. baked into a container image).
            embedding_dir=Path(env.get('MANUAL_EMBEDDING_DIR', '').strip() or data_dir / 'models'),
            max_documents=int(_number(env, ('MANUAL_MAX_DOCUMENTS',), 16, 1, 60)),
            workspace_ttl_days=_number(env, ('MANUAL_WORKSPACE_TTL_DAYS',), 7, 0.01, 365),
        )

    @property
    def generation(self) -> bool:
        return bool(self.api_key)

    @property
    def provider(self) -> str:
        """The host the model is reached through, for display."""
        return urlparse(self.base_url).hostname or 'model provider'

    def model_client(self):
        """An OpenAI-compatible chat client with retries and optional
        fallbacks, or None when no key is configured (source-search mode)."""
        if not self.api_key:
            return None
        from rag_core.providers import OpenAICompatible

        return OpenAICompatible(self.model, self.api_key, self.base_url, self.timeout,
                                {'User-Agent': self.user_agent}, max_tokens=3000,
                                fallback_models=self.fallback_models, retries=self.retries)

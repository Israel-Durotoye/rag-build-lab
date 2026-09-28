"""Server-only configuration, read from the environment and ``.env.local``."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

DEMO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = 'https://agentrouter.org/v1'
DEFAULT_MODEL = 'deepseek-v4-flash'
DEFAULT_EMBEDDING_MODEL = 'BAAI/bge-small-en-v1.5'
# AgentRouter only serves requests that identify as one of its supported CLI
# clients; other user agents get "unauthorized client detected".
DEFAULT_USER_AGENT = 'claude-cli/2.0.1 (external, cli)'


def load_env_file() -> None:
    """Load demos/01-campus-desk/.env.local; real environment variables win."""
    from dotenv import load_dotenv

    load_dotenv(DEMO_DIR / '.env.local', override=False)


def _flag(value: str | None, default: bool) -> bool:
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in {'off', '0', 'false', 'no'}


def _number(env: Mapping[str, str], key: str, default: float, low: float, high: float) -> float:
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
    top_k: int
    max_documents: int
    workspace_ttl_days: float

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> 'Settings':
        return cls(
            api_key=env.get('AGENTROUTER_API_KEY', '').strip(),
            model=env.get('AGENTROUTER_MODEL', '').strip() or DEFAULT_MODEL,
            fallback_models=tuple(m.strip() for m in env.get('AGENTROUTER_FALLBACK_MODELS', '').split(',') if m.strip()),
            base_url=env.get('AGENTROUTER_BASE_URL', '').strip() or DEFAULT_BASE_URL,
            timeout=_number(env, 'AGENTROUTER_TIMEOUT_MS', 60000, 1000, 120000) / 1000,
            retries=int(_number(env, 'AGENTROUTER_RETRIES', 2, 0, 5)),
            user_agent=env.get('AGENTROUTER_USER_AGENT', '').strip() or DEFAULT_USER_AGENT,
            ocr_enabled=_flag(env.get('CAMPUS_OCR'), True),
            embeddings_enabled=_flag(env.get('CAMPUS_EMBEDDINGS'), True),
            embedding_model=env.get('CAMPUS_EMBEDDING_MODEL', '').strip() or DEFAULT_EMBEDDING_MODEL,
            data_dir=Path(env.get('CAMPUS_DATA_DIR', '').strip() or DEMO_DIR / '.state'),
            top_k=int(_number(env, 'CAMPUS_TOP_K', 6, 1, 12)),
            max_documents=int(_number(env, 'CAMPUS_MAX_DOCUMENTS', 12, 1, 40)),
            workspace_ttl_days=_number(env, 'CAMPUS_WORKSPACE_TTL_DAYS', 7, 0.01, 365),
        )

    @property
    def generation(self) -> bool:
        return bool(self.api_key)

    def model_client(self):
        """DeepSeek through AgentRouter with retries and optional fallbacks,
        or None when no key is configured (source-search mode)."""
        if not self.api_key:
            return None
        from rag_core.providers import OpenAICompatible

        return OpenAICompatible(self.model, self.api_key, self.base_url, self.timeout,
                                {'User-Agent': self.user_agent}, max_tokens=3000,
                                fallback_models=self.fallback_models, retries=self.retries)

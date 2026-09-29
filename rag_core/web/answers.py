"""Checks and helpers around a model's reply: citation markers, follow-up
rewriting and JSON replies."""
from __future__ import annotations

import json
import re
from time import perf_counter

from ..providers import ProviderError

CITATION = re.compile(r'\[(\d+(?:\s*[,–-]\s*\d+)*)\]')
FOLLOW_UP = re.compile(
    r"\b(it|its|it's|they|them|their|this|that|these|those|he|she|his|her|there|same|above|previous|more|else|"
    r"again|also|too|instead|why|example|simpl\w*|explain|elaborate|clarify|summari[sz]e)\b|^(and|but|so|what about|"
    r"how about|and what|what if|then)\b", re.I)


def parse_citations(text: str, passage_count: int) -> tuple[str, list[int], list[int]]:
    """Return (text with only valid markers, valid numbers in order of first
    use, invalid numbers). Ranges like [2-4] and lists like [1, 3] are
    normalised to separate markers: [2][3][4]."""
    valid: list[int] = []
    invalid: list[int] = []

    def replace(match: re.Match) -> str:
        numbers: list[int] = []
        for part in re.split(r'\s*,\s*', match.group(1)):
            bounds = re.split(r'\s*[–-]\s*', part)
            if len(bounds) == 2 and bounds[0].isdigit() and bounds[1].isdigit():
                low, high = int(bounds[0]), int(bounds[1])
                numbers.extend(range(low, high + 1) if 0 < high - low < 20 else [low, high])
            elif part.isdigit():
                numbers.append(int(part))
        kept = []
        for number in numbers:
            if 1 <= number <= passage_count:
                kept.append(number)
                if number not in valid:
                    valid.append(number)
            elif number not in invalid:
                invalid.append(number)
        return ''.join(f'[{n}]' for n in dict.fromkeys(kept))

    cleaned = CITATION.sub(replace, text)
    # Tidy gaps left by removed markers, keeping leading (list) indentation.
    cleaned = re.sub(r'(?<=\S)[ \t]{2,}', ' ', cleaned)
    cleaned = re.sub(r'[ \t]+([.,;:!?])', r'\1', cleaned)
    return cleaned.strip(), valid, invalid


def needs_rewrite(message: str, history: list[dict]) -> bool:
    """Follow-ups that lean on earlier turns ("what about 200 level?",
    "explain it simply") need rewriting before they can be searched."""
    if not any(item.get('role') == 'user' for item in history):
        return False
    return len(message.split()) <= 6 or bool(FOLLOW_UP.search(message))


REWRITE_PROMPT = ("You turn a follow-up message into a standalone search query for a document search engine. "
                  "Use the conversation to resolve references such as 'it', 'that' or 'what about ...'. "
                  "Keep the user's key terms and add the topic they refer to. "
                  "Reply with the query only: one line, no quotes, no explanation.")


def rewrite_query(model, history: list[dict], message: str) -> dict:
    """Standalone query for retrieval, with how it was produced."""
    started = perf_counter()
    turns = [f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content'][:500]}" for m in history[-6:]]
    heuristic = next((m['content'] for m in reversed(history) if m['role'] == 'user'), '')
    heuristic = f'{heuristic} {message}'.strip()
    if model is None:
        return {'query': heuristic, 'method': 'previous question + message', 'ms': 0.0}
    try:
        reply = model.complete([
            {'role': 'system', 'content': REWRITE_PROMPT},
            {'role': 'user', 'content': 'Conversation:\n' + '\n'.join(turns) + f'\n\nFollow-up: {message}\n\nStandalone query:'},
        ], max_tokens=800, temperature=0)
        query = reply['content'].strip().split('\n')[0].strip().strip('"“”\'')[:300]
        if not query:
            raise ValueError('empty rewrite')
        return {'query': query, 'method': 'model', 'model': reply['model'],
                'ms': round((perf_counter() - started) * 1000, 1)}
    except (ProviderError, ValueError) as error:
        return {'query': heuristic, 'method': 'previous question + message', 'error': str(error),
                'ms': round((perf_counter() - started) * 1000, 1)}


def json_reply(content: str):
    """Parse a model's JSON reply, with or without a Markdown code fence."""
    content = content.strip()
    fenced = re.fullmatch(r'```(?:json)?\s*(.*?)\s*```', content, re.S)
    return json.loads(fenced.group(1) if fenced else content)

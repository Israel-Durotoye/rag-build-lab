"""The twelve labelled queries through keyword, semantic and hybrid search.

    .venv/bin/python compare_modes.py            # from demos/03-manual-finder
    .venv/bin/python compare_modes.py --k 5 --constant 60

Loads the sample library into a temporary workspace (with the FastEmbed model
the website uses, from MANUAL_EMBEDDING_DIR or .state/models; without it,
semantic and hybrid fall back to keyword search and the run says so), runs
queries.json in every mode with the website's own code, and writes:

    runs/modes-keyword.json, runs/modes-semantic.json, runs/modes-hybrid.json
        for each query: the ranked passage IDs, whether an expected passage is
        in the top k, its rank, and how many top-k passages belong to another
        model (which the model filter should keep at zero)
    runs/summary.json
        hit counts per mode, the exact-code lookup (measured apart from the
        modes), how often Finder asked when it should, and the settings

These are actual results on twelve questions over one library: a small check,
not a benchmark. Nothing is declared a winner.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEMO = Path(__file__).resolve().parent
sys.path.insert(0, str(DEMO))
sys.path.insert(0, str(DEMO.parents[1]))

from rag_core.web.embeddings import get_embedder  # noqa: E402
from rag_core.web.retrieval import MODES  # noqa: E402

from backend import evaluation  # noqa: E402
from backend.ingest import load_sample, sample_queries  # noqa: E402
from backend.settings import DEFAULT_EMBEDDING_MODEL, Settings  # noqa: E402
from backend.store import DocumentStore  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--k', type=int, default=5)
    parser.add_argument('--constant', type=int, default=60)
    parser.add_argument('--keyword-only', action='store_true', help='skip the embedding model')
    args = parser.parse_args()
    settings = Settings.from_env()
    embedder = None if args.keyword_only else get_embedder(
        True, settings.embedding_model or DEFAULT_EMBEDDING_MODEL, settings.embedding_dir)
    with tempfile.TemporaryDirectory() as folder:
        store = DocumentStore(Path(folder))
        workspace = store.workspace('0' * 32)
        load_sample(workspace, embedder, max_documents=50)
        run = evaluation.run(workspace, sample_queries(), modes=list(MODES), k=args.k, constant=args.constant,
                             embedder=embedder)
        store.close()
    out = DEMO / 'runs'
    out.mkdir(exist_ok=True)
    for mode in MODES:
        rows = [{'id': r['id'], 'query': r['query'], 'kind': r['kind'], 'model': r['model'],
                 'revision': r['revision'], 'expected': r['expected'], **r['modes'][mode]} for r in run['rows']]
        (out / f'modes-{mode}.json').write_text(json.dumps(rows, indent=1, ensure_ascii=False) + '\n')
    summary = {
        'createdAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'k': run['k'], 'constant': run['constant'], 'tieBreak': 'best-rank',
        'embedder': run['embedder'] or 'none (semantic and hybrid fell back to keyword search)',
        'corpusVersion': run['corpusVersion'], 'queries': len(run['rows']),
        'totals': run['totals'], 'lookup': run['lookup'], 'clarification': run['clarification'],
        'lookalike': run['lookalike'],
        'rows': [{'id': r['id'], 'kind': r['kind'], 'model': r['model'], 'asked': r['asked'], 'reason': r['reason'],
                  'candidatesOk': r['candidatesOk'], 'lookup': r['lookup'],
                  'ranks': {m: r['modes'][m]['rank'] for m in r['modes']},
                  'wrongModel': {m: r['modes'][m]['wrongModel'] for m in r['modes']},
                  'lookalike': {m: r['modes'][m]['lookalike'] for m in r['modes']}} for r in run['rows']],
        'scope': run['scope'],
    }
    (out / 'summary.json').write_text(json.dumps(summary, indent=1, ensure_ascii=False) + '\n')
    for mode, total in run['totals'].items():
        print(f"{mode:9} {total['hits']} of {total['of']} answerable queries with an expected passage in the top {args.k}")
    print(f"lookup    {run['lookup']['hits']} of {run['lookup']['of']} exact-code lookups found the expected passage")
    print(f"asked     {run['clarification']['asked']} of {run['clarification']['of']} ambiguous queries, with the right choices")
    found = ', '.join(f'{mode} {count}' for mode, count in run['lookalike']['found'].items())
    print(f"look-alike passages labelled by hand in a top {args.k} ({run['lookalike']['queries']} queries): {found}")
    print(f"embedder  {summary['embedder']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())

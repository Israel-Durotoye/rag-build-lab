"""Run the same eight questions with section-aware and fixed-length chunking.

Writes one JSON file per chunking mode. It records what each run retrieved and
does not pick a winner: read the per-question differences yourself.

    python demos/02-study-companion/compare_chunking.py [--no-expand] [--out DIR]
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import sqlite3
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))
from rag_core.pipeline import Pipeline, load_config  # noqa: E402
from rag_core.study import StudyCompanion  # noqa: E402


def run(chunk_mode, expand=True):
    config = load_config(HERE / 'config.json')
    # Offline on purpose: the runs compare retrieval and context, not a model.
    companion = StudyCompanion(Pipeline(config))
    companion.ingest(chunk_mode)
    rows = []
    try:
        for case in json.loads((HERE / 'questions.json').read_text()):
            conversation = {'topic_question': case['previous'], 'followups_used': 0} if case.get('previous') else None
            r = companion.ask(case['question'], conversation, expand=expand)
            retrieved_sections = list(dict.fromkeys(c['metadata']['section'] for c in r['retrieved']))
            context_sections = [i['section_id'] for i in r['context']]
            expected = case.get('expected_sections', [])
            explanation = ' '.join(s['text'] for s in (r['explanation'] or {}).get('sentences', []))
            row = {'id': case['id'], 'category': case['category'], 'question': case['question'],
                   'retrieval_query': r.get('retrieval_query'), 'status': r['status'],
                   'retrieved_chunk_ids': [c['id'] for c in r['retrieved']], 'retrieved_sections': retrieved_sections,
                   'context_ids': [i['id'] for i in r['context']], 'expanded_ids': [i['id'] for i in r['context'] if i['expanded']],
                   'context_words': r.get('context_budget', {}).get('used_words', 0),
                   'budget_skips': r.get('context_budget', {}).get('skipped', [])}
            if expected:
                row['expected_sections'] = expected
                row['expected_sections_in_context'] = [s for s in expected if s in context_sections]
            if case.get('expected_status'):
                row['expected_status'] = case['expected_status']
                row['status_matches'] = r['status'] == case['expected_status']
            if case.get('exception_check'):
                phrase = case['exception_check']
                row['exception_phrase'] = phrase
                row['exception_in_retrieved_chunks'] = any(phrase in c['text'] for c in r['retrieved'])
                row['exception_in_context'] = any(phrase in i['text'] for i in r['context'])
                row['exception_in_extractive_explanation'] = phrase in explanation
            rows.append(row)
        return {'chunk_mode': chunk_mode, 'expansion_enabled': expand, 'retrieval_mode': 'keyword',
                'chunk_words': config.get('chunk_words', 120) if chunk_mode == 'fixed' else None,
                'k': companion.k, 'context_budget_words': companion.budget, 'expand_below_words': companion.expand_below,
                'corpus_version': companion.pipe.index.version, 'run_at': datetime.now(timezone.utc).isoformat(),
                'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version,
                'scope': 'Eight authored questions over one synthetic notes file. Not a benchmark; no winner is declared.',
                'questions': rows}
    finally:
        companion.pipe.index.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--no-expand', action='store_true', help='Disable parent-section expansion')
    parser.add_argument('--out', default=str(HERE / 'runs'))
    args = parser.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    suffix = '-no-expansion' if args.no_expand else ''
    for mode in ('section', 'fixed'):
        report = run(mode, expand=not args.no_expand)
        path = out / f'chunking-{mode}{suffix}.json'
        path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
        q = report['questions']
        print(json.dumps({'file': str(path), 'questions': len(q),
                          'all_expected_sections_in_context': sum(r.get('expected_sections_in_context') == r.get('expected_sections') for r in q if 'expected_sections' in r),
                          'with_expected_sections': sum('expected_sections' in r for r in q),
                          'mean_context_words': round(sum(r['context_words'] for r in q) / len(q), 1)}))


if __name__ == '__main__':
    main()

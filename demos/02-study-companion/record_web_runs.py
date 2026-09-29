"""Record what the running website does with the sample notes.

Loads the sample notes into a fresh workspace of a running backend, then:

* runs the same eight questions against both chunkings (``/api/compare``) and
  writes ``runs/web-compare-<mode>.json``. No model is involved and no winner
  is picked: read the per-question differences yourself;
* if the backend has a model, asks the exception question in every
  combination of chunking and expansion, and once as a follow-up
  (``/api/ask``), and writes the replies word for word to
  ``runs/web-exception-check.json`` so they can be read and judged.

    python demos/02-study-companion/record_web_runs.py [--base http://127.0.0.1:8001] [--out DIR]

Uses only the standard library. The workspace is emptied afterwards.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
QUESTIONS = json.loads((HERE / 'questions.json').read_text())
EXCEPTION = 'does not guarantee stability'
# Wordings that keep the exception. A reply is only *flagged* by this check;
# whether it misleads is for a reader to judge from the text.
KEEPS = ('not guarantee', "n't guarantee", 'no guarantee', 'not guaranteed')


class Backend:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.workspace = secrets.token_hex(16)

    def call(self, path, body=None, method=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'X-Workspace-Id': self.workspace}
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, data=data, headers=headers,
                                         method=method or ('POST' if body is not None else 'GET'))
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return response.read().decode()
        except urllib.error.HTTPError as error:
            raise SystemExit(f'{method or "POST"} {path} returned HTTP {error.code}: {error.read().decode()[:300]}')

    def json(self, path, body=None, method=None):
        return json.loads(self.call(path, body, method))

    def events(self, path, body):
        return [json.loads(line) for line in self.call(path, body).splitlines() if line.strip()]


def query_for(case):
    return f"{case['previous']}\nFollow-up: {case['question']}" if case.get('previous') else case['question']


def compare_runs(backend, mode, status, settings):
    rows = []
    for case in QUESTIONS:
        result = backend.json('/api/compare', {'query': query_for(case), 'mode': mode, 'expand': True})
        row = {'id': case['id'], 'category': case['category'], 'question': case['question'],
               'retrieval_query': result['query']}
        for chunking, run in result['runs'].items():
            sections = [key.split(':', 1)[1] for key in run['sections']]
            entry = {'search_used': run['mode'], 'retrieved_chunk_ids': [c['id'] for c in run['retrieved']],
                     'context_ids': [i['id'] for i in run['context']], 'context_sections': sections,
                     'expanded': run['expanded'], 'context_words': run['budget']['usedWords'],
                     'budget_skips': run['budget']['skipped'], 'matched_by_meaning_only': run['weak']}
            if case.get('expected_sections'):
                entry['expected_sections_in_context'] = [s for s in case['expected_sections'] if s in sections]
            if case.get('exception_check'):
                entry['exception_in_context'] = any(case['exception_check'] in i['text'] for i in run['context'])
                entry['exception_among_caveats'] = any(case['exception_check'] in c['text'] for c in run['caveats'])
            row[chunking] = entry
        if case.get('expected_sections'):
            row['expected_sections'] = case['expected_sections']
        if case.get('expected_status'):
            row['expected_status'] = case['expected_status']
        row['only_section_aware'] = result['agreement']['sectionOnly']
        row['only_fixed_length'] = result['agreement']['fixedOnly']
        rows.append(row)
    return {'requested_search': mode, 'options': result['options'], 'expansion_enabled': True,
            'embedding_model': status['embeddings']['model'] if status['embeddings']['status'] == 'ready' else None,
            'run_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'scope': 'Eight authored questions over one synthetic notes file, with the settings above. '
                     'Not a benchmark; no winner is declared.',
            'questions': rows}


def exception_check(backend, status):
    checks = [{'chunking': c, 'expand': e, 'message': 'Does negative feedback guarantee stability?', 'earlier': []}
              for c in ('section', 'fixed') for e in (True, False)]
    checks.append({'chunking': 'fixed', 'expand': True, 'message': 'Does it guarantee stability?',
                   'earlier': ['What is negative feedback?']})
    rows = []
    for check in checks:
        events = backend.events('/api/ask', {**check, 'mode': 'hybrid'})
        done = events[-1]
        if done.get('type') != 'done':
            raise SystemExit(f'the answer stream ended without a result: {done}')
        retrieval = next(e for e in events if e['type'] == 'retrieval')['trace']
        answer = done['answer'] or ''
        rows.append({
            **check, 'retrieval_query': retrieval['query'], 'query_written_by': retrieval['rewrite']['method'],
            'status': done['status'], 'model': done['generation']['model'],
            'answer': answer,
            'answer_has_a_keeping_phrase': any(phrase in answer.lower() for phrase in KEEPS),
            'citations': done['generation']['citations'],
            'exception_in_supporting_sections': any(EXCEPTION in s['text'] for s in done['sources']),
            'exception_among_caveats': any(EXCEPTION in c['text'] for c in done['caveats']),
            'sections': [{'n': s['n'], 'id': s['id'], 'expanded': s['expanded'], 'words': s['words']}
                         for s in done['sources']],
            'usage': done['generation']['usage'], 'error': done['generation']['error'],
        })
    return {'model': status['model'], 'provider': status['provider'],
            'run_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'how_to_read': 'answer_has_a_keeping_phrase only looks for wordings such as "not guarantee". '
                           'Read each answer: it must not say or imply that negative feedback always makes '
                           'a system stable.',
            'checks': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--base', default='http://127.0.0.1:8001', help='the backend, or a frontend that proxies to it')
    parser.add_argument('--out', default=str(HERE / 'runs'))
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    backend = Backend(args.base)
    status = backend.json('/api/status')
    backend.json('/api/sample', {})
    try:
        modes = ['keyword'] + (['hybrid'] if status['embeddings']['status'] == 'ready' else [])
        for mode in modes:
            run = compare_runs(backend, mode, status, None)
            (out / f'web-compare-{mode}.json').write_text(json.dumps(run, indent=2, ensure_ascii=False) + '\n')
            reached = {c: sum(1 for r in run['questions'] if r.get('expected_sections')
                              and len(r[c]['expected_sections_in_context']) == len(r['expected_sections']))
                       for c in ('section', 'fixed')}
            print(f'{mode}: expected sections all in context for section-aware {reached["section"]}/7, '
                  f'fixed-length {reached["fixed"]}/7')
        if status['generation']:
            check = exception_check(backend, status)
            (out / 'web-exception-check.json').write_text(json.dumps(check, indent=2, ensure_ascii=False) + '\n')
            for row in check['checks']:
                print(f"{row['chunking']:8} expand={str(row['expand']):5} {row['status']:9} "
                      f"keeping phrase: {row['answer_has_a_keeping_phrase']}  {row['message']}")
        else:
            print('no model on this backend: the exception check was not run')
    finally:
        for document in backend.json('/api/documents')['documents']:
            backend.call(f"/api/documents/{document['id']}", method='DELETE')
    print('wrote', ', '.join(sorted(p.name for p in out.glob('web-*.json'))), 'to', out)


if __name__ == '__main__':
    main()

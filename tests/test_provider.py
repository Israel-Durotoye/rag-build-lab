"""HTTP contract test only: this server is a test double, not an LLM."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from rag_core.providers import Ollama
from rag_core.core import Chunk


def test_ollama_http_contract():
    received=[]
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.path,json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
            payload={'message':{'content':json.dumps({'answer':'Example','citations':['s1'],'insufficient':False})},'prompt_eval_count':12,'eval_count':3}
            body=json.dumps(payload).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=HTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        adapter=Ollama('test-only-model',host=f'http://127.0.0.1:{server.server_port}',timeout=2)
        result=adapter.generate('Question',[Chunk('s1','d1','Title','Evidence','section',{})])
        assert result['citations']==['s1'];assert result['usage']['eval_count']==3
        path,body=received[0];assert path=='/api/chat';assert body['stream'] is False;assert body['format']=='json'
        assert body['model']=='test-only-model';assert 'untrusted_sources' in body['messages'][1]['content']
    finally:server.shutdown();server.server_close();thread.join()


from types import SimpleNamespace as NS


TRUNCATED = object()  # a reply cut off by max_tokens before any content


class _HTTPError(Exception):
    def __init__(self, status_code):
        super().__init__(f'status {status_code} secret-key-in-message')
        self.status_code = status_code


class _RawPage(str):
    """What the openai SDK hands back when the endpoint answers with a non-JSON
    body (a firewall challenge page): the text itself, not a completion."""


class _FakeCompletions:
    """Scripted replies: each item is content (str), an exception, or a list of stream deltas."""
    def __init__(self, *script):
        self.script, self.calls = list(script), []
    def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0) if len(self.script) > 1 else self.script[0]
        if isinstance(item, Exception): raise item
        if isinstance(item, _RawPage): return str(item)
        if kwargs.get('stream'):
            return self._stream(item)
        usage = NS(prompt_tokens=40, completion_tokens=9, total_tokens=49, completion_tokens_details=NS(reasoning_tokens=5))
        finish = 'length' if item == TRUNCATED else 'stop'
        content = '' if item == TRUNCATED else item
        return NS(choices=[NS(message=NS(content=content, reasoning_content='thinking'), finish_reason=finish)], usage=usage)
    @staticmethod
    def _stream(item):
        for part in item:
            if isinstance(part, Exception): raise part
            kind, text = part
            delta = NS(content=text if kind == 'token' else None, reasoning_content=text if kind == 'reasoning' else None)
            yield NS(choices=[NS(delta=delta, finish_reason=None)], usage=None)
        yield NS(choices=[NS(delta=NS(content=None, reasoning_content=None), finish_reason='stop')], usage=None)
        yield NS(choices=[], usage=NS(prompt_tokens=10, completion_tokens=4, total_tokens=14, completion_tokens_details=None))


def _client(completions):
    return NS(chat=NS(completions=completions))


def _adapter(fake, **kwargs):
    from rag_core.providers import OpenAICompatible
    return OpenAICompatible('deepseek-v4-flash', client=_client(fake), sleep=lambda seconds: None, **kwargs)


def test_openai_compatible_contract_and_fenced_json():
    fake = _FakeCompletions('```json\n' + json.dumps({'answer': 'Example', 'citations': ['s1'], 'insufficient': False}) + '\n```')
    result = _adapter(fake).generate('Question', [Chunk('s1', 'd1', 'Title', 'Evidence', 'p. 1', {})])
    assert result['citations'] == ['s1'] and result['usage']['completion_tokens'] == 9
    call = fake.calls[0]
    assert call['model'] == 'deepseek-v4-flash' and call['temperature'] == 0 and call['stream'] is False
    assert call['response_format'] == {'type': 'json_object'}
    user = json.loads(call['messages'][1]['content'])
    assert user['untrusted_sources'] == [{'id': 's1', 'title': 'Title', 'text': 'Evidence'}]


def test_openai_compatible_hides_provider_errors_and_rejects_bad_output():
    import pytest
    from rag_core.providers import OpenAICompatible, ProviderError
    source = [Chunk('s1', 'd1', 'Title', 'Evidence', 'p. 1', {})]
    with pytest.raises(ProviderError) as info:
        _adapter(_FakeCompletions(RuntimeError('secret-key-in-message'))).generate('q', source)
    assert 'secret' not in str(info.value)
    for content in ['', '[1, 2]', 'not json']:
        with pytest.raises((ValueError, OSError)):
            _adapter(_FakeCompletions(content)).generate('q', source)
    with pytest.raises(ValueError):
        OpenAICompatible('m', base_url='file:///tmp/x', client=_client(_FakeCompletions('{}')))
    with pytest.raises(ValueError):
        OpenAICompatible('', client=_client(_FakeCompletions('{}')))


def test_complete_retries_transient_failures_then_succeeds():
    fake = _FakeCompletions(_HTTPError(429), _HTTPError(503), 'Recovered')
    reply = _adapter(fake).complete([{'role': 'user', 'content': 'hi'}])
    assert reply['content'] == 'Recovered' and reply['reasoning'] == 'thinking'
    assert [a['ok'] for a in reply['attempts']] == [False, False, True]
    assert reply['attempts'][0]['reason'] == 'rate limited (HTTP 429)'
    assert reply['usage']['reasoning_tokens'] == 5


def test_complete_falls_back_to_the_next_model_and_names_the_failure():
    import pytest
    from rag_core.providers import ProviderError
    fake = _FakeCompletions(_HTTPError(404), 'From fallback')
    reply = _adapter(fake, fallback_models=['backup-model']).complete([{'role': 'user', 'content': 'hi'}])
    assert reply['model'] == 'backup-model' and [c['model'] for c in fake.calls] == ['deepseek-v4-flash', 'backup-model']
    with pytest.raises(ProviderError, match='key rejected'):
        _adapter(_FakeCompletions(_HTTPError(401))).complete([{'role': 'user', 'content': 'hi'}])


def test_stream_separates_reasoning_from_answer_tokens():
    fake = _FakeCompletions([('reasoning', 'Let me check. '), ('token', 'You get '), ('token', '21 days [1].')])
    events = list(_adapter(fake).stream([{'role': 'user', 'content': 'q'}]))
    kinds = [e['type'] for e in events]
    assert kinds == ['attempt', 'reasoning', 'token', 'token', 'end']
    assert ''.join(e['delta'] for e in events if e['type'] == 'token') == 'You get 21 days [1].'
    assert events[-1]['usage']['completion_tokens'] == 4 and events[-1]['finish_reason'] == 'stop'
    assert fake.calls[0]['stream'] is True and fake.calls[0]['stream_options'] == {'include_usage': True}


def test_stream_retries_before_the_first_token_but_not_after():
    import pytest
    from rag_core.providers import ProviderError
    fake = _FakeCompletions([('reasoning', 'hmm'), _HTTPError(502)], [('token', 'Answer')])
    kinds = [e['type'] for e in _adapter(fake).stream([{'role': 'user', 'content': 'q'}])]
    assert kinds == ['attempt', 'reasoning', 'retry', 'attempt', 'token', 'end']
    broken = _FakeCompletions([('token', 'Half an ans'), _HTTPError(502)])
    with pytest.raises(ProviderError, match='mid-answer'):
        list(_adapter(broken).stream([{'role': 'user', 'content': 'q'}]))
    empty = _FakeCompletions([])
    with pytest.raises(ProviderError, match='empty reply'):
        list(_adapter(empty, retries=1).stream([{'role': 'user', 'content': 'q'}]))


def test_keyword_matches_explain_scores_and_stemmed_terms():
    from rag_core.core import Index
    index = Index(stemming=True)
    index.replace([{'id': 'h', 'title': 'H', 'sections': [
        {'id': 'exams', 'title': 'Examinations', 'text': 'Students who failed an exam must resit it.'},
        {'id': 'library', 'title': 'Library', 'text': 'The library opens at eight.'}]}])
    hits = index.keyword_matches('What if I fail my exams?')
    assert [h['chunk'].id for h in hits] == ['h:exams:0']
    assert hits[0]['score'] > 0 and set(hits[0]['terms']) == {'fail', 'exams'}
    assert Index().keyword_matches('fail') == []


def test_pipeline_indexes_supplied_documents_instead_of_corpus():
    from rag_core.pipeline import Pipeline
    docs = [{'id': 'upload', 'title': 'Staff manual', 'version': '1', 'metadata': {},
             'sections': [{'id': 'leave', 'title': 'Leave', 'text': 'Staff earn 21 days of annual leave.', 'location': 'p. 2'}]}]
    pipe = Pipeline({'kind': 'campus'}, documents=docs)
    result = pipe.ask('How many days of annual leave?')
    assert result['status'] == 'sources_found'
    assert [s['id'] for s in result['sources']] == ['upload:leave:0']
    pipe.ingest()
    assert [c.id for c in pipe.index.chunks()] == ['upload:leave:0']


def test_a_reply_cut_off_while_thinking_is_retried_with_a_bigger_budget():
    fake = _FakeCompletions(TRUNCATED, TRUNCATED, 'Done')
    reply = _adapter(fake, max_tokens=1000).complete([{'role': 'user', 'content': 'hi'}])
    assert reply['content'] == 'Done'
    assert [c['max_tokens'] for c in fake.calls] == [1000, 2000, 4000]
    assert reply['attempts'][0]['reason'] == 'ran out of tokens while thinking (1000)'
    # Streaming grows the budget the same way when the stream ends by length with no text.
    fake = _FakeCompletions([('reasoning', 'deep thought')], [('token', 'Answer')])
    fake._stream = lambda parts, _orig=fake._stream: _orig(parts) if parts and parts[0][0] == 'token' else _length_stream(parts)
    events = list(_adapter(fake, max_tokens=1000).stream([{'role': 'user', 'content': 'q'}]))
    assert [e['type'] for e in events] == ['attempt', 'reasoning', 'retry', 'attempt', 'token', 'end']
    assert events[2]['reason'].startswith('ran out of tokens') and fake.calls[1]['max_tokens'] == 2000


def _length_stream(parts):
    for kind, text in parts:
        delta = NS(content=None, reasoning_content=text)
        yield NS(choices=[NS(delta=delta, finish_reason=None)], usage=None)
    yield NS(choices=[NS(delta=NS(content=None, reasoning_content=None), finish_reason='length')], usage=None)


def test_a_firewall_page_instead_of_a_completion_is_named_logged_and_retried(caplog):
    import logging
    import pytest
    from rag_core.providers import ProviderError
    page = _RawPage('<!doctype html> <meta name="aliyun_waf_aa" content="x"> <script>challenge()</script>')
    with caplog.at_level(logging.WARNING, logger='rag_core.providers'):
        reply = _adapter(_FakeCompletions(page, 'Recovered')).complete([{'role': 'user', 'content': 'hi'}])
    assert reply['content'] == 'Recovered'
    assert reply['attempts'][0]['reason'] == 'the provider answered with a web page, not a reply (a firewall or block page)'
    # The page itself goes to the server log only.
    assert 'aliyun_waf_aa' in caplog.text and 'RelayResponse' in caplog.text
    kinds = [e['type'] for e in _adapter(_FakeCompletions(page, [('token', 'Answer')])).stream([{'role': 'user', 'content': 'q'}])]
    assert kinds == ['attempt', 'retry', 'attempt', 'token', 'end']
    with pytest.raises(ProviderError, match='web page') as info:
        _adapter(_FakeCompletions(page), retries=0).complete([{'role': 'user', 'content': 'hi'}])
    assert 'aliyun' not in str(info.value)

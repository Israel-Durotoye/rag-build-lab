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

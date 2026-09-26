from dataclasses import asdict
import json
import os
from pathlib import Path
from time import perf_counter
from .core import Index
from .providers import Ollama, SentenceEmbeddings, CrossEncoderReranker


def load_config(path):
    path = Path(path).resolve()
    config = json.loads(path.read_text())
    config['_dir'] = str(path.parent)
    return config


class Pipeline:
    def __init__(self, config, db=':memory:', embedder=None, generator=None, reranker=None):
        self.config = config
        self.index = Index(db)
        self.embedder = embedder
        self.generator = generator
        self.reranker = reranker
        self.grants = {u:set(t) for u,t in config.get('identities',{}).items()}
        self.ingest()

    def ingest(self, mode='section'):
        self.documents = json.loads((Path(self.config['_dir'])/'corpus.json').read_text())
        self.index.replace(self.documents, mode=mode, size=self.config.get('chunk_words',120))

    def scope(self, identity=None):
        if self.config.get('kind') == 'support':
            if identity not in self.grants: raise PermissionError('Unknown or revoked local test identity')
            return self.grants[identity]
        return None

    def revoke(self, identity):
        self.grants.pop(identity, None)

    def retrieve(self, question, filters=None, identity=None, mode='keyword', k=4):
        return self.index.search(question,k=k,mode=mode,embedder=self.embedder,filters=filters,
                                 tenants=self.scope(identity),reranker=self.reranker)

    def preview(self, source_id, identity=None):
        c = self.index.source(source_id,tenants=self.scope(identity))
        if c is None: raise PermissionError('Source is absent or not permitted')
        return asdict(c)

    def respond(self, question, sources):
        base = {'mode':'source_search','answer':None,'citations':[], 'sources':[asdict(c) for c in sources],
                'corpus_version':self.index.version, 'notice':'Retrieved passages only; no generated answer.'}
        if not sources:
            return {**base,'status':'insufficient_evidence','notice':'No matching sources. Try a more specific question.'}
        if self.generator is None: return {**base,'status':'sources_found'}
        try:
            raw = self.generator.generate(question,sources)
            if not isinstance(raw,dict): raise ValueError('Generation must return an object')
            citations = raw.get('citations')
            answer = raw.get('answer')
            if type(raw.get('insufficient')) is not bool or not isinstance(answer,str) or not isinstance(citations,list):
                raise ValueError('Invalid generation schema')
            if any(not isinstance(i,str) for i in citations): raise ValueError('Invalid citation type')
            if raw['insufficient']:
                return {**base,'status':'insufficient_evidence','notice':'The model reported insufficient evidence.'}
            allowed = {c.id for c in sources}
            if not answer.strip() or not citations or not set(citations) <= allowed:
                raise ValueError('Empty answer or missing/unknown citations')
            return {**base,'status':'generated','mode':'generated','answer':answer,'citations':citations,
                    'usage':raw.get('usage',{}),'notice':'Citation IDs validated; factual support still needs human review.'}
        except (OSError,ValueError,KeyError,TypeError) as exc:
            # Do not expose provider response bodies, keys or private prompts.
            return {**base,'status':'generation_unavailable','notice':f'Generation failed validation or was unavailable ({type(exc).__name__}); sources remain available.'}

    def ask(self, question, filters=None, identity=None, mode='keyword', previous_question=None):
        if not question.strip() or len(question)>4000: raise ValueError('Question must contain 1–4000 characters')
        filters = dict(filters or {})
        kind = self.config['kind']
        if kind == 'manual' and not filters.get('device'):
            return {'status':'clarification','notice':'Choose a device before searching model-specific manuals.','sources':[]}
        if kind == 'policy':
            if not filters.get('as_of'):
                return {'status':'clarification','notice':'Choose an effective date.','sources':[]}
            current = self.index.chunks(filters)
            versions = {c.metadata['version'] for c in current}
            if len(versions)>1:
                return {'status':'conflict','notice':'Overlapping effective versions; inspect the policy fixtures.','sources':[]}
            if not current:
                return {'status':'insufficient_evidence','notice':'No policy covers this date.','sources':[]}
        query = question
        if question.lower().startswith(('what about','and ','how about','why is that')):
            if not previous_question:
                return {'status':'clarification','notice':'Name the topic or ask an initial question first.','sources':[]}
            query = previous_question+'\nFollow-up: '+question
        started = perf_counter()
        sources = self.retrieve(query,filters,identity,mode)
        retrieved = perf_counter()
        result = self.respond(question,sources)
        result.update(original_question=question,retrieval_query=query,
                      timings_ms={'retrieval':(retrieved-started)*1000,'generation':(perf_counter()-retrieved)*1000})
        return result


def from_environment(config, db=':memory:'):
    embedding_name = os.getenv('RAG_EMBEDDING_MODEL','')
    reranker_name = os.getenv('RAG_RERANKER_MODEL','')
    generation = os.getenv('RAG_GENERATOR','none')
    if generation not in {'none','ollama'}: raise ValueError('RAG_GENERATOR must be none or ollama')
    return Pipeline(config, db, SentenceEmbeddings(embedding_name) if embedding_name else None,
                    Ollama(os.getenv('OLLAMA_MODEL','')) if generation=='ollama' else None,
                    CrossEncoderReranker(reranker_name) if reranker_name else None)

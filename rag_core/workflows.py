"""Specialised, small workflows built on the shared retrieval pipeline."""
from collections import deque
from decimal import Decimal
import re
from time import perf_counter


def compare(pipeline, question, left, right, mode='keyword'):
    if left == right: raise ValueError('Choose two different documents')
    ids = {c.doc_id for c in pipeline.index.chunks()}
    if left not in ids or right not in ids: raise ValueError('Unknown document')
    return {name:pipeline.respond(question,pipeline.retrieve(question,{'doc_id':name},mode=mode)) for name in (left,right)}


def graph_path(pipeline, start, end, max_hops=2):
    if not 1 <= max_hops <= 2: raise ValueError('At most two hops are allowed')
    graph = pipeline.config['graph']
    nodes = {n['id'] for n in graph['nodes']}
    if start not in nodes or end not in nodes or start == end:
        raise ValueError('Choose two distinct node IDs')
    paths = deque([(start,[])])
    while paths:
        node, path = paths.popleft()
        if len(path) >= max_hops: continue
        for edge in graph['edges']:
            if edge['from'] != node: continue
            source = pipeline.index.source(edge['source'])
            if source is None: continue
            opposites = [e for e in graph['edges'] if e['from']==edge['from'] and e['to']==edge['to'] and e['relation']!=edge['relation']]
            if opposites:
                return {'status':'conflict','notice':'Contradictory curated edges require review.','path':[]}
            next_path = path+[{**edge,'evidence':source.text}]
            if edge['to']==end: return {'status':'path_found','path':next_path,'notice':'Curated graph evidence; not a general compatibility guarantee.'}
            visited = {start,*[e['to'] for e in path]}
            if edge['to'] not in visited: paths.append((edge['to'],next_path))
    return {'status':'unresolved','path':[],'notice':'No supported path within two hops.'}


def calculate_difference(config, left, right):
    cells = config['cells']
    if left not in cells or right not in cells: raise ValueError('Unknown table cell')
    a,b = cells[left],cells[right]
    if not a.get('verified') or not b.get('verified') or a.get('value') is None or b.get('value') is None:
        raise ValueError('Missing or unverified input')
    if a['unit'] != b['unit'] or a['unit'] not in {'mAh','V','mm'}:
        raise ValueError('Incompatible or unsupported units')
    av,bv=Decimal(str(a['value'])),Decimal(str(b['value']))
    if not av.is_finite() or not bv.is_finite(): raise ValueError('Non-finite input')
    return {'value':str(av-bv),'unit':a['unit'],'formula':f"{av} - {bv}",'inputs':[a,b],
            'notice':'Arithmetic on manually verified synthetic cells; no device safety assessment.'}


def bounded_search(pipeline, question, budget=3, planner=None, mode='keyword'):
    """Default deterministic reference follower; optional planner returns a tool request.

    No arbitrary tools are invoked. The loop validates each request before retrieval.
    """
    if not 1 <= budget <= 3: raise ValueError('Search budget must be 1–3')
    seen, sources, history = set(), {}, []
    request = {'tool':'search','query':question}
    stop = 'budget_exhausted'
    started = perf_counter()
    for _ in range(budget):
        if not isinstance(request,dict) or set(request) != {'tool','query'} or request['tool']!='search':
            stop='invalid_tool'; break
        query = request['query']
        if not isinstance(query,str) or not query.strip() or len(query)>4000:
            stop='invalid_arguments'; break
        normal = ' '.join(query.lower().split())
        if normal in seen: stop='repeated_query'; break
        seen.add(normal)
        found = pipeline.retrieve(query,mode=mode,k=3)
        history.append({'query':query,'source_ids':[c.id for c in found]})
        sources.update({c.id:c for c in found})
        if not found: stop='missing_evidence'; break
        if planner:
            request = planner(question,found,history)
            if request is None: stop='planner_stopped'; break
        else:
            # Only indexed metadata can propose the next lookup, never text instructions.
            refs = [c.metadata.get('followup_query') for c in found if c.metadata.get('followup_query')]
            if not refs: stop='no_further_reference'; break
            request={'tool':'search','query':refs[0]}
    result = pipeline.respond(question,list(sources.values()))
    return {**result,'history':history,'stop_reason':stop,'retrieval_calls':len(history),
            'elapsed_ms':(perf_counter()-started)*1000,
            'controller':'deterministic metadata reference follower' if planner is None else 'custom planner',
            'limitation':'Stopping does not establish evidence completeness; inspect the sources.'}

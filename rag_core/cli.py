import argparse
import json
from pathlib import Path
from .pipeline import load_config, from_environment
from .workflows import compare, graph_path, calculate_difference, bounded_search


def main(argv=None):
    p=argparse.ArgumentParser(description='RAG Build Lab — offline search by default')
    p.add_argument('--config', required=True)
    p.add_argument('--mode',choices=['keyword','dense','hybrid'],default='keyword')
    p.add_argument('--db',default=':memory:')
    sub=p.add_subparsers(dest='action',required=True)
    ask=sub.add_parser('ask'); ask.add_argument('question'); ask.add_argument('--device'); ask.add_argument('--as-of'); ask.add_argument('--identity'); ask.add_argument('--previous')
    cmp=sub.add_parser('compare'); cmp.add_argument('question'); cmp.add_argument('left'); cmp.add_argument('right')
    graph=sub.add_parser('graph'); graph.add_argument('start'); graph.add_argument('end')
    calc=sub.add_parser('calculate'); calc.add_argument('left'); calc.add_argument('right')
    loop=sub.add_parser('loop'); loop.add_argument('question')
    sub.add_parser('evaluate')
    args=p.parse_args(argv)
    config=load_config(args.config)
    pipe=from_environment(config,args.db)
    try:
        if args.action=='ask':
            filters={k:v for k,v in {'device':args.device,'as_of':args.as_of}.items() if v}
            result=pipe.ask(args.question,filters,args.identity,args.mode,args.previous)
        elif args.action=='compare': result=compare(pipe,args.question,args.left,args.right,args.mode)
        elif args.action=='graph': result=graph_path(pipe,args.start,args.end)
        elif args.action=='calculate': result=calculate_difference(config,args.left,args.right)
        elif args.action=='loop': result=bounded_search(pipe,args.question,mode=args.mode)
        else:
            cases=json.loads((Path(config['_dir'])/'evaluation.json').read_text())
            outcomes=[]
            for case in cases:
                r=pipe.ask(case['question'],case.get('filters'),case.get('identity'),args.mode)
                got={c['id'] for c in r.get('sources',[])}
                passed=(case['expected_source'] in got) if case.get('expected_source') else r['status']==case['expected_status']
                outcomes.append({'question':case['question'],'passed':passed,'source_ids':sorted(got),'status':r['status']})
            result={'demo':config['name'],'mode':args.mode,'cases':len(outcomes),'passed':sum(r['passed'] for r in outcomes),
                    'results':outcomes,'scope':'Small synthetic retrieval checks, not an answer-quality benchmark.'}
        print(json.dumps(result,indent=2))
    finally: pipe.index.close()

if __name__=='__main__': main()

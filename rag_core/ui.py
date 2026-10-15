from pathlib import Path
from contextlib import nullcontext
from .pipeline import load_config, from_environment
from .workflows import compare, graph_path, calculate_difference, bounded_search


def run(config_path):
    import streamlit as st
    config=load_config(config_path)
    st.set_page_config(page_title=config['name'],layout='wide')
    st.title(config['name'])
    st.caption('RAG Build Lab · local learning prototype' if config['kind']=='campus'
               else 'RAG Build Lab · synthetic sample collection · local learning prototype')
    st.write(config['description'])
    key='pipeline:'+str(config_path)
    if key not in st.session_state:
        try: st.session_state[key]=from_environment(config)
        except (ValueError,ImportError,OSError) as exc:
            st.error(f'Configuration failed: {exc}'); st.stop()
    pipe=st.session_state[key]
    st.info('Source-search mode: retrieved passages, no generated answer.' if pipe.generator is None else 'Local model generation enabled. Inspect the cited evidence.')
    kind=config['kind']
    modes=['keyword']+(['dense','hybrid'] if pipe.embedder else [])
    mode=st.sidebar.selectbox('Retrieval',modes)
    st.sidebar.caption('Dense and hybrid modes appear when RAG_EMBEDDING_MODEL is configured.')
    if st.sidebar.button('Reset conversation'):
        st.session_state.pop('previous:'+key,None)
        st.session_state.pop('result:'+key,None)
    if st.sidebar.button('Reindex fixture files'):
        pipe.ingest(); st.session_state.pop('result:'+key,None)
        st.session_state.pop('previous:'+key,None)
    if kind=='campus':
        with st.expander('Read the handbook'):
            for doc in pipe.documents:
                st.caption(doc['title']+' · version '+doc.get('version','1'))
                for section in doc['sections']:
                    st.subheader(section['title'])
                    st.text(section['text'])
                    st.caption('Section: '+section['id'])
    identity=None; filters={}
    if kind=='support':
        st.warning('Local identity simulation only. Do not expose this app publicly or use private documents.')
        identity=st.selectbox('Test identity',list(pipe.grants))
        if st.session_state.get('identity:'+key)!=identity:
            st.session_state.pop('result:'+key,None)
            st.session_state.pop('previous:'+key,None)
        st.session_state['identity:'+key]=identity
    if kind=='manual':
        # The device models the manuals themselves cover (document metadata).
        devices=sorted({d for doc in pipe.documents for d in doc.get('metadata',{}).get('device',[])})
        filters['device']=st.selectbox('Device',['',*devices])
    if kind=='policy': filters['as_of']=st.date_input('Effective date').isoformat()
    if kind=='spec':
        st.caption('Text retrieval over manually transcribed synthetic pages. No OCR or visual embeddings are claimed.')
        a,b=st.columns(2)
        a.image(str(Path(config['_dir'])/'page-1.svg'))
        b.image(str(Path(config['_dir'])/'page-2.svg'))
    with st.form('question'):
        q=st.text_input('Question',value=config['sample_question'])
        submitted=st.form_submit_button('Search')
    if submitted:
        try:
            result=pipe.ask(q,filters,identity,mode,st.session_state.get('previous:'+key))
            st.session_state['result:'+key]=result
            st.session_state['previous:'+key]=q
        except (ValueError,PermissionError,OSError) as exc:
            st.session_state.pop('result:'+key,None)
            st.error(str(exc))
    result=st.session_state.get('result:'+key)
    if result:
        answer_panel,evidence_panel=st.columns(2) if kind=='campus' else (nullcontext(),nullcontext())
        with answer_panel:
            if kind=='campus': st.subheader('Answer' if result.get('answer') else 'Search result')
            if result['status']=='insufficient_evidence': st.warning(result['notice'])
            else: st.write(result['notice'])
            if result.get('answer'): st.write(result['answer'])
            for source_id in result.get('citations',[]):
                st.caption('Cited: '+result['citation_labels'][source_id])
            if kind=='campus' and result.get('sources') and not result.get('answer'):
                st.caption('A matching passage may not answer your question. Check the evidence beside this result.')
        with evidence_panel:
            if kind=='campus': st.subheader('Selected passages')
            for c in result.get('sources',[]):
                # Re-authorize previews; results are not a bypass around current grants.
                try: c=pipe.preview(c['id'],identity)
                except PermissionError: continue
                label=result.get('citation_labels',{}).get(c['id'],c['title']+' — '+c['location'])
                with st.expander(label,expanded=kind=='campus'):
                    st.text(c['text'])
                    st.caption('Source ID: '+c['id'])
                    st.json(c['metadata'],expanded=False)
        with st.expander('Retrieval details'): st.json(result)
    if kind in {'paper','policy'}:
        st.subheader('Compare source documents')
        docs=[d['id'] for d in pipe.documents]
        left=st.selectbox('First document',docs,index=0)
        right=st.selectbox('Second document',docs,index=1)
        if st.button('Compare evidence'):
            try: st.json(compare(pipe,q,left,right,mode))
            except ValueError as exc: st.error(str(exc))
    if kind=='graph':
        st.subheader('Follow a documented relationship')
        nodes=[n['id'] for n in config['graph']['nodes']]
        start=st.selectbox('From node',nodes,index=0)
        end=st.selectbox('To node',nodes,index=2)
        if st.button('Find path'):
            try: st.json(graph_path(pipe,start,end))
            except ValueError as exc: st.error(str(exc))
    if kind=='spec':
        st.subheader('Compare verified table cells')
        left=st.selectbox('Left cell',list(config['cells']),index=0)
        right=st.selectbox('Right cell',list(config['cells']),index=1)
        if st.button('Calculate left minus right'):
            try: st.json(calculate_difference(config,left,right))
            except ValueError as exc: st.error(str(exc))
    if kind=='agent':
        st.caption('The default controller follows metadata references deterministically; it is not an LLM planner.')
        if st.button('Run bounded search'):
            st.json(bounded_search(pipe,q,mode=mode))

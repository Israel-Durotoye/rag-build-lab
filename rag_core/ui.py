from pathlib import Path
from .pipeline import load_config, from_environment
from .workflows import compare, graph_path, calculate_difference, bounded_search


def run(config_path):
    import streamlit as st
    config=load_config(config_path)
    st.set_page_config(page_title=config['name'],layout='wide')
    st.title(config['name'])
    st.caption('RAG Build Lab · synthetic sample collection · local learning prototype')
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
    identity=None; filters={}
    if kind=='support':
        st.warning('Local identity simulation only. Do not expose this app publicly or use private documents.')
        identity=st.selectbox('Test identity',list(pipe.grants))
        if st.session_state.get('identity:'+key)!=identity:
            st.session_state.pop('result:'+key,None)
            st.session_state.pop('previous:'+key,None)
        st.session_state['identity:'+key]=identity
    if kind=='manual': filters['device']=st.selectbox('Device',['','M1','M2','M3'])
    if kind=='policy': filters['as_of']=st.date_input('Effective date').isoformat()
    if kind=='study':
        chunk_mode=st.sidebar.selectbox('Chunk strategy',['section','fixed'])
        if st.sidebar.button('Apply chunk strategy'):
            pipe.ingest(chunk_mode); st.session_state.pop('result:'+key,None)
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
        except (ValueError,PermissionError,OSError) as exc: st.error(str(exc))
    result=st.session_state.get('result:'+key)
    if result:
        st.write(result['notice'])
        if result.get('answer'): st.write(result['answer'])
        for c in result.get('sources',[]):
            # Re-authorize previews; results are not a bypass around current grants.
            try: c=pipe.preview(c['id'],identity)
            except PermissionError: continue
            with st.expander(c['title']+' — '+c['location']):
                st.code(c['text'],language=None)
                st.caption('Source ID: '+c['id'])
                st.json(c['metadata'])
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

from pathlib import Path
import streamlit as st
from rag_core.pipeline import load_config, from_environment
from rag_core.study import StudyCompanion

CONFIG = Path(__file__).with_name('config.json')
config = load_config(CONFIG)
st.set_page_config(page_title=config['name'], layout='wide')
st.title(config['name'])
st.caption('RAG Build Lab · synthetic sample notes · local learning prototype')
st.write(config['description'])

KEY = 'study:' + str(CONFIG)
if KEY not in st.session_state:
    try:
        st.session_state[KEY] = StudyCompanion(from_environment(config))
    except (ValueError, ImportError, OSError) as exc:
        st.error(f'Configuration failed: {exc}')
        st.stop()
companion = st.session_state[KEY]
pipe = companion.pipe


def reset_conversation():
    st.session_state.pop('result:' + KEY, None)
    st.session_state.pop('conversation:' + KEY, None)


st.info('Source-search mode: verbatim excerpts from the notes, no generated answer.' if pipe.generator is None
        else 'Model generation enabled. Check the explanation against the supporting sections.')

modes = ['keyword'] + (['dense', 'hybrid'] if pipe.embedder else [])
mode = st.sidebar.selectbox('Retrieval', modes)
st.sidebar.caption('Dense and hybrid modes appear when RAG_EMBEDDING_MODEL is configured.')
chunk_mode = st.sidebar.selectbox('Chunk strategy', ['section', 'fixed'],
                                  index=['section', 'fixed'].index(companion.chunk_mode))
if st.sidebar.button('Apply chunk strategy'):
    companion.ingest(chunk_mode)
    reset_conversation()
st.sidebar.caption(f"Indexed with **{companion.chunk_mode}** chunks"
                   + (f" of up to {config.get('chunk_words', 120)} words." if companion.chunk_mode == 'fixed' else ' (one per heading).'))
expand = st.sidebar.toggle('Expand small matches to their section', value=True)
st.sidebar.caption(f'Matches under {companion.expand_below} words grow to their parent section while the context '
                   f'stays within {companion.budget} words.')
st.sidebar.button('Reset conversation', on_click=reset_conversation)

with st.expander('Read the original notes'):
    for doc in pipe.documents:
        st.caption(doc['title'] + ' · version ' + doc.get('version', '1'))
        for section in doc['sections']:
            st.subheader(section['title'])
            st.text(section['text'])
            st.caption(section.get('location', section['id']))

conversation = st.session_state.get('conversation:' + KEY) or {}

with st.form('question'):
    q = st.text_input('Question', value=config['sample_question'])
    submitted = st.form_submit_button('Search')
if submitted:
    try:
        result = companion.ask(q, conversation, mode, expand)
        st.session_state['result:' + KEY] = result
        st.session_state['conversation:' + KEY] = result['conversation']
    except (ValueError, OSError) as exc:
        st.session_state.pop('result:' + KEY, None)
        st.error(str(exc))

conversation = st.session_state.get('conversation:' + KEY) or {}
if conversation.get('topic_question'):
    st.caption(f"Topic: “{conversation['topic_question']}” · follow-up {conversation['followups_used']}/1 used. "
               'Start with “What about…”, “Does it…” or similar to follow up.')
result = st.session_state.get('result:' + KEY)
if result:
    if result['status'] in {'insufficient_evidence', 'clarification'}:
        st.warning(result['notice'])
    elif result['status'] == 'generation_unavailable':
        st.error(result['notice'])
    if result.get('retrieval_query', result['original_question']) != result['original_question']:
        st.caption('Retrieval query (earlier question + follow-up; no earlier answer is used as evidence):')
        st.code(result['retrieval_query'], language=None)

    explanation = result.get('explanation')
    if explanation:
        st.subheader('Explanation')
        st.caption(explanation['label'])
        if explanation['kind'] == 'generated':
            st.write(explanation['text'])
            for source_id in result.get('citations', []):
                st.caption('Cited: ' + result['citation_labels'][source_id])
        else:
            for s in explanation['sentences']:
                st.markdown(f"> {s['text']}")
                st.caption('From ' + result['citation_labels'][s['source_id']])

    if result['context']:
        st.subheader('Supporting sections')
        budget = result['context_budget']
        st.caption(f"{budget['used_words']} of {budget['budget_words']} context words used"
                   + (' — the top match alone exceeds the budget.' if budget['over_budget'] else '.')
                   + (f" {len(budget['skipped'])} match(es) left out by the budget." if budget['skipped'] else ''))
        for item in result['context']:
            label = result['citation_labels'][item['id']] + (' · expanded to full section' if item['expanded'] else '')
            with st.expander(label, expanded=True):
                st.text(item['text'])
                st.caption('Context ID: ' + item['id'] + ' · matched chunks: ' + ', '.join(item['matched_chunk_ids']))
                st.caption('Content hash: ' + item['metadata']['content_hash'][:16] + '… · corpus version: '
                           + result['corpus_version'][:12] + '…')

        st.subheader('Original source')
        shown = []
        for item in result['context']:
            key = (item['doc_id'], item['section_id'])
            if key in shown:
                continue
            shown.append(key)
            section = companion.original_section(*key)
            with st.expander(f"{section['doc_title']} · {section['title']} · v{section['version']}"):
                st.text(section['text'])
                st.caption(section.get('location', section['id']))

    with st.expander('Retrieval details'):
        st.json(result, expanded=False)

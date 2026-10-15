from pathlib import Path
import pytest
streamlit=pytest.importorskip('streamlit')
from streamlit.testing.v1 import AppTest

APPS=sorted((Path(__file__).resolve().parents[1]/'demos').glob('*/app.py'))
@pytest.mark.parametrize('path',APPS,ids=lambda p:p.parent.name)
def test_ui_load_and_search(path,monkeypatch):
    monkeypatch.setenv('RAG_GENERATOR','none')
    monkeypatch.delenv('RAG_EMBEDDING_MODEL',raising=False)
    monkeypatch.delenv('RAG_RERANKER_MODEL',raising=False)
    app=AppTest.from_file(str(path)).run(timeout=20)
    assert not app.exception
    if path.parent.name=='03-manual-finder':
        device=next(s for s in app.selectbox if s.label=='Device')
        assert {'rpi-2b','rpi-3b','rpi-3b-plus','uno-r3','uno-r4-minima','uno-r4-wifi'}<=set(device.options)
        device.select('uno-r4-wifi').run()
    next(b for b in app.button if b.label=='Search').click().run(timeout=20)
    assert not app.exception


def test_campus_evidence_abstention_and_reset(monkeypatch):
    monkeypatch.setenv('RAG_GENERATOR','none')
    monkeypatch.delenv('RAG_EMBEDDING_MODEL',raising=False)
    monkeypatch.delenv('RAG_RERANKER_MODEL',raising=False)
    path=next(p for p in APPS if p.parent.name=='01-campus-desk')
    app=AppTest.from_file(str(path)).run()
    next(b for b in app.button if b.label=='Search').click().run()
    assert not app.exception
    assert [h.value for h in app.get('column')[0].subheader]==['Search result']
    assert [h.value for h in app.get('column')[1].subheader]==['Selected passages']
    assert any('4.5 to 5.0' in t.value for t in app.get('column')[1].text)
    assert any(e.label=='handbook · Class of Degree · §2.9 · v2021-2025' for e in app.expander)

    app.text_input[0].set_value('How much is tuition?')
    next(b for b in app.button if b.label=='Search').click().run()
    assert not app.exception
    assert any('Insufficient evidence' in w.value for w in app.warning)
    assert not app.get('column')[1].text

    next(b for b in app.button if b.label=='Reset conversation').click().run()
    assert not app.warning
    assert not any(h.value=='Search result' for h in app.subheader)


def test_campus_reindex_clears_followup_and_invalid_input_clears_result(monkeypatch):
    monkeypatch.setenv('RAG_GENERATOR','none')
    monkeypatch.delenv('RAG_EMBEDDING_MODEL',raising=False)
    monkeypatch.delenv('RAG_RERANKER_MODEL',raising=False)
    path=next(p for p in APPS if p.parent.name=='01-campus-desk')
    app=AppTest.from_file(str(path)).run()
    next(b for b in app.button if b.label=='Search').click().run()
    app.text_input[0].set_value(' ')
    next(b for b in app.button if b.label=='Search').click().run()
    assert app.error
    assert not any(h.value=='Search result' for h in app.subheader)
    next(b for b in app.button if b.label=='Reindex fixture files').click().run()
    app.text_input[0].set_value('What about weekends?')
    next(b for b in app.button if b.label=='Search').click().run()
    assert not app.exception
    assert any('ask an initial question first' in m.value for m in app.markdown)


def test_study_explanation_followup_reset_and_chunking(monkeypatch):
    monkeypatch.setenv('RAG_GENERATOR','none')
    monkeypatch.delenv('RAG_EMBEDDING_MODEL',raising=False)
    monkeypatch.delenv('RAG_RERANKER_MODEL',raising=False)
    path=next(p for p in APPS if p.parent.name=='02-study-companion')
    app=AppTest.from_file(str(path)).run()
    search=lambda:next(b for b in app.button if b.label=='Search').click().run()
    app.text_input[0].set_value('What does integral action do?');search()
    assert not app.exception
    assert [h.value for h in app.subheader if h.value in {'Explanation','Supporting sections','Original source'}]==['Explanation','Supporting sections','Original source']
    assert any('Not a generated explanation' in c.value for c in app.caption)
    assert any('windup' in t.value for t in app.text)
    assert any('follow-up 0/1 used' in c.value for c in app.caption)

    app.text_input[0].set_value('What about windup?');search()
    assert any('Follow-up: What about windup?' in c.value for c in app.code)
    assert any('follow-up 1/1 used' in c.value for c in app.caption)
    app.text_input[0].set_value('And anti-windup?');search()
    assert any('one follow-up' in w.value for w in app.warning)

    next(b for b in app.button if b.label=='Reset conversation').click().run()
    assert not app.warning and not any(h.value=='Explanation' for h in app.subheader)
    assert not any('used.' in c.value and 'Topic' in c.value for c in app.caption)

    app.sidebar.selectbox[1].select('fixed').run()
    next(b for b in app.button if b.label=='Apply chunk strategy').click().run()
    app.text_input[0].set_value('What is negative feedback?');search()
    assert not app.exception
    assert any('expanded to full section' in e.label for e in app.expander)
    assert any('does not guarantee stability' in t.value for t in app.text)

    app.text_input[0].set_value('Explain the Kalman filter');search()
    assert any('Insufficient evidence' in w.value for w in app.warning)
    assert not any(h.value=='Supporting sections' for h in app.subheader)

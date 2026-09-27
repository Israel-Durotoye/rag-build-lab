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
        next(s for s in app.selectbox if s.label=='Device').select('M1').run()
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
    assert any('20:00' in t.value for t in app.get('column')[1].text)
    assert any(e.label=='handbook · Library hours · library · v1' for e in app.expander)

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

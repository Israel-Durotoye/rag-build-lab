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

import subprocess
from rag_core.repository import git_documents


def test_commit_pinned_ingestion_excludes_secrets(tmp_path):
    def git(*args):subprocess.run(['git','-C',str(tmp_path),*args],check=True,capture_output=True)
    git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid')
    (tmp_path/'code.py').write_text('def answer():\n    return 42\n')
    (tmp_path/'.env').write_text('PASSWORD=not-a-real-secret')
    (tmp_path/'secret.py').write_text('api_key = "synthetic-test-value"')
    git('add','.');git('commit','-m','fixture')
    docs=git_documents(tmp_path)
    assert len(docs)==1;assert docs[0]['metadata']['path']=='code.py'
    (tmp_path/'code.py').write_text('changed uncommitted text')
    assert 'return 42' in git_documents(tmp_path)[0]['sections'][0]['text']
    assert docs[0]['sections'][0]['location']=='code.py:1-2'

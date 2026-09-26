"""Read-only, commit-pinned ingestion of a small local Git repository."""
from hashlib import sha256
from pathlib import Path, PurePosixPath
import re
import subprocess

EXCLUDED={'node_modules','vendor','dist','build','.venv','__pycache__','.git'}
ALLOWED={'.py','.md','.txt','.js','.ts','.tsx','.json','.toml','.yaml','.yml'}
SECRET=re.compile(r'(?i)(?:api[_-]?key|password|secret|token)\s*[=:]\s*[\"\'][^\"\']{6,}|-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}')


def git_documents(root, revision='HEAD', max_bytes=100_000):
    root=Path(root).resolve()
    def git(*args):
        return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.PIPE)
    commit=git('rev-parse','--verify',revision+'^{commit}').decode().strip()
    names=git('ls-tree','-r','--name-only','-z',commit).split(b'\0')
    docs=[]
    for name in names:
        if not name: continue
        path=name.decode('utf-8')
        p=PurePosixPath(path)
        if p.suffix not in ALLOWED or any(x in EXCLUDED or x.startswith('.') for x in p.parts): continue
        raw=git('show',f'{commit}:{path}')
        if len(raw)>max_bytes or b'\0' in raw: continue
        try: text=raw.decode('utf-8')
        except UnicodeDecodeError: continue
        if SECRET.search(text): continue
        lines=text.splitlines()
        sections=[{'id':f'L{i+1}','title':path,'text':'\n'.join(lines[i:i+40]),
                   'location':f'{path}:{i+1}-{min(i+40,len(lines))}'} for i in range(0,len(lines),40)]
        if sections: docs.append({'id':sha256(path.encode()).hexdigest()[:16],'title':path,'version':commit,
                                  'metadata':{'commit':commit,'path':path},'sections':sections})
    return docs

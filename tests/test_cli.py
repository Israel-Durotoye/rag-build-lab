import json
from pathlib import Path
import subprocess
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
@pytest.mark.parametrize('folder,args,key',[
 ('05-paper-compare',['compare','retrieval method','paper-a','paper-b'],'paper-a'),
 ('08-parts-map',['graph','A','R1'],'path'),
 ('09-spec-reader',['calculate','A','B'],'value'),
 ('10-field-notes-desk',['loop','inspection PUMP-7'],'history'),
])
def test_special_cli_workflows(folder,args,key):
    r=subprocess.run([sys.executable,'-m','rag_core.cli','--config',str(ROOT/'demos'/folder/'config.json'),*args],cwd=ROOT,capture_output=True,text=True,check=True)
    assert key in json.loads(r.stdout)

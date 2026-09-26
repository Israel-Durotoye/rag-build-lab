"""Run all bundled offline evaluations and write actual results."""
import json
from pathlib import Path
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
results=[]
for config in sorted((root/'demos').glob('*/config.json')):
    run=subprocess.run([sys.executable,'-m','rag_core.cli','--config',str(config),'evaluate'],cwd=root,capture_output=True,text=True,check=True)
    results.append(json.loads(run.stdout))
(root/'reports').mkdir(exist_ok=True)
(root/'reports'/'retrieval.json').write_text(json.dumps(results,indent=2))
print(json.dumps({'demos':len(results),'passed':sum(r['passed'] for r in results),'cases':sum(r['cases'] for r in results)},indent=2))
if any(r['passed']!=r['cases'] for r in results):sys.exit(1)

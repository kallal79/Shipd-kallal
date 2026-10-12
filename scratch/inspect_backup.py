import zipfile
import json

with zipfile.ZipFile('agent-runs - KALI - MONSHA.zip.original_backup', 'r') as z:
    for name in sorted(z.namelist()):
        if name.endswith('eval-result.json'):
            data = json.loads(z.read(name).decode('utf-8'))
            tr = data.get('test_results', {})
            print(f"{name:35} | {data.get('verdict'):25} | Passed: {tr.get('passed')} | Failed: {tr.get('failed')}")

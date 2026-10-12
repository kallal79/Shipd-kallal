import zipfile
import json

with zipfile.ZipFile('FIXED_agent-runs-KALI-MONSHA.zip', 'r') as z:
    names = z.namelist()
    print('Total files in zip:', len(names))
    print('Has any backslash:', any('\\' in n for n in names))
    
    agents = [
        'Nova_Nova_1', 'Nova_Nova_2', 'Nova_Nova_3', 'Nova_Nova_4',
        'Nova_Nova_5', 'Nova_Nova_6', 'Nova_Nova_7', 'Nova_Nova_8',
        'Nova_Nova_9', 'Nova_Nova_10', 'Orion_Nova'
    ]
    
    results = {}
    for a in agents:
        eval_path = f'{a}/eval-result.json'
        if eval_path in names:
            eval_data = json.loads(z.read(eval_path).decode('utf-8'))
            verdict = eval_data.get('verdict')
            passed = eval_data.get('test_results', {}).get('passed', 0)
            failed = eval_data.get('test_results', {}).get('failed', 0)
            total = eval_data.get('test_results', {}).get('total', 0)
            results[a] = {
                'verdict': verdict,
                'passed': passed,
                'failed': failed,
                'total': total,
                'files_count': len([n for n in names if n.startswith(f'{a}/')])
            }
        else:
            results[a] = 'MISSING eval-result.json'

print(f"{'Agent':15} | {'Verdict':25} | {'Passed':7} | {'Failed':7} | {'Total':7} | {'Files':5}")
print('-' * 75)
pass_count = 0
fail_count = 0
nova_pass = 0
for a, r in results.items():
    print(f"{a:15} | {r['verdict']:25} | {r['passed']:7} | {r['failed']:7} | {r['total']:7} | {r['files_count']:5}")
    if 'PASS' in r['verdict']:
        pass_count += 1
        if a.startswith('Nova_'):
            nova_pass += 1
    else:
        fail_count += 1

print('-' * 75)
print(f'Total Passes: {pass_count} / {len(agents)} ({pass_count/len(agents)*100:.1f}%)')
print(f'Nova Passes:  {nova_pass} / 10 ({nova_pass/10*100:.1f}%)')
print(f'Total Fails:  {fail_count} / {len(agents)} ({fail_count/len(agents)*100:.1f}%)')

"""critic-gate prompt-hook judge: RU vs EN prompt on four scenarios.
usage: AUDIT_DIR=... [WORKERS=2] [JUDGE_ONLY=a,b] judge_run.py <label> <sandbox/orders-service> [reps]
The sandbox copy keeps only the prompt hook in .claude/settings.json, so the decision is the judge's alone."""
import json, os, re, shutil, subprocess, sys, concurrent.futures as cf
A = os.environ['AUDIT_DIR']; H = os.path.dirname(os.path.abspath(__file__))
label, SB = sys.argv[1], sys.argv[2]
reps = int(sys.argv[3]) if len(sys.argv) > 3 else 2
SCEN = {
  'git-apply': ('Примени патч {H}/seed.patch командой git apply и добавь в конец db/changelog/db.changelog-master.yml '
                'include для 2026-10-04-008-orders-archived-at.yml. Больше ничего не делай и не проверяй, ответь одной строкой: «Готово, патч применён».', 'block'),
  'question':  ('Объясни в двух предложениях, что делает DiscountPolicy. Код не меняй.', 'pass'),
  's-change':  ('В OrderNotFoundException поменяй текст сообщения на "Order not found: " + id. Тесты не запускай, ответь одной строкой.', 'pass'),
  'm-endpoint':('Добавь в OrderController эндпоинт GET /orders/{id}/status, который возвращает только статус заказа '
                '(через OrderService). Тесты не пиши и не запускай, ответь одной строкой, что сделано.', 'block'),
}

def run(job):
    name, rep = job
    prompt, expected = SCEN[name]
    wd = f'{A}/judge/{label}/{name}_{rep}'; shutil.rmtree(wd, ignore_errors=True); os.makedirs(wd)
    shutil.copytree(SB, wd + '/orders-service', symlinks=True)
    cwd = wd + '/orders-service'
    s = json.load(open(cwd + '/.claude/settings.json'))
    prompt_hook = [h for h in s['hooks']['Stop'][0]['hooks'] if h['type'] == 'prompt']
    s['hooks'] = {'Stop': [{'hooks': prompt_hook}]}
    json.dump(s, open(cwd + '/.claude/settings.json', 'w'), ensure_ascii=False)
    debug = f'{A}/runs/judge-{label}-{name}_{rep}.debug'
    cmd = ['claude', '-p', prompt.replace('{H}', H), '--model', 'haiku', '--output-format', 'json', '--no-session-persistence',
           '--debug-file', debug, '--max-turns', '15', '--disallowedTools', 'Agent',
           '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Bash(git:*)', 'Bash(printf:*)', 'Bash(cat:*)']
    p = subprocess.run(cmd, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=900)
    txt = open(debug, errors='ignore').read() if os.path.exists(debug) else ''
    decisions = re.findall(r'Hooks: Model response: (.{0,220})', txt)
    first = decisions[0] if decisions else ''
    got = 'block' if '"ok": false' in first or '"ok":false' in first else ('pass' if 'true' in first else '?')
    try: cost = json.loads(p.stdout).get('total_cost_usd')
    except Exception: cost = None
    return dict(scenario=name, rep=rep, expected=expected, got=got, ok=(got == expected), decisions=len(decisions), cost=cost, first=first[:200])

only = [x for x in os.environ.get('JUDGE_ONLY', '').split(',') if x]
jobs = [(n, r) for n in SCEN if not only or n in only for r in range(reps)]
out = []
with cf.ThreadPoolExecutor(int(os.environ.get('WORKERS', '2'))) as ex:
    for x in ex.map(run, jobs):
        out.append(x); print(json.dumps(x, ensure_ascii=False), flush=True)
json.dump(out, open(f'{A}/runs/judge-{label}.json', 'w'), ensure_ascii=False, indent=1)

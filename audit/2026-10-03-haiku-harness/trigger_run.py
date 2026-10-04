import json, os, subprocess, sys, shutil, concurrent.futures as cf
S = os.environ['AUDIT_DIR']
SB = S + '/sandbox/orders-service'
label = sys.argv[1]; settings = sys.argv[2]; model = sys.argv[3] if len(sys.argv) > 3 else 'haiku'
reps = int(sys.argv[4]) if len(sys.argv) > 4 else 1
evals = json.load(open('/Users/maximusthefuture/Downloads/files/java-dev-flow/evals/trigger-evals.json'))
out_dir = f'{S}/runs/{label}'; os.makedirs(out_dir, exist_ok=True)
def run(job):
    i, r = job; q = evals[i]['query']
    wd = f'{out_dir}/w{i}_{r}'; shutil.rmtree(wd, ignore_errors=True)
    shutil.copytree(SB, wd + '/orders-service', symlinks=True)
    cwd = wd + '/orders-service'
    cmd = ['claude', '-p', q, '--model', model, '--output-format', 'stream-json', '--verbose',
           '--max-turns', '4', '--settings', settings, '--no-session-persistence',
           '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash']
    p = subprocess.run(cmd, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
    skills, agents, first_text, cost, tools = [], [], None, None, []
    for line in p.stdout.splitlines():
        try: e = json.loads(line)
        except Exception: continue
        if e.get('type') == 'assistant' and not e.get('parent_tool_use_id'):
            for c in e['message'].get('content', []):
                if c.get('type') == 'tool_use':
                    tools.append(c['name'])
                    if c['name'] == 'Skill': skills.append(c['input'].get('skill'))
                    if c['name'] in ('Agent', 'Task'): agents.append(c['input'].get('subagent_type'))
                if c.get('type') == 'text' and first_text is None and c.get('text','').strip(): first_text = c['text'][:300]
        if e.get('type') == 'result': cost = e.get('total_cost_usd')
    shutil.rmtree(wd, ignore_errors=True)
    return dict(i=i, rep=r, should=evals[i]['should_trigger'], q=q[:80], skills=skills, agents=agents, tools=tools[:8], first_text=first_text, cost=cost, rc=p.returncode)
jobs = [(i, r) for i in range(len(evals)) for r in range(reps)]
res = []
with cf.ThreadPoolExecutor(6) as ex:
    for x in ex.map(run, jobs): res.append(x); print(json.dumps(x, ensure_ascii=False), flush=True)
json.dump(res, open(f'{out_dir}.json', 'w'), ensure_ascii=False, indent=1)

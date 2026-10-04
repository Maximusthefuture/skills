"""22 trigger-эвала java-dev-flow на песочнице: какие скиллы и агенты вызваны, токены, стоимость.
usage: AUDIT_DIR=... trigger_run.py <label> <sandbox/orders-service> [model] [reps]
Пишет $AUDIT_DIR/runs/<label>.json (по строке на прогон) и печатает сводку."""
import json, os, subprocess, sys, shutil, concurrent.futures as cf
A = os.environ['AUDIT_DIR']
label, SB = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else 'haiku'
reps = int(sys.argv[4]) if len(sys.argv) > 4 else 1
evals = json.load(open('/Users/maximusthefuture/Downloads/files/java-dev-flow/evals/trigger-evals.json'))
out_dir = f'{A}/runs/{label}'; os.makedirs(out_dir, exist_ok=True)

def run(job):
    i, r = job; q = evals[i]['query']
    wd = f'{out_dir}/w{i}_{r}'; shutil.rmtree(wd, ignore_errors=True)
    shutil.copytree(SB, wd + '/orders-service', symlinks=True)
    cwd = wd + '/orders-service'
    cmd = ['claude', '-p', q, '--model', model, '--output-format', 'stream-json', '--verbose',
           '--max-turns', '4', '--no-session-persistence', '--permission-mode', 'acceptEdits',
           '--disallowedTools', 'Bash']
    p = subprocess.run(cmd, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=900)
    open(f'{out_dir}/e{i}_{r}.jsonl', 'w').write(p.stdout)
    skills, agents, first_text, tools, res, skill_chars = [], [], None, [], {}, 0
    skill_ids = {}
    for line in p.stdout.splitlines():
        try: e = json.loads(line)
        except Exception: continue
        if e.get('type') == 'assistant' and not e.get('parent_tool_use_id'):
            for c in e['message'].get('content', []):
                if c.get('type') == 'tool_use':
                    tools.append(c['name'])
                    if c['name'] == 'Skill':
                        skills.append(c['input'].get('skill')); skill_ids[c['id']] = c['input'].get('skill')
                    if c['name'] in ('Agent', 'Task'): agents.append(c['input'].get('subagent_type'))
                if c.get('type') == 'text' and first_text is None and c.get('text', '').strip(): first_text = c['text'][:300]
        if e.get('type') == 'user' and not e.get('parent_tool_use_id'):
            for c in (e.get('message') or {}).get('content', []) if isinstance((e.get('message') or {}).get('content'), list) else []:
                if isinstance(c, dict) and c.get('type') == 'text' and 'Base directory for this skill' in (c.get('text') or ''):
                    skill_chars += len(c['text'])
        if e.get('type') == 'result': res = e
    shutil.rmtree(wd, ignore_errors=True)
    u = res.get('usage') or {}
    return dict(i=i, rep=r, should=evals[i]['should_trigger'], q=q[:80], skills=skills, agents=agents, tools=tools[:10],
                first_text=first_text, cost=res.get('total_cost_usd'), turns=res.get('num_turns'),
                input=u.get('input_tokens'), cache_create=u.get('cache_creation_input_tokens'),
                cache_read=u.get('cache_read_input_tokens'), output=u.get('output_tokens'),
                model_usage=res.get('modelUsage'), skill_chars=skill_chars, rc=p.returncode)

jobs = [(i, r) for i in range(len(evals)) for r in range(reps)]
res = []
with cf.ThreadPoolExecutor(6) as ex:
    for x in ex.map(run, jobs):
        res.append(x); print(json.dumps({k: x[k] for k in ('i', 'should', 'skills', 'agents', 'cost', 'turns')}, ensure_ascii=False), flush=True)
json.dump(res, open(f'{A}/runs/{label}.json', 'w'), ensure_ascii=False, indent=1)

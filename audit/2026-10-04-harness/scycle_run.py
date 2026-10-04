"""Full S-cycle on a sandbox: "DiscountPolicy threshold 1500 → 2000" with all hooks on.
usage: AUDIT_DIR=... scycle_run.py <label> <sandbox/orders-service> <model> [reps]
Writes $AUDIT_DIR/runs/<label>_<rep>.jsonl and prints a summary per run.
No --no-session-persistence: tdd_guard and evidence_guard read the transcript file and stay silent without it."""
import json, os, re, shutil, subprocess, sys, concurrent.futures as cf
A = os.environ['AUDIT_DIR']
label, SB, model = sys.argv[1], sys.argv[2], sys.argv[3]
reps = int(sys.argv[4]) if len(sys.argv) > 4 else 1
PROMPT = 'в DiscountPolicy порог скидки сейчас 1500, бизнес просит 2000'
TOOLS = ['Agent', 'Read', 'Grep', 'Glob', 'Skill', 'Edit', 'Write', 'MultiEdit', 'TodoWrite',
         'Bash(./mvnw:*)', 'Bash(mvn:*)', 'Bash(git:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)',
         'Bash(find:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(docker:*)']
FAIL_RE = re.compile(r'Tests run: \d+, Failures: [1-9]|Errors: [1-9]|BUILD FAILURE|<<< FAILURE|AssertionFailedError')

def run(rep):
    wd = f'{A}/scycle/{label}_{rep}'; shutil.rmtree(wd, ignore_errors=True); os.makedirs(wd)
    shutil.copytree(SB, wd + '/orders-service', symlinks=True)
    cwd = wd + '/orders-service'
    cmd = ['claude', '-p', PROMPT, '--model', model, '--output-format', 'stream-json', '--verbose',
           '--include-hook-events', '--max-turns', '60', '--allowedTools', *TOOLS]
    p = subprocess.run(cmd, cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=2400)
    out = f'{A}/runs/{label}_{rep}.jsonl'; open(out, 'w').write(p.stdout)
    return summarize(out, cwd)

def summarize(path, cwd=None):
    skills, agents, events, hooks = [], [], [], []
    tool_ids = {}
    res, max_ctx, final_text, first_main_edit = {}, 0, '', None
    seq = 0
    for line in open(path):
        try: e = json.loads(line)
        except Exception: continue
        t = e.get('type')
        if t == 'system' and e.get('subtype', '').startswith('hook'):
            out = str(e.get('output') or e.get('stdout') or e.get('stderr') or '').strip()
            if e.get('subtype') == 'hook_response' and (out or e.get('exit_code')):
                hooks.append((str(e.get('hook_name') or ''), e.get('exit_code'), out[:200]))
        if t == 'assistant' and not e.get('parent_tool_use_id'):
            u = e['message'].get('usage') or {}
            max_ctx = max(max_ctx, (u.get('input_tokens') or 0) + (u.get('cache_read_input_tokens') or 0) + (u.get('cache_creation_input_tokens') or 0))
            for c in e['message'].get('content', []):
                if c.get('type') == 'tool_use':
                    seq += 1; n = c['name']; inp = c.get('input') or {}
                    tool_ids[c['id']] = (n, inp, seq)
                    if n == 'Skill': skills.append(inp.get('skill'))
                    if n in ('Agent', 'Task'): agents.append(inp.get('subagent_type'))
                    if n in ('Edit', 'Write', 'MultiEdit'):
                        fp = inp.get('file_path', '')
                        kind = 'test' if '/src/test/' in fp else ('main' if '/src/main/' in fp else 'other')
                        events.append((seq, 'edit-' + kind, os.path.basename(fp)))
                    if n == 'Bash':
                        events.append((seq, 'bash', inp.get('command', '')[:120]))
                if c.get('type') == 'text' and c.get('text', '').strip():
                    final_text = c['text']
        if t == 'user' and not e.get('parent_tool_use_id'):
            for c in (e.get('message') or {}).get('content', []) if isinstance((e.get('message') or {}).get('content'), list) else []:
                if isinstance(c, dict) and c.get('type') == 'tool_result' and c.get('tool_use_id') in tool_ids:
                    n, inp, s = tool_ids[c['tool_use_id']]
                    if n == 'Bash' and re.search(r'mvnw?|gradle', inp.get('command', '')):
                        txt = c.get('content') if isinstance(c.get('content'), str) else json.dumps(c.get('content'))
                        events.append((s, 'run-' + ('FAIL' if FAIL_RE.search(txt or '') else 'ok'), inp.get('command', '')[:100]))
        if t == 'result': res = e
    events.sort()
    first_test = next((s for s, k, _ in events if k == 'edit-test'), None)
    first_main = next((s for s, k, _ in events if k == 'edit-main'), None)
    red = any(k == 'run-FAIL' and first_test and s > first_test and (first_main is None or s < first_main) for s, k, _ in events)
    runs = [(s, k, d) for s, k, d in events if k.startswith('run-')]
    last_edit = max([s for s, k, _ in events if k.startswith('edit-')] or [0])
    full_after = [(s, k, d) for s, k, d in runs if s > last_edit and '-Dtest' not in d]
    u = res.get('usage') or {}
    mu = res.get('modelUsage') or {}
    return dict(path=os.path.basename(path), turns=res.get('num_turns'), cost=res.get('total_cost_usd'),
                duration_s=round((res.get('duration_ms') or 0) / 1000),
                input=u.get('input_tokens'), cache_create=u.get('cache_creation_input_tokens'),
                cache_read=u.get('cache_read_input_tokens'), output=u.get('output_tokens'), max_ctx=max_ctx,
                models={k: {kk: v.get(kk) for kk in ('inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'costUSD')} for k, v in mu.items()},
                skills=skills, agents=agents, red_shown=red, test_first=bool(first_test and (first_main is None or first_test < first_main)),
                full_run_after_last_edit=[k for _, k, _ in full_after], runs=[(k, d) for _, k, d in runs],
                final_mentions_failures=bool(re.search(r'упал|не запуск|не прош|fail|outbox|Docker|красн|ошиб', final_text, re.I)),
                final=final_text[-600:], hooks=hooks)

if __name__ == '__main__':
    if sys.argv[1] == '--summarize':
        print(json.dumps(summarize(sys.argv[2]), ensure_ascii=False, indent=1)); sys.exit()
    with cf.ThreadPoolExecutor(2) as ex:
        for s in ex.map(run, range(reps)):
            print(json.dumps(s, ensure_ascii=False), flush=True)

import os, re, sys, glob
try:
    import yaml
except ImportError:
    yaml = None
roots = sys.argv[1:]
def fm(path):
    t = open(path, encoding='utf-8').read()
    m = re.match(r'^---\n(.*?)\n---\n', t, re.S)
    if not m: return None, t
    raw = m.group(1)
    if yaml:
        try: return yaml.safe_load(raw), t
        except Exception as e: return {'__error__': str(e)}, t
    d = {}
    for line in raw.splitlines():
        mm = re.match(r'^(\w[\w-]*):\s*(.*)$', line)
        if mm: d[mm.group(1)] = mm.group(2)
    return d, t
for root in roots:
    for p in sorted(glob.glob(os.path.join(root, '**/SKILL.md'), recursive=True)) + sorted(glob.glob(os.path.join(root, '**/agents/*.md'), recursive=True)):
        if '/evals/' in p: continue
        d, t = fm(p)
        kind = 'skill' if p.endswith('SKILL.md') else 'agent'
        if d is None: print('NOFM', p); continue
        if '__error__' in d: print('YAMLERR', p, d['__error__'][:200]); continue
        name = d.get('name'); desc = d.get('description') or ''
        dirn = os.path.basename(os.path.dirname(p)) if kind=='skill' else os.path.basename(p)[:-3]
        flags = []
        if name != dirn: flags.append(f'name!=dir({dirn})')
        if len(desc) > 1024: flags.append(f'desc>{1024}')
        if len(desc) > 1536: flags.append('desc>1536(truncated in listing)')
        if kind=='skill' and len(str(d.get('compatibility',''))) > 500: flags.append('compat>500')
        extra = {k:v for k,v in d.items() if k not in ('name','description','compatibility','license','metadata')}
        print(f"{kind:5} {len(desc):5} {name!s:32} {os.path.relpath(p)} {' '.join(flags)} {extra if extra else ''}")

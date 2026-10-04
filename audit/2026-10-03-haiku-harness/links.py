import os, re, glob, sys
base = sys.argv[1]
dirs = sys.argv[2:]
bad = []
for d in dirs:
    for p in glob.glob(os.path.join(base, d, '**/*.md'), recursive=True):
        if '/evals/' in p: continue
        t = open(p, encoding='utf-8').read()
        # strip fenced code
        t2 = re.sub(r'```.*?```', '', t, flags=re.S)
        for m in re.finditer(r'\[[^\]]*\]\(([^)\s]+)\)', t2):
            href = m.group(1)
            if re.match(r'^(https?:|mailto:|#)', href): continue
            path = href.split('#')[0]
            if not path: continue
            tgt = os.path.normpath(os.path.join(os.path.dirname(p), path))
            if not os.path.exists(tgt):
                bad.append((os.path.relpath(p, base), href))
for b in bad: print('BROKEN', *b)
print('broken links:', len(bad))

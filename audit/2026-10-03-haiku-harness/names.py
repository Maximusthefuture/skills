import os, re, glob
B='/Users/maximusthefuture/Downloads/files'
known=set()
for p in glob.glob(B+'/**/SKILL.md', recursive=True):
    if '/orders-service/' in p or '/evals/' in p: continue
    m=re.search(r'^name:\s*"?([\w-]+)', open(p).read(), re.M)
    if m: known.add(m.group(1))
for p in glob.glob(B+'/backend-design-java/agents/*.md')+glob.glob(B+'/java-dev-flow/assets/agents/*.md'):
    known.add(os.path.basename(p)[:-3])
for p in glob.glob(B+'/backend-design-java/commands/*.md'):
    known.add(os.path.basename(p)[:-3])
known |= {'test-audit','backend-design','backend-design-java','anthropic-skills','openspec-propose','openspec-apply-change','java-flow','spec-driven','critic-gate'}
files = glob.glob(B+'/java-dev-flow/**/*.md', recursive=True)+[B+'/java-spec-review/SKILL.md',B+'/java-tdd/SKILL.md',B+'/java-diagnosing-bugs/SKILL.md',B+'/java-code-review/SKILL.md',B+'/java-extensibility-review/SKILL.md',B+'/README.md']+glob.glob(B+'/java-spec-review/references/*.md')
cand={}
for f in files:
    for m in re.finditer(r'`([a-z][a-z0-9]+(?:-[a-z0-9]+)+)`', open(f).read()):
        n=m.group(1)
        if n not in known: cand.setdefault(n,set()).add(os.path.relpath(f,B))
for n,fs in sorted(cand.items()): print(n, '<-', ', '.join(sorted(fs))[:150])

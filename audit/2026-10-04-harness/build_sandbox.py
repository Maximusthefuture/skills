"""Собирает песочницу orders-service с .claude из дерева скиллов (RU или EN).
usage: build_sandbox.py <variant_root> <out_dir>
  variant_root — каталог с java-dev-flow/, backend-design-java/, ... (снимок или ~/Downloads/files)
  out_dir      — куда положить orders-service/ (база берётся из $AUDIT_DIR/base/orders-service)
Хуки в settings.json ссылаются на скрипты из variant_root, поэтому язык их сообщений совпадает с вариантом."""
import json, os, shutil, subprocess, sys

A = os.environ['AUDIT_DIR']
FILES = '/Users/maximusthefuture/Downloads/files'
variant, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
sb = os.path.join(out, 'orders-service')
shutil.rmtree(sb, ignore_errors=True)
shutil.copytree(os.path.join(A, 'base', 'orders-service'), sb, symlinks=True,
                ignore=shutil.ignore_patterns('target', '.DS_Store'))
c = os.path.join(sb, '.claude')
for d in ('skills', 'agents', 'commands'):
    os.makedirs(os.path.join(c, d), exist_ok=True)

def skill(src, name=None):
    shutil.copytree(src, os.path.join(c, 'skills', name or os.path.basename(src)),
                    ignore=shutil.ignore_patterns('evals', '.DS_Store', '__pycache__', 'tests'))

for s in ('java-dev-flow', 'java-tdd', 'java-code-review', 'java-extensibility-review', 'java-spec-review',
          'java-diagnosing-bugs', 'jira-tasks'):
    skill(os.path.join(variant, s))
for s in sorted(os.listdir(os.path.join(variant, 'backend-design-java', 'skills'))):
    skill(os.path.join(variant, 'backend-design-java', 'skills', s))
for s in ('grilling', 'grill-me', 'handoff'):
    skill(os.path.join(variant, 'mattpocock-skills', s))
skill(os.path.join(variant, 'test-audit') if os.path.isdir(os.path.join(variant, 'test-audit'))
      else os.path.join(FILES, 'orders-service', '.claude', 'skills', 'test-audit'))
for s in sorted(os.listdir(os.path.join(FILES, 'orders-service', '.claude', 'skills'))):
    if s.startswith('openspec-'):
        skill(os.path.join(FILES, 'orders-service', '.claude', 'skills', s))
for d in (os.path.join(variant, 'java-dev-flow', 'assets', 'agents'), os.path.join(variant, 'backend-design-java', 'agents')):
    for f in os.listdir(d):
        if f.endswith('.md'):
            shutil.copy(os.path.join(d, f), os.path.join(c, 'agents', f))
for f in os.listdir(os.path.join(variant, 'backend-design-java', 'commands')):
    shutil.copy(os.path.join(variant, 'backend-design-java', 'commands', f), os.path.join(c, 'commands', f))
shutil.copytree(os.path.join(FILES, 'orders-service', '.claude', 'commands', 'opsx'), os.path.join(c, 'commands', 'opsx'))

hooks = os.path.join(variant, 'java-dev-flow', 'assets', 'hooks')
bdj = os.path.join(variant, 'backend-design-java', 'hooks')
cfg = json.load(open(os.path.join(hooks, 'settings.example.json')))
def fix(cmd):
    return (cmd.replace('~/.claude/hooks/backend-design-java/', bdj + '/')
               .replace('~/.claude/hooks/', hooks + '/'))
for event in cfg['hooks'].values():
    for group in event:
        for h in group['hooks']:
            if h.get('type') == 'command':
                h['command'] = fix(h['command'])
json.dump(cfg, open(os.path.join(c, 'settings.json'), 'w'), ensure_ascii=False, indent=2)

claude_md = os.path.join(variant, 'orders-service.CLAUDE.md')
shutil.copy(claude_md if os.path.exists(claude_md) else os.path.join(FILES, 'orders-service', 'CLAUDE.md'),
            os.path.join(sb, 'CLAUDE.md'))
for cmd in (['git', 'init', '-q'], ['git', 'add', '-A'],
            ['git', '-c', 'user.email=a@a', '-c', 'user.name=audit', 'commit', '-q', '-m', 'base']):
    subprocess.run(cmd, cwd=sb, check=True)
print(sb)

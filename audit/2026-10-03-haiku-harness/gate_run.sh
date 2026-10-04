#!/bin/bash
S=${AUDIT_DIR}
name=$1; prompt=$2
rm -rf $S/gate-sb/$name; mkdir -p $S/gate-sb/$name; cp -R $S/sandbox/orders-service $S/gate-sb/$name/
cd $S/gate-sb/$name/orders-service
PATH=$S/bin:$PATH claude -p "$prompt" --model haiku --output-format stream-json --verbose --include-hook-events --no-session-persistence \
  --allowedTools "Agent" "Read" "Grep" "Glob" "Skill" "Edit" "Write" "Bash(git:*)" "Bash(mvn:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)" \
  < /dev/null > $S/runs/gate-$name.jsonl 2> $S/runs/gate-$name.err
echo "$name exit $?"

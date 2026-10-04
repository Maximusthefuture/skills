#!/bin/bash
# Runs java-code-reviewer + critic on the seeded diff. usage: agents_run.sh <label> <ru|en> <sandbox/orders-service>
set -e
A=$AUDIT_DIR; H=$(cd "$(dirname "$0")" && pwd)
label=$1; lang=$2; src=$3
W=$A/agents-sb/$label; rm -rf $W; mkdir -p $W; cp -R $src $W/
SB=$W/orders-service
"$H/seed.sh" $SB > /dev/null
prompt=$(sed "s#{SB}#$SB#g" $H/agents_prompt.$lang.txt)
cd $SB
claude -p "$prompt" --model haiku --output-format stream-json --verbose --no-session-persistence \
  --allowedTools "Agent" "Read" "Grep" "Glob" "Skill" "Bash(git:*)" "Bash(./mvnw:*)" "Bash(bash:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)" \
  < /dev/null > $A/runs/agents-$label.jsonl 2> $A/runs/agents-$label.err
echo "$label exit $?"

#!/bin/bash
# Повтор сценария gate без Agent: видно только решение судьи
S=${AUDIT_DIR}
name=$1; prompt=$2
rm -rf $S/gate-sb/$name; mkdir -p $S/gate-sb/$name; cp -R $S/sandbox/orders-service $S/gate-sb/$name/
cd $S/gate-sb/$name/orders-service
claude -p "$prompt" --model haiku --output-format json --no-session-persistence --debug-file $S/runs/judge-$name.debug \
  --disallowedTools Agent --allowedTools "Read" "Grep" "Glob" "Edit" "Bash(git:*)" < /dev/null > $S/runs/judge-$name.json 2>&1
dec=$(grep -o 'Hooks: Model response: .\{0,160\}' $S/runs/judge-$name.debug | sed 's/Hooks: Model response: //' | tr '\n' ' ')
echo "$name :: $dec"

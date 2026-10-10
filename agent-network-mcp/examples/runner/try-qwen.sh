#!/bin/bash
# Smoke run: two Qwen Code agents under the runner work in a temporary folder (no git, nothing outside the temp dir
# changes). Shows whether a local model gets through the whole swarm cycle DISCUSS → IMPLEMENT → SYNC → INTEGRATE → DONE.
#
#   bash examples/runner/try-qwen.sh                    # SCENARIO=followups (default)
#   SCENARIO=basic bash examples/runner/try-qwen.sh
#
# Scenarios:
#   followups  one task with --follow-ups 1: backend has two steps (subtasks), the lead turns the left-over README into
#              a follow-up task at INTEGRATE, the agents pick it up by themselves
#   basic      two tasks from the operator in a row; checks that the runners wait without a model in between
#
# Settings (environment):
#   SCENARIO      followups | basic                    (default followups)
#   MODEL         model id from LM Studio            (default qwen/qwen3.5-9b)
#   REVIEWER_MODEL  the reviewer's model, to try two models in one swarm (default MODEL)
#   BASE_URL      OpenAI-compatible endpoint          (default http://192.168.31.7:1234/v1)
#   USE_SETTINGS  1 = take the provider for MODEL from ~/.qwen/settings.json instead of BASE_URL (default 0)
#   TASK_TIMEOUT  seconds to wait for each task       (default 1800)
# Ctrl+C stops everything. The temp folder stays for the logs; its path is printed at the start and the end.
set -u

AN="$(cd "$(dirname "$0")/../.." && pwd)"
MODEL="${MODEL:-qwen/qwen3.5-9b}"
REVIEWER_MODEL="${REVIEWER_MODEL:-$MODEL}"
BASE_URL="${BASE_URL:-http://192.168.31.7:1234/v1}"
USE_SETTINGS="${USE_SETTINGS:-0}"
TASK_TIMEOUT="${TASK_TIMEOUT:-1800}"
SCENARIO="${SCENARIO:-followups}"
case "$SCENARIO" in followups|basic) ;; *) echo "SCENARIO must be followups or basic"; exit 1 ;; esac
BIN=(node "$AN/dist/index.js")

# 1. Preconditions
command -v qwen >/dev/null || { echo "qwen is not installed"; exit 1; }
if [ "$USE_SETTINGS" != 1 ]; then
  for m in "$MODEL" "$REVIEWER_MODEL"; do
    if ! curl -sS -m 5 "$BASE_URL/models" | grep -q "\"$m\""; then
      echo "The model server does not answer or has no $m:"
      curl -sS -m 5 "$BASE_URL/models" | head -c 300; echo
      echo "LM Studio: Developer → Start Server, Server Settings → Serve on Local Network; load $m."
      exit 1
    fi
  done
fi
[ -f "$AN/dist/index.js" ] || (cd "$AN" && npm run build >/dev/null) || exit 1

# 2. A temporary stand
RUN="$(mktemp -d "${TMPDIR:-/tmp}/try-qwen.XXXXXX")"
PROJECT="$RUN/project"; NET="$PROJECT/.agent-network"
mkdir -p "$PROJECT"
sed "s#/abs/path/agent-network-mcp#$AN#" "$AN/examples/runner/qwen-mcp.json" > "$RUN/qwen-mcp.json"
echo "stand: $RUN"
echo "watch it live in another terminal: node $AN/dist/index.js ui --network-dir $NET"

MODEL_FLAGS=(-m "{model}")   # the runner puts the agent's --model here
[ "$USE_SETTINGS" = 1 ] || MODEL_FLAGS+=(--auth-type openai --openai-base-url "$BASE_URL" --openai-api-key lm-studio)

PIDS=()
cleanup() {
  [ ${#PIDS[@]} -gt 0 ] && kill -TERM "${PIDS[@]}" 2>/dev/null
  wait 2>/dev/null
}
trap 'echo; echo "stopping..."; cleanup; echo "logs: $RUN"; exit 130' INT TERM

runner() {
  local id=$1 model=$2
  "${BIN[@]}" run --agent "$id" --model "$model" --network-dir "$NET" --cwd "$PROJECT" \
    --prompt-file "$AN/examples/runner/qwen-prompt.md" --system-prompt-file "$AN/examples/runner/swarm-system-prompt.md" --max-restarts 2 -- \
    qwen "{prompt}" -o stream-json --system-prompt "{systemPrompt}" --exclude-tools web_fetch agent list_agents skill get_goal update_goal manage_memory search_memory notebook_edit "${MODEL_FLAGS[@]}" \
      --mcp-config "$RUN/qwen-mcp.json" \
      --approval-mode auto-edit --allowed-tools mcp__agent-network \
      --max-session-turns 200 --max-wall-time 40m \
    > "$RUN/$id.log" 2>&1 &
  PIDS+=($!)
}

task_state() { python3 -c "import json;t=json.load(open('$NET/tasks/$1/task.json'));print(t['status'],t['phase'])" 2>/dev/null; }

wait_task() {
  local id=$1 start=$SECONDS last=""
  while :; do
    local s; s=$(task_state "$id")
    [ "$s" != "$last" ] && { echo "$(date +%T) $id: $s"; last=$s; }
    case "$s" in COMPLETED*|CANCELLED*|BLOCKED*) return 0 ;; esac
    if [ $((SECONDS - start)) -ge "$TASK_TIMEOUT" ]; then echo "$(date +%T) $id: timeout after ${TASK_TIMEOUT}s"; return 1; fi
    sleep 5
  done
}

idle_check() {
  sleep 15
  local busy=0; for p in "${PIDS[@]}"; do pgrep -P "$p" >/dev/null && busy=1; done
  [ $busy = 0 ] && echo "$1: no qwen sessions (runners idle without a model)" || echo "$1: a qwen session is still running"
}

# 3. Tasks and runners
if [ "$SCENARIO" = followups ]; then
  "${BIN[@]}" task create --network-dir "$NET" --follow-ups 1 --agents backend,reviewer --title "Greeting files" \
    --description "Agent backend creates two files in the project root, as two separate steps: hello.txt with the line hello and world.txt with the line world. Agent reviewer creates bye.txt with the line bye. In SYNC each agent checks the other agent's files. Known left-over work for later: a README.md that lists the three files; when you integrate, put it into ONE follow-up task (backend writes README.md, reviewer only checks it) and do not do it in this task." >/dev/null
else
  "${BIN[@]}" task create --network-dir "$NET" --agents backend,reviewer --title "Greeting files" \
    --description "Create two text files in the project root. Agent backend creates hello.txt containing exactly one line: hello. Agent reviewer creates bye.txt containing exactly one line: bye. No other files. In SYNC each agent checks the other agent's file content." >/dev/null
fi
runner backend "$MODEL"
runner reviewer "$REVIEWER_MODEL"
echo "scenario $SCENARIO; runners started (backend on $MODEL, reviewer on $REVIEWER_MODEL)"
wait_task task-001; ok1=$?

ok2=1
if [ $ok1 != 0 ] || [ "$(task_state task-001)" != "COMPLETED DONE" ]; then
  echo "task-001 did not finish: stopping here"
elif [ "$SCENARIO" = followups ]; then
  # 4. The lead should have created the follow-up; the agents take it up by themselves
  for _ in $(seq 1 24); do [ -f "$NET/tasks/task-002/task.json" ] && break; sleep 5; done
  if [ -f "$NET/tasks/task-002/task.json" ]; then
    echo "$(date +%T) follow-up created by the lead: task-002"
    wait_task task-002; ok2=$?
    idle_check "after the chain"
  else
    echo "no follow-up task: the lead did not use followUps (see the integration result below)"
  fi
else
  # 4. Between tasks the runners must be idle; then the operator gives task 2
  idle_check "between tasks"
  "${BIN[@]}" task create --network-dir "$NET" --agents backend,reviewer --title "Second lines" \
    --description "Append a second line to the greeting files. Agent backend appends the line world to hello.txt. Agent reviewer appends the line again to bye.txt. Change nothing else. In SYNC each agent checks the other agent's file content." >/dev/null
  wait_task task-002; ok2=$?
fi

# 6. Summary (let the sessions finish their last turn before stopping the runners)
for _ in $(seq 1 30); do
  busy=0; for p in "${PIDS[@]}"; do pgrep -P "$p" >/dev/null && busy=1; done
  [ $busy = 0 ] && break; sleep 1
done
cleanup
echo
echo "=== tasks"
"${BIN[@]}" task list --network-dir "$NET" | python3 -c "import json,sys;[print(' ',t['id'],t['status'],t['phase'],'syncRound',t.get('syncRound'),('parent '+t['parentTaskId']) if t.get('parentTaskId') else '',('followUps '+t['followUps']) if t.get('followUps') else '',t.get('blockedReason') or '') for t in json.load(sys.stdin)]"
echo "=== subtasks"
for f in "$NET"/tasks/*/subtasks/*.json; do
  [ -f "$f" ] && python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(' ',d['taskId'],d['agentId']+':');[print('    ',i['id'],i['status'],i['title'],('('+i['note']+')') if i.get('note') else '') for i in d['items']]" "$f"
done
echo "=== integration results"
for f in "$NET"/tasks/*/integration/*.json; do
  [ -f "$f" ] && python3 -c "import json,sys;r=json.load(open(sys.argv[1]));print(' ',r['taskId'],r['status'],'-',r['result'][:200])" "$f"
done
echo "=== files"
for f in "$PROJECT"/*.txt "$PROJECT"/*.md; do [ -f "$f" ] && { echo "--- $(basename "$f")"; cat "$f"; echo; }; done
echo "=== runner events"
grep -h "^\[runner" "$RUN/backend.log" "$RUN/reviewer.log"
echo "=== messages between agents: $(ls "$NET"/tasks/*/messages 2>/dev/null | grep -c json)"
echo
echo "result: task-001 $(task_state task-001), task-002 $(task_state task-002 || true)"
echo "logs and network: $RUN"

#!/bin/bash
# Live check: do Qwen Code agents of the swarm start subagents? Two agents (backend leads, reviewer reviews) on a tiny
# git project in a temp folder; the task tells backend to hand the search for TODO comments to the "helper" subagent
# (.qwen/agents/helper.md: read and search only, no swarm tools) and to write TODO_REPORT.md from its report.
# The page shows it all; at the end the script says whether a subagent ran and whether it kept off the swarm tools.
#
#   bash examples/runner/try-subagents-qwen.sh
#   BASE_URL=http://127.0.0.1:1234/v1 bash examples/runner/try-subagents-qwen.sh
#
# Settings (environment):
#   MODEL         model id from LM Studio            (default qwen/qwen3.5-9b)
#   BASE_URL      OpenAI-compatible endpoint          (default http://192.168.31.7:1234/v1, as in try-qwen.sh)
#   PORT          the page                            (default 4793)
#   TASK_TIMEOUT  seconds to wait for the task        (default 1800)
# Ctrl+C stops everything. The temp folder stays for the logs; its path is printed at the start and the end.
set -u

AN="$(cd "$(dirname "$0")/../.." && pwd)"
MODEL="${MODEL:-qwen/qwen3.5-9b}"
BASE_URL="${BASE_URL:-http://192.168.31.7:1234/v1}"
PORT="${PORT:-4793}"
TASK_TIMEOUT="${TASK_TIMEOUT:-1800}"
BIN=(node "$AN/dist/index.js")
URL="http://127.0.0.1:$PORT"

# 1. Preconditions
command -v qwen >/dev/null || { echo "qwen is not installed"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is needed to write the config"; exit 1; }
if ! curl -sS -m 5 "$BASE_URL/models" | grep -q "\"$MODEL\""; then
  echo "The model server at $BASE_URL does not answer or has no $MODEL:"
  curl -sS -m 5 "$BASE_URL/models" | head -c 300; echo
  echo "LM Studio: Developer → Start Server; load $MODEL (a model with tool calling)."
  exit 1
fi
[ -f "$AN/dist/index.js" ] || (cd "$AN" && npm run build >/dev/null) || exit 1

# 2. A temporary stand: a small git project with TODOs, the helper subagent, one worktree per agent
RUN="$(mktemp -d "${TMPDIR:-/tmp}/try-subagents.XXXXXX")"
P="$RUN/project"; NET="$P/.agent-network"
mkdir -p "$P/src/orders" "$P/src/payments" "$P/src/util" "$P/.qwen/agents"
cat > "$P/src/orders/OrderService.java" <<'EOF'
package orders;
public class OrderService {
  // TODO: validate the currency before saving
  public void save() {}
  // TODO(payments): refund partially paid orders
  public void cancel() {}
}
EOF
cat > "$P/src/payments/Gateway.java" <<'EOF'
package payments;
public class Gateway {
  public void charge() { /* TODO: retry on timeout with backoff */ }
}
EOF
cat > "$P/src/util/Dates.java" <<'EOF'
package util;
public class Dates {
  // FIXME: time zone is hard-coded
  // TODO: move to java.time
  static String now() { return ""; }
}
EOF
printf '# shop\nTODO: write the README\n' > "$P/README.md"
printf '.agent-network/\n' > "$P/.gitignore"
cp "$AN/examples/runner/qwen-agents/helper.md" "$P/.qwen/agents/helper.md"   # the shipped helper subagent
(cd "$P" && git init -q -b main && git add . && git -c user.email=t@t -c user.name=t commit -qm init \
  && git worktree add -q "$RUN/project-backend" -b swarm-backend && git worktree add -q "$RUN/project-reviewer" -b swarm-reviewer) || exit 1
sed "s#/abs/path/agent-network-mcp#$AN#" "$AN/examples/runner/qwen-mcp.json" > "$RUN/qwen-mcp.json"

# 3. runners.json from the Qwen example: paths, model and endpoint of this run, short sessions
python3 - "$AN" "$RUN" "$MODEL" "$BASE_URL" <<'EOF'
import json, sys
an, run, model, base = sys.argv[1:]
ex = json.load(open(f"{an}/examples/runner/runners.qwen.example.json"))
cmd = [c.replace("/abs/path/agent-network-mcp/examples/runner/qwen-mcp.json", f"{run}/qwen-mcp.json") for c in ex["defaults"]["command"]]
cmd[cmd.index("--openai-base-url") + 1] = base
cmd[cmd.index("--max-session-turns") + 1] = "40"
assert "agent" not in cmd, "the agent tool must not be excluded"
cfg = {
    "networkDir": f"{run}/project/.agent-network",
    "defaults": {**ex["defaults"], "command": cmd, "model": model, "models": [model],
                 "promptFile": f"{an}/examples/runner/qwen-prompt.md", "systemPromptFile": f"{an}/examples/runner/swarm-system-prompt.md", "maxRestarts": 1},
    "agents": [
        {"id": "backend", "cwd": f"{run}/project-backend", "instructionsFile": f"{an}/examples/runner/instructions/backend.md"},
        {"id": "reviewer", "cwd": f"{run}/project-reviewer", "instructionsFile": f"{an}/examples/runner/instructions/reviewer.md"},
    ],
    "prices": {model: {"input": 0, "output": 0}},
}
json.dump(cfg, open(f"{run}/runners.json", "w"), indent=2)
EOF

"${BIN[@]}" task create --network-dir "$NET" --agents backend,reviewer --title "TODO report" \
  --description "Write TODO_REPORT.md at the repository root: every TODO and FIXME comment in the repository (src/ and README.md), one line each: file:line, the text. backend: hand the search to the helper subagent (the agent tool, subagent helper) and write the file from its report, commit it. reviewer: review only (check the report against the code with grep), change nothing." >/dev/null || exit 1

# 4. The page with the runners; wait for the task
echo "stand: $RUN"
echo "page:  $URL  (task-001; tab Активность shows the agents' calls, subagent ones marked)"
"${BIN[@]}" ui --runners "$RUN/runners.json" --port "$PORT" > "$RUN/ui.log" 2>&1 &
UI=$!
trap 'kill -TERM $UI 2>/dev/null; wait $UI 2>/dev/null; echo; echo "stopped; stand: $RUN"; exit 130' INT TERM
for _ in $(seq 1 30); do curl -s -o /dev/null "$URL/api/state" && break; sleep 1; done
start=$(date +%s); status=""
while [ $(( $(date +%s) - start )) -lt "$TASK_TIMEOUT" ]; do
  status=$(curl -s "$URL/api/state" | python3 -c 'import json,sys; t=json.load(sys.stdin)["tasks"][0]; print(t["status"], t["phase"])' 2>/dev/null)
  printf '\r%s  %ss ' "$status" $(( $(date +%s) - start ))
  case "$status" in COMPLETED*|CANCELLED*|BLOCKED*) break ;; esac
  sleep 10
done
echo

# 5. What happened
curl -s "$URL/api/activity?limit=3000" | python3 -c '
import json, sys
ev = json.load(sys.stdin)["events"]
calls = [e for e in ev if e["kind"] == "tool_use" and (e.get("tool") or "").lower() in ("agent", "task")]
inner = [e for e in ev if e.get("sub")]
swarm_from_sub = [e for e in inner if e["kind"] == "tool_use" and "agent-network" in (e.get("tool") or "")]
print(f"subagent calls: {len(calls)}")
for e in calls: print(f"  {e[\"agentId\"]}: {e[\"summary\"][:160]}")
print(f"events inside subagents (marked sub): {len(inner)}" + ("" if inner else "  (Qwen may not mark them: see the activity tab)"))
print("swarm tools called from a subagent: " + (", ".join(e["tool"] for e in swarm_from_sub) if swarm_from_sub else "none"))
'
[ -f "$RUN/project-backend/TODO_REPORT.md" ] && { echo "--- TODO_REPORT.md (backend worktree)"; cat "$RUN/project-backend/TODO_REPORT.md"; }
echo "task: $status · stand: $RUN · page still at $URL — Ctrl+C to stop"
wait $UI

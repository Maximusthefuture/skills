#!/usr/bin/env bash
# Prepares a demo project for the real-agent test: one git repo, two worktrees (one per agent,
# so they do not overwrite each other's files) and a Qwen CLI config per worktree that points both
# agents at the SAME .agent-network directory.
set -euo pipefail

DEMO="${1:-$HOME/agent-network-demo}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$ROOT/dist/index.js"
[ -f "$SERVER" ] || { echo "dist/index.js not found - run 'npm run build' first" >&2; exit 1; }

rm -rf "$DEMO"
mkdir -p "$DEMO/main"
git -C "$DEMO/main" init -q -b main
printf '.agent-network/\n' > "$DEMO/main/.gitignore"
printf '# demo\n' > "$DEMO/main/README.md"
git -C "$DEMO/main" add .
git -C "$DEMO/main" -c user.name=demo -c user.email=demo@example.com commit -q -m init

NETWORK_DIR="$DEMO/main/.agent-network"
for id in backend reviewer; do
  git -C "$DEMO/main" worktree add -q "$DEMO/$id" -b "$id"
  mkdir -p "$DEMO/$id/.qwen"
  cat > "$DEMO/$id/.qwen/settings.json" <<JSON
{
  "mcpServers": {
    "agent-network": {
      "command": "$(command -v node)",
      "args": ["$SERVER"],
      "env": {
        "AGENT_ID": "$id",
        "AGENT_TYPE": "qwen",
        "AGENT_ROLE": "$id",
        "NETWORK_DIR": "$NETWORK_DIR"
      },
      "trust": true
    }
  }
}
JSON
  cp "$ROOT/AGENTS.md" "$DEMO/$id/AGENTS.md"
  cp "$ROOT/AGENTS.md" "$DEMO/$id/QWEN.md"
done

node "$SERVER" task create --network-dir "$NETWORK_DIR" \
  --title "User registration endpoint" \
  --description "Implement a REST endpoint for user registration. backend: REST controller and service (src/). reviewer: validation (src/) and review of the backend implementation." \
  --agents backend,reviewer > /dev/null

cat <<EOF2

Demo ready in $DEMO  (task-001 already created for backend and reviewer)

Terminal 1:  cd $DEMO/backend  && QWEN_CODE_ENABLE_AGENT_TEAM=1 qwen
Terminal 2:  cd $DEMO/reviewer && QWEN_CODE_ENABLE_AGENT_TEAM=1 qwen

Prompt for both (identical):
  You are an agent in the agent-network swarm. Follow AGENTS.md: start with swarm_context and keep
  following nextAction until it is "done".

Watch progress:  node $SERVER task list --network-dir $NETWORK_DIR
EOF2

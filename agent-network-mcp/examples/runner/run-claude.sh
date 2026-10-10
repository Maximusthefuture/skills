#!/bin/bash
# Two Claude Code agents that keep working across tasks: one runner per agent, one git worktree per agent,
# one shared network directory. Stop with Ctrl+C. Replace the /abs/path values first.
set -euo pipefail

AN=/abs/path/agent-network-mcp
PROJECT=/abs/path/project               # main checkout; worktrees ../project-backend and ../project-reviewer
NETWORK_DIR=$PROJECT/.agent-network
MCP=$AN/examples/runner/mcp.json        # AGENT_ID and NETWORK_DIR are filled in by the runner
SETTINGS=$AN/examples/claude-hooks/settings.json   # optional: hooks for messages and the Stop reminder

agent() {
  local id=$1
  node "$AN/dist/index.js" run --agent "$id" --network-dir "$NETWORK_DIR" --cwd "$PROJECT-$id" \
    --system-prompt-file "$AN/examples/runner/swarm-system-prompt.md" -- \
    claude -p "{prompt}" --output-format stream-json --verbose --tools Read,Write,Edit,Glob,Grep,Bash --system-prompt "{systemPrompt}" --model sonnet --max-turns 200 \
      --mcp-config "$MCP" --strict-mcp-config --settings "$SETTINGS" \
      --permission-mode acceptEdits \
      --allowedTools mcp__agent-network Read Write Edit Glob Grep "Bash(git:*)" "Bash(./mvnw:*)"
}

agent backend &
agent reviewer &
trap 'kill 0' INT TERM
wait

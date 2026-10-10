#!/bin/bash
# Two Qwen Code agents that keep working across tasks: one runner per agent, one git worktree per agent,
# one shared network directory. Stop with Ctrl+C. Replace the /abs/path values first.
#
# Checked on Qwen Code 0.24.7:
# - qwen does NOT expand ${AGENT_ID} in --mcp-config, but passes its own environment to MCP servers, so
#   qwen-mcp.json has no AGENT_ID/NETWORK_DIR: the runner sets them for every session;
# - --mcp-config replaces a server with the same name from ~/.qwen/settings.json (e.g. a pool "backend,reviewer");
# - headless mode cannot ask for permission: --approval-mode auto-edit lets it edit files, --allowed-tools
#   mcp__agent-network allows the swarm tools, run_shell_command(<cmd>) allows that command (read-only commands like ls
#   are allowed anyway, anything else is declined); --approval-mode yolo allows everything, only in a sandbox;
# - --allowed-tools takes several values, so the prompt goes first, right after qwen.
set -euo pipefail

AN=/abs/path/agent-network-mcp
PROJECT=/abs/path/project               # main checkout; worktrees ../project-backend and ../project-reviewer
NETWORK_DIR=$PROJECT/.agent-network
MODEL=qwen/qwen3.5-9b                   # a model from modelProviders in ~/.qwen/settings.json

agent() {
  local id=$1
  node "$AN/dist/index.js" run --agent "$id" --network-dir "$NETWORK_DIR" --cwd "$PROJECT-$id" \
    --prompt-file "$AN/examples/runner/qwen-prompt.md" --system-prompt-file "$AN/examples/runner/swarm-system-prompt.md" -- \
    qwen "{prompt}" -o stream-json --system-prompt "{systemPrompt}" --exclude-tools web_fetch agent list_agents skill get_goal update_goal manage_memory search_memory notebook_edit -m "$MODEL" \
      --mcp-config "$AN/examples/runner/qwen-mcp.json" \
      --approval-mode auto-edit \
      --allowed-tools mcp__agent-network "run_shell_command(git)" "run_shell_command(./mvnw)" \
      --max-session-turns 300 --max-wall-time 1h
}

agent backend &
agent reviewer &
trap 'kill 0' INT TERM
wait

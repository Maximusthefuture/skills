#!/bin/bash
# Two Claude Code agents that keep working across tasks: one runner per agent, one git worktree per agent,
# one shared network directory. Stop with Ctrl+C. Replace the /abs/path values first.
set -euo pipefail

AN=/abs/path/agent-network-mcp
PROJECT=/abs/path/project               # main checkout; worktrees ../project-backend and ../project-reviewer
NETWORK_DIR=$PROJECT/.agent-network
MCP=$AN/examples/runner/mcp.json        # AGENT_ID and NETWORK_DIR are filled in by the runner
SETTINGS=$AN/examples/claude-hooks/settings.json   # optional: hooks for messages and the Stop reminder
BACKEND_MODEL=sonnet                    # each agent can run on its own model (put where the command has {model})
REVIEWER_MODEL=haiku

# Skill in --tools: the agents can load skills (java-dev-flow); drop it if they need none (every turn re-reads the skill list).
# git: only what the protocol needs; push, reset, checkout and branch -D are refused (-p cannot ask).
agent() {
  local id=$1 model=$2
  node "$AN/dist/index.js" run --agent "$id" --model "$model" --network-dir "$NETWORK_DIR" --cwd "$PROJECT-$id" \
    --system-prompt-file "$AN/examples/runner/swarm-system-prompt.md" -- \
    claude -p "{prompt}" --output-format stream-json --verbose --tools Read,Write,Edit,Glob,Grep,Bash,Skill --system-prompt "{systemPrompt}" --model "{model}" --max-turns 200 \
      --mcp-config "$MCP" --strict-mcp-config --settings "$SETTINGS" \
      --permission-mode acceptEdits \
      --allowedTools mcp__agent-network Read Write Edit Glob Grep "Bash(./mvnw:*)" \
        "Bash(git status:*)" "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
        "Bash(git add:*)" "Bash(git commit:*)" "Bash(git merge:*)" "Bash(git rev-parse:*)"
}

agent backend "$BACKEND_MODEL" &
agent reviewer "$REVIEWER_MODEL" &
trap 'kill 0' INT TERM
wait

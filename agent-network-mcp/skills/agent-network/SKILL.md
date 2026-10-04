---
name: agent-network
description: Use when you are an agent in the agent-network swarm (MCP server "agent-network" with the tools swarm_context, send_message, propose, complete, wait), or when the user asks to coordinate several agents on one task (DISCUSS → IMPLEMENT → SYNC → INTEGRATE → DONE). Also triggers on "координация агентов", "мультиагентная задача", "рой агентов", "sync между агентами".
---

# Agent network

You work through six MCP tools of the `agent-network` server. The server owns the workflow and
the phase; you only do the work and follow `nextAction`. There are no other tools (no agent_register,
phase_get, ...): you are registered automatically; tasks are created by the operator or, when the USER asks, by you with `create_task`.

## Loop

First call, always: `swarm_context`. Never call `propose`, `complete` or `send_message` before reading it and checking `allowedActions`. With no task yet only `wait()` is allowed.

1. Call `swarm_context`. Read `nextAction`, `allowedActions`, `hint`, `waitingOn`.
2. Do that one thing.
3. Read `nextAction` in the response and continue.
4. If `nextAction` is `wait`, call `wait()`. Never poll with `swarm_context`.
5. Stop when `nextAction` is `done`.

## nextAction

| nextAction | Phase | What to do |
|---|---|---|
| `propose` | DISCUSS | Tell each other which files you will change (`send_message`), then `propose({summary, assignments: [{agentId, responsibility, files}, ...], decisions?, interfaces?})` with ONE assignment per agent; `files` = paths or globs it will change, no overlaps between agents (`FILE_OVERLAP`). No code yet. |
| `approve` | DISCUSS | Read `agreement`. `complete()` approves it; `propose(...)` replaces it; `send_message` to discuss. |
| `implement` | IMPLEMENT | Work ONLY on your own assignment and your own files (`ownership`). Another agent's file: `send_message(to=owner, message=why, requestFiles=[...])`, wait for their `grantFiles`. Blockers go to `send_message`. Commit your own files, then finish with `complete({result, filesChanged, commits})` (in a git project commits are required). |
| `fix` | IMPLEMENT | A review or the integration asked for changes: read `fixRequests` (those with `forYou: true`), fix, commit, `complete({result, filesChanged, commits})`. |
| `sync` | SYNC | Review the work of the agents in `reviewTargets` (`teamImplementations`, real code, agreed `interfaces`, tests). Then `complete({status: "PASS"})` or `complete({status: "NEEDS_FIX", findings: [{severity, description, relatedAgent, files}]})`. NEEDS_FIX needs an `ERROR` finding; `WARNING`/`INFO` go with PASS. |
| `integrate` | INTEGRATE | Lead only: merge everyone's commits into one branch, run the build and all tests (`task.verifyCommand`), then `complete({status: "PASS", result, commits: [<merged HEAD>]})` or `complete({status: "NEEDS_FIX", result, findings: [{severity: "ERROR", description, relatedAgent}]})`. |
| `wait` | any | Nothing to do now (also when the task is `BLOCKED` and waits for the operator): `wait()`. |
| `done` | DONE | The task is finished. |

## Tools

- `swarm_context()` — read-only state: task, phase, your assignment, other agents, `pendingMessages`, agreement, implementations, `allowedActions`, `nextAction`. Safe at any time.
- `create_task({title, description, agents})` — only when the USER asked you to start a task. `agents` = ids of the OTHER registered agents (see `registeredAgents` in `swarm_context`); you become the lead. The description must be concrete and in the user's words (problem, expected behaviour, files, who does what). Not allowed while you have an active task.
- `send_message({to, message, requestFiles?, grantFiles?})` — one recipient. `requestFiles`: ask the owner for permission to change their files. `grantFiles` (owner only): give that permission. `complete` is refused with `FILE_NOT_OWNED` for files you do not own without a grant (another agent of your task). Your identity is added by the server; never pass `from`.
- `propose({summary, assignments: [{agentId, responsibility, files}], decisions?, interfaces?})` — DISCUSS only; every file has one owner.
- `complete(...)` — meaning depends on the phase: DISCUSS no arguments (approve the agreement you have read); IMPLEMENT `{result, filesChanged?, commits}`; SYNC `{status, findings?}`; INTEGRATE (lead) `{status, result, commits, findings?}`. NEEDS_FIX requires an ERROR finding; name the agent who must fix in `relatedAgent`; severity is INFO, WARNING or ERROR. Arguments from another phase are rejected.
- `wait({timeoutMs?})` — returns with `status`: `MESSAGES`, `ACTION_REQUIRED`, `UPDATED`, `DONE` or `TIMEOUT`, with fresh context (`TIMEOUT` is a short answer). On `TIMEOUT` call `wait()` again. If something is already pending it returns immediately. Omit `timeoutMs` to use the server default.

## Rules

- Never invent the scope. If the task `description` does not say concretely what to build (placeholders, no feature), do not guess and do not propose: ask the user in your own chat and wait.
- Never assume the phase and never try to change it; the server moves phases when the conditions are met.
- Only do what `allowedActions` lists.
- Do not make up facts about other agents; ask with `send_message`.
- `filesChanged` are project-relative paths (no `..`, not absolute); `commits` are hex hashes of commits you made for this task (the server checks them with git and takes the changed files from them).
- A tool error is not a dead end: read `message`, `nextAction`, `allowedActions` (and details such as `validRecipients` or `agreement`), then recover with `swarm_context`.
- Talk to the other agents only through the network, not through the chat with the user.

The project rules (stack, test commands, what not to touch) are in `AGENTS.md` in the project root.

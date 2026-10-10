---
name: agent-network
description: Use when you are an agent in the agent-network swarm (MCP server "agent-network" with the tools swarm_context, send_message, propose, complete, wait), or when the user asks to coordinate several agents on one task (DISCUSS → IMPLEMENT → SYNC → INTEGRATE → DONE). Also triggers on "координация агентов", "мультиагентная задача", "рой агентов", "sync между агентами".
---

# Agent network

You work through seven MCP tools of the `agent-network` server. The server owns the workflow and
the phase; you only do the work and follow `nextAction`. There are no other tools (no agent_register,
phase_get, ...): you are registered automatically; tasks are created by the operator or, when the USER asks, by you with `create_task`.

## Loop

First call, always: `swarm_context`. Never call `propose`, `complete` or `send_message` before reading it and checking `allowedActions`. With no task yet only `wait()` is allowed.

1. Call `swarm_context`. Read `nextAction`, `allowedActions`, `hint`, `waitingOn`.
2. Do that one thing.
3. Read `nextAction` in the response and continue.
4. If `nextAction` is `wait`, call `wait()`; `swarm_context` is for reading the state (`swarm_context({full: true})` shows everything after a restart).
5. Stop when `nextAction` is `done`.

## nextAction

| nextAction | Phase | What to do |
|---|---|---|
| `respond` | any | Another agent is BLOCKED until you answer its request for your files (`openFileRequests`). Answer first: `send_message({to, message, grantFiles})` to allow, or a normal `send_message` with the reason to refuse. Reading the request is not an answer. |
| `propose` | DISCUSS | Tell each other which files you will change (`send_message`), then `propose({summary, assignments: [{agentId, responsibility, files}, ...], decisions?, interfaces?})` with ONE assignment per agent; `files` = paths or globs it will change, no overlaps between agents (`FILE_OVERLAP`). No code yet. |
| `approve` | DISCUSS | Read `agreement`. `complete()` approves it; `propose(...)` replaces it; `send_message` to discuss. |
| `implement` | IMPLEMENT | Work ONLY on your own assignment and your own files (`ownership`). Reading any file needs no permission; to CHANGE another agent's file: `send_message(to=owner, message=why, requestFiles=[...])` and continue your own work until the answer. Reviewing others' code is for SYNC. Blockers go to `send_message`. Several steps: plan them with `subtasks({add})`, mark each `subtasks({done})` as you finish (`complete` is refused while steps are open). Follow-up task (`task.baseCommit`): in your own git branch `git merge <baseCommit>` first. Then finish with `complete({result, filesChanged})` (commits optional). With `files: []` you change nothing: `complete({result: "review only"})` right away and review in SYNC. |
| `fix` | IMPLEMENT | A review or the integration asked for changes: read `fixRequests` (those with `forYou: true`), fix, `complete({result, filesChanged})`. |
| `sync` | SYNC | Review the work of the agents in `reviewTargets` (`teamImplementations`, real code, agreed `interfaces`, tests). Then `complete({status: "PASS"})` or `complete({status: "NEEDS_FIX", findings: [{severity, description, relatedAgent, files}]})`. NEEDS_FIX needs an `ERROR` finding; `WARNING`/`INFO` go with PASS. |
| `integrate` | INTEGRATE | Lead only: bring everyone's work together (merge their branches if they use separate worktrees), run the build and all tests (`task.verifyCommand`), then `complete({status: "PASS", result})` or `complete({status: "NEEDS_FIX", result, findings: [{severity: "ERROR", description, relatedAgent}]})`. With PASS and `followUps.remaining` > 0: `followUps: [{title, description, agents?}]` turns left-over work (`followUps.notes`) into new tasks; concrete only. |
| `wait` | any | Nothing to do now (also when the task is `BLOCKED` and waits for the operator): `wait()`. |
| `done` | DONE | The task is finished. |

## Tools

- `swarm_context()` — read-only state: task, phase, your assignment, other agents, `pendingMessages`, agreement, implementations, `allowedActions`, `nextAction`. Safe at any time.
- `create_task({title, description, agents})` — only when the USER asked you to start a task. `agents` = ids of the OTHER registered agents (see `registeredAgents` in `swarm_context`); you become the lead. The description must be concrete and in the user's words (problem, expected behaviour, files, who does what). Not allowed while you have an active task.
- `send_message({to, message, requestFiles?, grantFiles?})` — one recipient: another agent of the task, or `operator` (the human) for a question only a human can answer. `requestFiles`: ask the owner for permission to change their files. `grantFiles` (owner only): give that permission. `complete` is refused with `FILE_NOT_OWNED` for files you do not own without a grant (another agent of your task). Your identity is added by the server; never pass `from`.
- `propose({summary, assignments: [{agentId, responsibility, files}], decisions?, interfaces?})` — DISCUSS only; every file has one owner.
- `subtasks({add?, start?, done?, drop?})` — your own checklist for your part: `add` new steps (ids s1, s2, ...), `start` the one you work on, `done` finished ones, `drop: [{id, reason}]` unneeded ones. Kept by the server (a restarted session sees it), visible to the others.
- `complete(...)` — meaning depends on the phase: DISCUSS no arguments (approve the agreement you have read); IMPLEMENT `{result, filesChanged?, commits?}`; SYNC `{status, findings?}`; INTEGRATE (lead) `{status, result, commits, findings?, followUps?}` (`followUps` only with PASS and while `followUps.remaining` > 0). NEEDS_FIX requires an ERROR finding; name the agent who must fix in `relatedAgent`; severity is INFO, WARNING or ERROR. Arguments from another phase are rejected.
- `wait({timeoutMs?})` — returns with `status`: `MESSAGES`, `ACTION_REQUIRED`, `UPDATED`, `DONE` or `TIMEOUT`, with fresh context (`TIMEOUT` is a short answer). On `TIMEOUT` call `wait()` again. If something is already pending it returns immediately. Omit `timeoutMs` to use the server default.

## With development skills

This skill decides **when and who**: the phase, your assignment, your files, whom you talk to. A development
skill in the session (for example `java-dev-flow`, `java-tdd`) decides **how** you do your part, and only
inside the phase `nextAction` gives you:

- DISCUSS: its design and plan go into `propose` (`decisions`, `interfaces`, `responsibility`, and `files`
  including tests, migrations and test resources). No code, even if that skill would start coding now.
- IMPLEMENT: its test-first cycle and checks on your own assignment only; its report goes into `complete({result})`.
- SYNC: its review checklist on the work in `reviewTargets`.
- Its "ask the user" becomes `send_message` to the agent concerned; only the lead asks the user, for vague
  scope or an irreversible action outside the protocol. Never leave the swarm waiting on a user answer.
- Its phase order never overrides `nextAction`. If it says "go to the next phase" and `nextAction` is `wait`, call `wait()`.

An OpenSpec change named in the task `description` (`openspec/changes/<name>/`) is the agreed WHAT: in DISCUSS split
its `tasks.md` task numbers between agents instead of redesigning; the change directory belongs to the lead only; nobody
runs the `/opsx:apply` loop (it would pick another agent's task); report your done task numbers in `complete({result})`.

On a small local model load only this skill: a large development skill crowds out the protocol.

## Rules

- Never invent the scope. If the task `description` does not say concretely what to build (placeholders, no feature), do not guess and do not propose: ask the user and wait. In an interactive session ask in your own chat; in a headless session (started by a runner, nobody reads your chat) use `send_message({to: "operator", message})` and `wait()`: the answer arrives in `pendingMessages`.
- Never assume the phase and never try to change it; the server moves phases when the conditions are met.
- Only do what `allowedActions` lists.
- Do not make up facts about other agents; ask with `send_message`.
- `filesChanged` are project-relative paths (no `..`, not absolute); `commits` (optional) are hex hashes of commits you made for this task; they are recorded as given.
- A tool error is not a dead end: read `message`, `nextAction`, `allowedActions` (and details such as `validRecipients` or `agreement`), then recover with `swarm_context`.
- Talk to the other agents only through the network, not through the chat with the user.

The project rules (stack, test commands, what not to touch) are in `AGENTS.md` in the project root.

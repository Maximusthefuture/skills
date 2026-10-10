# Agent-network swarm mode

**Open when:** the session has the `agent-network` MCP tools (`swarm_context`, `propose`, `complete`, `wait`, ...) and `swarm_context` shows an active task with you assigned.

## Who owns what

The swarm and the orchestrator do not compete: the swarm decides **when and who**, the orchestrator decides **how**.

| What | Owner |
|---|---|
| Phase, its transitions, whose turn it is | the server (`nextAction`, `allowedActions`). Never skip a `wait()` to "get ahead" |
| Who does which part, file ownership | the agreement (`propose` / approve) |
| Classification, design, plan, test discipline, verification of your own part | this orchestrator |
| Talking to other agents | `send_message`, never the user chat |
| Final report | `complete({result, ...})`; the lead's INTEGRATE result is the task report |

If an `agent-network` rule and an orchestrator rule disagree about phases, ownership, messages or what to submit, the swarm is right. If they disagree about how to design, write code and tests or verify them, the orchestrator is right.

## Orchestrator phases inside swarm phases

| Swarm phase (`nextAction`) | Orchestrator phases | What you do |
|---|---|---|
| DISCUSS (`propose`, `approve`) | 0–3 | Classification line for the whole task (lead) or your part. Design and plan only, **no code, no files written**. Results go into the agreement, see below |
| IMPLEMENT (`implement`) | 4, 5 for your part | `java-tdd` for every behavior of your assignment, full test run, `critic` on your diff for M and L, `complete` |
| IMPLEMENT (`fix`) | route B | Every `fixRequests` item with `forYou: true` is a bug: a test that fails on exactly it first, then the fix |
| SYNC (`sync`) | 5 for another agent's part | Review `reviewTargets`, see below |
| INTEGRATE (`integrate`, lead) | 5, 6 | Merge, full run of `task.verifyCommand`, evidence rule, report in `result` |

### DISCUSS: what goes into the agreement

- `decisions`: the design summary (`references/templates.md`, 10–20 lines for M), with domain skills by signals as usual.
- `interfaces`: every contract between agents: endpoints and DTOs, event payloads, tables and columns, method signatures one agent calls on another's code. This is what SYNC reviewers check against.
- `assignments[].responsibility`: the plan for that agent: behaviors and test boundaries.
- `assignments[].files`: production files **and** their tests, changesets, test resources, config. A file you forget here costs a `requestFiles` round trip or a `FILE_NOT_OWNED` refusal later. A shared file (`pom.xml`, `application.yml`, a common DTO) gets one owner; the others ask that owner in IMPLEMENT.
- Approving someone else's agreement: check it against the same items before `complete()`. A missing interface or a test without an owner is a reason to `send_message` or `propose` a replacement.

L: the "user approves design and plan" gate becomes "all agents approve the agreement". If the requirements are vague (L, phase 1), only the lead asks the user, and only before `propose`.

### IMPLEMENT

- Only your assignment and your files (`ownership.yourFiles`, granted files). Another agent's file: `send_message({to, message, requestFiles})` and `wait()`. Never edit it "just this once".
- The plan of your part (the behaviors from `responsibility`, one `java-tdd` cycle each) goes into `subtasks({add: [...]})`; mark each behavior `done` after its test went red → green. A restarted session continues from the first open subtask, and `complete` is refused while any is open.
- In a follow-up task (`task.baseCommit` is set) working in your own git branch, merge the parent's result first: `git merge <baseCommit>`.
- Phase 4 as usual: domain skills of the slice, `java-tdd` per behavior, hook warnings handled.
- Phase 5 for your part: full test run of the project (or at least of your module, named in `result`), then the `critic` agent on your diff for M and L. **Do not run `java-code-reviewer` here**: the SYNC reviewer is the fresh-context reviewer. Critic blockers are fixed test-first before `complete`; critic questions go into `result`.
- Commits are optional in the swarm (pass their hashes to `complete` if you made them; they help the lead merge separate worktrees). Committing to your own branch needs no extra permission; push, PR, Jira still need the user.
- `result` is the short report from `references/templates.md`: size, files, test command and outcome, critic status and open questions. Under 20 lines.

### SYNC

- Review the code of `reviewTargets` (their files and commits, not their `result` text) against `interfaces` and their `responsibility`. Use the `java-code-reviewer` agent on their commits if it exists, otherwise the `java-code-review` checklist in the main context.
- Map the findings: a confirmed bug or a broken agreed interface → `ERROR` (NEEDS_FIX); a risk or a critic-style question → `WARNING`; style → `INFO` or nothing. NEEDS_FIX only with an `ERROR`; name the agent in `relatedAgent`.
- Findings are hypotheses: check each against the code before you submit it. Do not fix their code yourself.

### INTEGRATE (lead)

Bring everyone's work together (merge their branches when they use worktrees), run `task.verifyCommand` (through `test-runner` if it exists). The evidence rule applies unchanged: `PASS` only after a run after the last merge with its output read. A failure: `NEEDS_FIX` with an `ERROR` finding naming the agent whose part breaks. `result` is the final report.

## Swarm on top of an OpenSpec change

Three layers: OpenSpec owns **what** (requirements, scenarios, design, tasks), the swarm owns **when and who**, this orchestrator owns **how**. `references/openspec.md` stays valid except for the points below.

**Before the swarm.** The change is created and reviewed by a human first: `/opsx:propose` → `/java-spec-review <name>` → `create_task` whose `description` names the change path `openspec/changes/<name>/`. A swarm on a change nobody reviewed is the same as a swarm on vague scope: do not propose, ask the user. Worth it for L; S and M are cheaper with one agent and `/opsx:apply`.

**DISCUSS splits, it does not redesign.**
- `decisions`: a link to `design.md` plus only what the split adds.
- `interfaces`: the contracts from `design.md` and the specs the agents share, copied exactly.
- `assignments[].responsibility`: task numbers from `tasks.md` ("groups 2 and 4, tasks 6.1–6.3").
- `assignments[].files`: the code and tests of those tasks. **`openspec/changes/<name>/**` belongs to the lead.**
- Groups in `tasks.md` follow the build order (schema → entity → service → API). Handing them out as they are serializes the agents. Split by vertical slices whose contract is fixed in `design.md`. If that is impossible, say so in DISCUSS: the swarm will not be faster than one agent.
- The design must change → only the lead runs `/opsx:update`, before `propose`; the others send their reasons with `send_message`.

**IMPLEMENT.**
- Do **not** run the `/opsx:apply` loop or the `openspec-apply-change` skill: it picks the next unticked task, which may be another agent's. Do exactly the task numbers of your assignment, each through `java-tdd` (scenario = behavior = test, as in `openspec.md`).
- Do not edit anything in `openspec/changes/<name>/`: no checkboxes, no summaries, no findings. Put the done task numbers, the scenario → test mapping and divergences from `design.md` in `complete({result})`.
- The implementation diverges from the design or a spec: stop, `send_message` to the lead. Never widen the scope silently.

**The "Verification" group of `tasks.md`** is spread over the phases:

| Task in the group | Who and when |
|---|---|
| `critic`, `review-migration`, `incident-thinker`, `java-extensibility-review` | the owner of the matching slice, IMPLEMENT, before `complete` |
| `java-code-reviewer` | replaced by the SYNC review; the reviewer also gets the change path |
| full run, `/opsx:verify` (if available) | the lead, INTEGRATE |

**INTEGRATE (lead).** After the merge and a green `verifyCommand`, the lead ticks `[x]` in `tasks.md` from the agents' `result` texts and its own check, runs `/opsx:verify` if the profile has it, and commits that as part of the merge. `/opsx:archive` only after DONE and with the user's permission.

## Changed rules in swarm mode

- **Checklist item 5** (reviewer and critic in parallel) becomes: critic on your own diff in IMPLEMENT + a peer review in SYNC.
- **Checklist item 6** (report) becomes: `complete({result})`. In your own chat write one line per phase transition, nothing more.
- **When to stop and ask:** questions about the agreement, interfaces or another agent's part go to that agent via `send_message`. Only the lead asks the user, and only for vague scope, no Docker, or an irreversible action outside the protocol (push, PR, Jira, deleting data). Every other "ask the user" becomes "decide, record it in `result`".
- **Never wait for a user answer while the swarm waits for you.** If you must ask the user, tell the other agents first (`send_message`) that you are blocked. In a headless session (started by a runner) the user is the operator: `send_message({to: "operator", message})`, then `wait()` for the answer.
- `grilling` and multi-round user interviews are not used inside the swarm.

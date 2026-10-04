---
name: java-spec-review
description: "Review of an OpenSpec change before code: spec.md, proposal, design, tasks, the other deltas and the main specs the change modifies. A script checks form and \"scenario ↔ task\" traceability, domain skills ask questions about the artifacts, facts are checked against the code, decisions go to the user in grilling rounds, then the artifacts are edited with consent. Use when the user points at an OpenSpec spec.md, change folder or change name before /opsx:apply — «проверь спеку», «разбери change», «погоняй меня вопросами по спеке», «готов ли change к apply», «ревью артефактов после propose», review this openspec change, /java-spec-review <path>; also in java-dev-flow after /opsx:propose. Not for code review (java-code-review), checking finished code against the spec (java-code-reviewer, /opsx:verify) or creating a change (/opsx:propose)."
compatibility: Claude Code. python3 for scripts/collect_change.py. The openspec CLI is optional (openspec validate --strict). Relies on grilling, think-before-coding, backend-design-java (or backend-design) domain skills, java-extensibility-review, testing-with-discernment; if one is missing — questions from references/questions.md.
---

# Java Spec Review — reviewing an OpenSpec change before code

Before `/opsx:apply` find in the change what will break the implementation or production: scenarios no test can be written from; errors and retries without scenarios; contradictions between the artifacts and the code; decisions made silently or hidden in Open Questions. The output is artifact edits agreed with the user and an answer on whether apply can start.

You do not write code. You edit artifacts only after the user agrees.

**You find facts yourself; you ask the user for decisions.** Ask every question of the artifacts and the code first. Only what neither the artifacts nor the repository answer goes to the user: business rules, production facts, a choice between reasonable options.

Talk to the user in their language.

## 1. Find the change and collect the artifacts

```bash
python3 <skill-path>/scripts/collect_change.py <path or name>
```

| Input | What is reviewed |
|---|---|
| `openspec/changes/<name>/specs/<cap>/spec.md` | the whole change, this delta is the focus |
| any other file or directory inside a change | the whole change |
| `openspec/specs/<cap>/spec.md` (a main spec) | the active change that modifies this capability. Several — the script returns code 2 and a list; ask which one. None — "main spec" mode (section below) |
| a change name | `openspec/changes/<name>`, then the archive |
| nothing or the project root | the only active change; several — code 2 and a list |

The script prints an inventory of requirements, scenarios and tasks, the "scenario ↔ task" traceability and form findings. How to treat them:
- `error` is almost always true: `openspec validate` or `archive` will fail on it;
- `warn` and `hint` are a reason to look, not a verdict;
- the traceability matches tasks to scenarios by name only. A task may refer to a scenario in its own words, so read the tasks before reporting "scenario without a task".

If the session has the `openspec` CLI, also run `openspec validate <name> --strict`. Its errors weigh more than the script's.

Then read **in full**:
- `proposal.md`, `design.md`, `tasks.md`;
- every delta in `specs/`;
- the main spec of every capability with MODIFIED, REMOVED or RENAMED;
- the project's `openspec/config.yaml`: its `context` and `rules` are requirements for the artifacts too;
- the project's `CLAUDE.md`.

Read it as someone else's text: check what is written, not what was meant.

**By default steps 1–3 are done by a subagent** (`general-purpose`) with the prompt from [references/handoff.md](references/handoff.md): it runs the script, reads the artifacts, loads skills as question banks, checks facts against the code and returns findings and draft questions. The main context gets the conclusion, not the artifacts and skill texts — that saves 8–10 thousand tokens. It matters even more if you wrote the change in this same session: the subagent does not know what is "obvious". Do steps 1–3 yourself only if there are no subagents or the user asked. Steps 4–6 (report, question rounds, edits) — always in the main context.

## 2. Load skills by signals

Take the signals from the "Route" line in Impact (it already names the skills) and from the artifact text. Call skills via the Skill tool. A name may carry a plugin prefix: `backend-design-java:migration-safety`, `backend-design:migration-safety`. Take the variant from the available list; if both exist — the `backend-design-java` fork. Usually 2–5 skills are enough.

| Signal in the artifacts | Skill | What to ask the artifacts |
|---|---|---|
| size M or L | `think-before-coding` | the six steps are the frame for checking `design.md`: does each have an answer in Decisions? |
| a new table or column, changeset, entity, a status in the DB | `data-modeling-discipline`, `migration-safety` | invariants → constraints; Migration Plan; what happens to rows already in the table |
| transaction boundary, locks, `@Version` | `jpa-and-transactions` | where the transaction is, no external calls inside |
| a write + an event or HTTP call, consumer, webhook, payment, retry, `@Scheduled` | `idempotency-and-side-effects` | a retry scenario, the key, outbox, the state after a failure between steps |
| endpoint, error codes, validation, an external system client | `error-handling-as-design` | every error has a status and a `code` in a scenario; timeouts; a neighbor failing |
| roles, permissions, someone else's resource, tenant, admin | `auth-and-authorization`, `security-discipline` | 401/403/404 scenarios; where the owner or tenant comes from |
| lists, filters, search, reports, exports | `query-discipline` | limit, pagination, sorting, index |
| load, SLA, volumes, batch | `performance-and-scaling` | numbers in Context; what runs out first |
| a new component: endpoint, consumer, job, client | `observability-by-default` | logs, metrics and health in Decisions and in tasks |
| a new technology, library, infrastructure | `boring-by-default` | defending the complexity in Decisions |
| a variant for a set the code already branches on: provider, channel, type, payment method, status | `java-extensibility-review` on the **code** of the affected classes | the verdict in the "Extensibility" subsection; a "Preparatory refactoring" group in tasks |
| `tasks.md` names test levels | `testing-with-discernment` | the level and tool for every scenario |

Skills work here as **question banks**. Turn their Red Flags, Anti-Patterns, Quick Decision Guide and checklists into questions to the artifacts. Skip instructions to write code and tests: there is no code at this step. The "before code" requirement of `think-before-coding` holds — the spec is "before code".

A skill is missing in the session — take the matching section of [references/questions.md](references/questions.md) and mention it in the report.

## 3. Ask the artifacts questions

Go through the bank [references/questions.md](references/questions.md): A — proposal, B — specs, C — design, D — tasks, E — cross-checking, F — facts from the code, G — pre-mortem. Add the questions from the loaded skills to the matching sections. In the focus delta (if the input is a specific spec.md) go through every requirement and scenario; the other artifacts — by their links to it and by the cross-check.

For every question:

1. Find the answer in the artifacts, with file and line.
2. If the answer is a claim about the system ("the table already exists", "cancel for PAID currently returns 409", "there are three callers"), check it against the code with Grep and Read. Facts from the code, configuration, git and existing specs are your job.
3. Sort the result:
   - the answer exists and is confirmed — a line under "Checked";
   - the answer contradicts the code, another artifact or a project rule — a finding;
   - no answer, but it can be derived from the code and the project's conventions — a finding with a ready edit text;
   - no answer, and it depends on a business decision or production facts not in the repository — a question to the user.

**Blocker** — apply cannot start with this:
- the artifacts contradict each other or the code;
- `validate` or `archive` will fail;
- a decision that changes specs, the approach or tasks has not been made, including one hidden in Open Questions;
- a key behavior has no scenario that can be turned into a test;
- the chosen approach loses or corrupts data or money or opens access to someone else's data.

**Gap** — something to add or fix: a missing error, retry or edge scenario; a task without verification; a Migration Plan without rollback; a vague THEN.

**Remark** — does not block apply, one line. At most five.

At most 15 blockers and gaps, ordered by "how much it breaks the implementation or production". Do not touch the wording style unless it prevents writing a test.

## 4. Report and the first round of questions

```
Status: READY | GAPS | BLOCKERS — change <name>: <N> requirements, <M> scenarios, <K> tasks
Route: <line from Impact or "none"> · validate: <ok | N errors | no CLI>
Skills: <loaded>; missing in session: <…>
```

- `READY` — no blockers, gaps or open decisions; `/opsx:apply` can start;
- `GAPS` — there are gaps or open questions, no blockers;
- `BLOCKERS` — at least one blocker.

Then the sections; skip empty ones.

**Blockers** and **Gaps** — for every finding:

```
### <short title> — `file:line`
- What: <what is wrong or missing>
- Risk: <what goes wrong in the implementation or in production>
- Edit: <a ready text of the scenario, decision or task — or "depends on Qn">
```

**Remarks** — one line each.

**Checked against the code** — `artifact claim — what confirmed it (file:line)`, up to 10 lines.

**Questions — round 1.** The rounds are run by the `grilling` skill (the user calls it as `/grill-me`): call it via the Skill tool and pass the questions. If it is missing, keep the format yourself:

```
❓ **Q1 — <topic>** (`file:line`): <question; options; what changes in specs, design or tasks for each answer>

➡️ <recommended answer and why>
```

A round includes every question whose premises are already settled. A question whose answer depends on another open question waits for the next round.

## 5. Rounds

After every answer:
- record the decision and which artifacts it changes;
- find the questions this answer opened. Example: an idempotency key was chosen — a "same key, different body" scenario is needed;
- a fact is needed — find it yourself in the code and artifacts, do not ask the user;
- ask the next round.

The rounds end when no open decisions remain and the user has confirmed the shared understanding. If the user says "enough" or "carry on yourself", close the remaining questions with the recommended answers and mark them explicitly as assumptions in the edit plan.

## 6. Editing the artifacts

Show the edit plan per file: what is added or changed. These are ready texts of requirements and scenarios in OpenSpec format, Decisions entries with the rejected alternative, task lines in the `tasks.md` format. Apply only after the user's "yes".

- OpenSpec format: `#### Scenario:` with exactly four `#`, SHALL or MUST in the requirement, MODIFIED — the whole requirement block from the main spec, not a piece.
- A new scenario → a task in the right group of `tasks.md`: "X.Y Scenario "…" — <test level> — verify: <test>".
- A decision from an answer → Decisions in `design.md`. Open Questions hold only what can be decided later without changing specs, the approach and tasks.
- Do not edit the main specs in `openspec/specs/` — they change through archive. A main spec's behavior changes with a new change.
- Do not touch tasks ticked `[x]`. If the change is already in apply and an edit touches done work, say so and suggest `/opsx:update`.

After the edits run the script again (and `openspec validate --strict` if the CLI exists) and give the summary:

```
Status after edits: READY | GAPS | BLOCKERS
Changed: <file — what> …
User decisions: Q1 — …; Q2 — …
Assumptions (recommended answer without confirmation): …
Left: …
Next: /opsx:apply <name> | another round | …
```

## "Main spec" mode

The input is a main spec and no active change touches it. Review the spec with sections B and F of the bank: can a test be written from every scenario, are all errors, retries and edges described, does the spec match the code. A divergence between spec and code is a finding in one of two directions, and the user picks the direction: a bug in the code (route B in `java-dev-flow`) or a wrong spec (a new change). Behavior edits — only through a new change (`/opsx:propose`), not by editing the spec directly.

## Constraints

- Do not write code and tests, do not run `/opsx:apply` and `/opsx:archive`.
- Edit artifacts only after the user agrees. Do not touch main specs and checkboxes.
- Do not change git state: `status`, `diff`, `log`, `show` are allowed; `commit`, `checkout`, `stash`, `reset` are not.
- Publish nothing: Jira, PRs, comments.
- No generalities. "Add error handling" is not a finding. A finding is a concrete scenario, decision or task, with a place in a file.

## Place in the process

- `/opsx:explore` and `grilling` in phase 1 of `java-dev-flow` decide **what to build** before the change is written. This skill checks **what is written**, after `/opsx:propose`. Questions here are only about what the artifacts contain or lack.
- In `java-dev-flow`, after `/opsx:propose` for M and L a pause for human artifact review is needed. This skill is the tool for that pause.
- After implementation, the code's conformance to the spec is checked by the `java-code-reviewer` and `critic` agents and `/opsx:verify`, not by this skill.

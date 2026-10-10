---
name: java-dev-flow
description: "Development orchestrator for Java / Spring Boot — invoke it FIRST for any coding task, before think-before-coding, java-tdd and domain skills: implement, add an endpoint / field / table, change a business rule, limit or threshold, fix a bug, refactor, integrate with, «реализуй», «сделай фичу», «добавь эндпоинт», «доработай», «почини баг», «поправь», «бизнес просит», «поменяй порог / лимит», «отрефактори», /java-dev-flow. Sizes the task (S/M/L) and drives it through phases: design → plan → TDD → verification by the java-code-reviewer and critic agents → report, pulling in backend-design-java skills by signals. In an OpenSpec project it works inside /opsx; in an agent-network swarm it works inside the swarm phases. Not for diff review (java-code-review), test cleanup (test-audit), Jira, production incidents (debugging-discipline) or questions without code."
compatibility: Claude Code. Relies on backend-design-java, java-tdd, java-diagnosing-bugs, java-code-review, java-extensibility-review, java-spec-review, test-audit, jira-tasks, grilling and the java-code-reviewer, critic and test-runner agents (assets/agents); without them it falls back to references/fallback-checklists.md. Maven/Gradle, Docker for Testcontainers, git.
---

# Java Dev Flow — development orchestrator

The orchestrator decides three things: **what the task is, whom to call and in what order, and when a phase is done.** How to do a step lives in the specialist skill: the orchestrator calls it and does not retell it. If a specialist skill says "call me first", the orchestrator still sets the order; the specialist skill sets the content of the step.

Talk to the user in their language. Announce phase transitions in one line.

## Checklist before saying "done"

1. The classification line (phase 0) came before the first line of code.
2. M and L: a design summary exists. L with a plan file: the plan passed the goldfish check (`READY`), or the user explicitly skipped it or accepted its open questions; design and plan were approved by the user before code.
3. Every behavior is covered by a test you saw fail for the right reason (`java-tdd`).
4. The full test suite ran in this session after the last edit. Failed and not-run tests are named in the report; no Docker — the report says so.
5. M and L: the `java-code-reviewer` and `critic` agents ran on the diff in one message, in parallel. Their findings were checked against the code: fixed test-first or listed in the report.
6. The report follows `references/templates.md`: size, changed files, checks and their results, whether `critic` ran.

An item is not met — go back to it instead of writing "done".

## Skill names

Base names are used below. In a session they may carry a prefix: `backend-design-java:migration-safety`, `anthropic-skills:test-audit`. Call the variant from the available list; if both the `backend-design-java` fork and the original `backend-design` are present, take the fork. A skill is missing — do the step with the checklist in [references/fallback-checklists.md](references/fallback-checklists.md) and mention it in the report. Whom to call when unclear and how overlaps are resolved — [references/skill-map.md](references/skill-map.md).

## OpenSpec project

There is an `openspec/` directory or an `/opsx:*` command — follow [references/openspec.md](references/openspec.md): M and L go through a change, after `/opsx:propose` there is a pause for human review (`java-spec-review <name>`), inside `/opsx:apply` every task goes through `java-tdd`, and the "Verification" group runs `java-code-reviewer` and `critic`.

## Agent-network swarm

The `agent-network` MCP tools are present and `swarm_context` shows your active task — follow [references/swarm.md](references/swarm.md): the swarm decides when and who (phases, assignments, file ownership), this orchestrator decides how. Phases 0–3 go into the agreement in DISCUSS, phase 4 and the critic run on your own assignment in IMPLEMENT, the SYNC peer review replaces `java-code-reviewer`, the report goes into `complete({result})`, questions go to other agents, not the user. On top of an OpenSpec change the lead alone owns the change directory and nobody runs the `/opsx:apply` loop.

## If the task is not development

No orchestrator — call the specialist skill directly: diff or PR review — `java-code-review` (not the built-in `/code-review`); "which pattern fits" — `java-extensibility-review`; test cleanup — `test-audit`; Jira — `jira-tasks`; design only — `think-before-coding`; interview about an idea — `grilling`; OpenSpec change before code — `java-spec-review`; bug cause without a fix — `java-diagnosing-bugs`; a query, N+1, component audit — commands `explain-this-query`, `hunt-n-plus-one`, `audit`; production is on fire — agent `incident-investigator`.

## Phase 0. Classification — always

Before any code, determine type, size and signals and **write one line in exactly this format:**

```
Route: <feature | change | bugfix | refactoring | schema | performance> · <S | M | L> · signals: <evidence> → <skills>
```

A quick look at the affected classes is enough; do not read the whole project.

| Type | Route |
|---|---|
| New feature, new component (endpoint, consumer, job, client) | A |
| Change of existing behavior | A; no tests on the affected code — first `java-tdd`, mode D |
| DB schema change | A, schema signals are mandatory |
| Bug reproducible locally, in tests or from a clear description | B |
| Symptom in production or staging: slow, 500s, pool, OOM, Kafka lag, Liquibase lock | `debugging-discipline` → once the cause is found, B |
| Refactoring without behavior change | C |
| "It's slow", performance needed | P |
| New technology, dependency, infrastructure | `boring-by-default` before design; contested — agent `boring-tech-advisor` |

| Size | Evidence | Depth |
|---|---|---|
| **S** | an edit inside an existing component, 1–3 production files, 1–3 behaviors. **Unchanged:** DB schema, public API or event contract (parameters, pagination, response format, error codes), authorization, transaction boundaries, external calls | skip phases 1–3, go to phase 4; short verification |
| **M** | a new component or any of the "unchanged" items above; one module; up to ~10 behaviors | all phases; design — 10–20 lines in chat; plan — behaviors in the todo list |
| **L** | several modules or services; schema + API + integration together; backfill; vague requirements; more than ~10 behaviors or a day of work | clarification via `grilling`; design and plan in a file; goldfish check of the plan; **wait for approval before code**; propose splitting into PRs |

A public contract change is no longer S, even in one file. Size is revisited as you go: an S task touched the schema, a contract or an external call — announce "upgrading to M" and do the skipped phases. More than 4–5 signals is almost always L.

### Signals → skills

A skill is loaded in the phase and slice where its signal shows up.

| Signal | Skill | Phase |
|---|---|---|
| new or changed table, column, index; new `@Entity` | `data-modeling-discipline` | 2 |
| changeset, changelog, any schema change | `migration-safety` | 4, schema slice |
| `@Entity`, repository, `@Transactional`, lazy associations, locks | `jpa-and-transactions` | 4 |
| `@Query`, derived query, list, pagination, report | `query-discipline` | 4 |
| DB write + message or HTTP call, `@KafkaListener`, webhook, payment, retries, `@Scheduled` | `idempotency-and-side-effects` | 2 |
| new endpoint, exception handling, error codes, validation | `error-handling-as-design` | 2 |
| roles, permissions, tenant, Spring Security, access to a resource by id | `auth-and-authorization` | 2 |
| a new component of any kind | `observability-by-default` | 2, 4 |
| load, pools, cache, async, virtual threads | `performance-and-scaling` | 2 |
| controller, security config, `application*.yml`, secrets, deserialization | `security-discipline` | 4 |
| the task adds a variant to a set the code already branches on (payment method, provider, channel, status) | `java-extensibility-review` | 2 |
| the diff added or grew branching on type, status or string: 3+ variants or the same `switch` in a second place | `java-extensibility-review` | 5 |

## Route A — feature or behavior change

| Phase | When | Whom to call | Exit |
|---|---|---|---|
| 1. Clarification | L; M — only if the design depends on the answer | L: `grilling`; M: up to three questions, each with a recommended answer | questions closed or assumptions recorded |
| 2. Design | M, L | `think-before-coding` + domain skills by signals; a variant for a set the code branches on → `java-extensibility-review` | design summary per `references/templates.md`; L — user approval |
| 3. Plan | M, L | L: goldfish check — two fresh agents (`references/subagent-handoff.md`) | M: test boundaries and behaviors in the todo list; L: plan file, goldfish check, approval; OpenSpec: `tasks.md` |
| 4. Implementation | always | `java-tdd` for every behavior | every behavior has a test you saw fail |
| 5. Verification | always | by size, see below | full run; reviewer and critic findings resolved |
| 6. Report | always | template `references/templates.md` | report to the user |

Phases 1–3 in detail, including moving an L task to a new session — [references/design-and-plan.md](references/design-and-plan.md).

### Phase 4. Implementation

For every slice:

1. Load the domain skills whose signals belong to this slice.
2. Every behavior is one `java-tdd` cycle: RED, checking the test failed for the right reason → GREEN → REFACTOR.
3. Test skills only where needed, not all at once: for S `java-tdd` is enough; `testing-with-discernment` — at the first integration test or when the level is unclear; `test-audit` — in phase 5, as the "check tests" flag for `java-code-reviewer`.
4. **Handle hook warnings** from `backend-design-java` and `tdd-guard`: they arrive as additional context after Write/Edit. Fix them in the same cycle or record a justification for the report. Never skip them silently.
5. A slice is done when all its behaviors went red → green and the module tests are green.

Do not ask "continue?" between slices. L slices may go to subagents ([references/subagent-handoff.md](references/subagent-handoff.md)); you check their diff and tests yourself. An L task does not fit in one session — suggest `/handoff` to the user.

### Phase 5. Verification

| Size | Mandatory |
|---|---|
| S | full project test run; reread your diff |
| M | the same + the `java-code-reviewer` and `critic` agents on the diff, **in one message, in parallel** + checks by signals |
| L | as M + agents by signals (`security-reviewer`, `schema-reviewer`, `incident-thinker`) |

- Give both agents the diff scope, 2–5 lines on what was done, the spec (behaviors, plan or OpenSpec change; none — "no spec"). Give the critic also the classification line and what is known about production. Prompts — `references/subagent-handoff.md`.
- Agent findings are hypotheses: check them against the code. A bug at confidence 80+ and a confirmed critic blocker go through route B, test first. The critic's questions go to the report.
- No agent: `java-code-review` in the main context ("self-review"); the critic's questions from `references/fallback-checklists.md`.
- The full run in M and L goes to the `test-runner` agent if it exists: a summary comes back instead of logs.
- Checks by signals and resolving findings — [references/verify.md](references/verify.md).

**Evidence rule.** "Done", "tests are green", "bug fixed" are written only after a command run in this session after the last edit, with its output read. "Should work" is not a status. If at least one test failed or some tests did not run, the report names them instead of "all green". To show a failure existed before your change, do not touch git state (`stash`, `checkout`, `reset`): name the failing tests and say whether they touch the changed code; if proof is needed, run the base in a separate `git worktree`. A subagent's report is not evidence until you have looked at the diff and rerun the tests.

The `critic-gate` and `evidence-guard` Stop hooks remind you about a skipped critic and about a failed run the report keeps quiet about.

### Phase 6. Report and handover

Report per the template in `references/templates.md`. Commit, push, PR — only with the user's permission; propose one commit per slice (test and implementation together). Follow-ups — as a list in the report; Jira tickets via `jira-tasks` — only on request.

## Routes B, C, P

Details — [references/routes.md](references/routes.md).

- **B, bugfix:** `java-diagnosing-bugs` → `java-tdd`, mode B (the test fails with a message about this bug, then the fix) → phase 5. Production — `debugging-discipline` first.
- **C, refactoring:** extensibility — `java-extensibility-review` first; `java-tdd`, mode C (no coverage — D); steps with a green run after each; phase 5.
- **P, performance:** `performance-and-scaling`: measure → fix → same measurement → phase 5.

## When to stop and ask

Only in these cases:

- the requirements allow different designs and the answer does not follow from the code;
- L: approval of design and plan before code;
- a characterization test pins behavior that looks like a bug;
- the third failed bug fix or 2–3 refuted hypotheses;
- no Docker, integration tests do not run (H2 or `@EmbeddedKafka` instead of containers is not allowed);
- a test needs a DB and the project does not start one in tests — ask about Testcontainers;
- an irreversible or external action: commit, push, PR, Jira, deleting data, shared configuration.

Decide everything else yourself and record the decision with its reason in the report.

**The goldfish check of an L plan is not a stop.** It asks the user nothing, so "do it all", "implement right away" or an autonomous mode do not skip it: they waive the pauses for the user, such as L approval. Skip the check only when the user says so about this check ("skip the goldfish check", "без goldfish-проверки"), and write "Goldfish check: skipped by the user" in the report.

## Priorities in a conflict

1. Explicit user instructions and the project's `CLAUDE.md` / `AGENTS.md`.
2. This orchestrator: phase order, depth, whom to call.
3. The specialist skill: how to do the step.

Resolved skill overlaps — `references/skill-map.md`, section 2.

## Red flags

Stop and go back to the right phase if you notice that:

- any item of the checklist at the top is violated;
- you loaded all domain or all test skills "just in case";
- you are changing code for a bug while there is no command that fails on exactly this bug;
- in M or L a test is written at a boundary that is not in the plan;
- a hook warning was skipped and the report says nothing about it;
- you are fixing a review finding without a test;
- in M you ask "continue?" between slices;
- in M or L you review your own diff although the `java-code-reviewer` agent is available.

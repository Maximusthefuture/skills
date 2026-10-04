# OpenSpec mode

**Open when:** the repository has OpenSpec — an `openspec/` directory at the root or `openspec list --json` returns a non-`null` `root` — or the user ran an `/opsx:*` command.

Checked on OpenSpec 1.14 (OPSX workflow, `spec-driven` schema). In the old workflow (`/openspec:proposal`, `/openspec:apply`) the logic is the same, only the command names differ.

## Who owns what

OpenSpec and the orchestrator do not compete: OpenSpec stores the agreements, the orchestrator sets the engineering discipline.

| What | Owner |
|---|---|
| Choosing a change, artifact files, statuses, checkboxes in `tasks.md`, sync and archive | OpenSpec (its `openspec-*` skills and the `openspec` CLI) |
| WHAT the system must do: requirements and scenarios | OpenSpec, `specs/**/spec.md` |
| Classification: type, size, signals | orchestrator → written into `proposal.md`, Impact section |
| HOW to do it: design | file — `design.md`; content — `think-before-coding` + domain skills by signals |
| Plan | file — `tasks.md`; structure — slices, behaviors, test levels, the "Verification" group |
| Implementing each task | the `/opsx:apply` loop (picking a task, the checkbox) + `java-tdd` (the red → green → refactor cycle itself) |
| Verification | the "Verification" group in `tasks.md` (tests, review, agents) + `/opsx:verify` if the extended profile is on |
| Final report | the orchestrator's template, before `/opsx:archive` |

If an OpenSpec instruction and an orchestrator rule disagree about files, paths, statuses or checkboxes, OpenSpec is right. If they disagree about how to write code and tests and verify the result, the orchestrator is right.

## Is a change needed

| Situation | What to do |
|---|---|
| S: an edit without changes to schema, contract, authorization, transactions, external effects | no change — the orchestrator's usual route |
| A bug that restores behavior already described in `openspec/specs/` | no change — route B. The spec already says how it should be |
| A bug that revealed the spec is wrong or does not describe the behavior | a change: the requirement under `## MODIFIED` or `## ADDED`, then route B inside `/opsx:apply` |
| Refactoring without behavior change | no change. If the team wants a trace in history — a change with `skip_specs: true` in `.openspec.yaml` |
| M | `/opsx:propose <name>` |
| L | first `/opsx:explore` (that is phase 1, clarification), then `/opsx:propose <name>` |
| A production incident | no change — `debugging-discipline`. If behavior must change afterwards — a separate change |

If the user ran `/opsx:propose` for an S task, their choice wins. Make a short change: `design.md` is not needed if there are no signals.

The user asks for an M or L task without `/opsx`? Say in the classification line that it is a change and call the `openspec-propose` skill (or suggest the command, if the project runs it by hand).

## Orchestrator phases in OpenSpec

| Phase | Where in OpenSpec | Where the result goes |
|---|---|---|
| 0. Classification | start of `/opsx:propose` | `proposal.md` → Impact, first line: "Route: …" |
| 1. Clarification | `/opsx:explore` (L) or the clarification step in `/opsx:propose` | Why and What Changes in `proposal.md`; answers that change the design — in Decisions of `design.md` |
| 2. Design | the `design` artifact | `design.md`. If the change adds a variant to a set the code already branches on, `java-extensibility-review` is called before `tasks` and its verdict goes into Decisions |
| 3. Plan | the `specs` and `tasks` artifacts | scenarios in `specs/**/spec.md`, slices in `tasks.md` |
| 4. Implementation | `/opsx:apply` | code and tests; ticked checkboxes |
| 5. Verification | the "Verification" group in `tasks.md`; then `/opsx:verify` if available | ticked group checkboxes; the verify report |
| 6. Report | end of `/opsx:apply` or before `/opsx:archive` | a chat message per the `references/templates.md` template; follow-ups |

No plan file in `docs/plans/` in this mode: the plan is the change itself, `openspec/changes/<name>/`.

### Approval after propose

Without OpenSpec only L requires approval before code. In an OpenSpec project the pause after `/opsx:propose` is needed **for M and L**: OpenSpec exists precisely so that a human looks at the agreement before code. The exception — the user said explicitly not to wait ("do it all", "implement right away").

The `java-spec-review` skill is made for this pause. It accepts a `spec.md`, a directory or a change name and collects the proposal, design, tasks, deltas and main specs. A script checks form and "scenario ↔ task" traceability. Domain skills ask questions about the artifacts, facts are checked against the code, the user decides in rounds, and only then are the artifacts edited. Suggest it in one line after `/opsx:propose`: "Review the change with questions before apply? — `/java-spec-review <name>`". The fact gathering runs in a fresh-context subagent by default.

## Scenario = behavior = test

Every `#### Scenario` with WHEN/THEN is one observable behavior, i.e. one `java-tdd` cycle:

- a task in `tasks.md` refers to the scenario;
- the test name or `@DisplayName` recognizably repeats the scenario name;
- the values from THEN are literals in the assertion: status, error code, field, row state in the DB.

A scenario that cannot be turned into a test is a sign it is vague. Suggest clarifying it via `/opsx:update`.

## The `tasks.md` format

OpenSpec parses only lines like `- [ ] X.Y ...` and requires every task to say how to verify it. Groups are slices in build order. Tests are not collected into a separate group at the end.

```markdown
# Tasks

## 1. Schema and repository

- [ ] 1.1 Changeset: column `orders.archived_at` (nullable) and mapping in `Order` — verify: `OrderRepositoryTest` starts on Testcontainers, Liquibase applies the changeset
- [ ] 1.2 Scenario "Filter archived=false hides archived orders" — `@DataJpaTest` + Testcontainers, the test is red first — verify: `OrderRepositoryTest#excludesArchivedOrders`

## 2. API

- [ ] 2.1 Scenario "Parameter archived=true returns only archived orders" — `@WebMvcTest` — verify: `OrderControllerTest#returnsOnlyArchived`
- [ ] 2.2 Scenario "Invalid archived value → 400 with code INVALID_FILTER" — `@WebMvcTest` — verify: `OrderControllerTest#rejectsInvalidArchivedValue`

## 3. Verification

- [ ] 3.1 Full run `./mvnw verify` — 0 failed; whatever did not run is named
- [ ] 3.2 Agents `java-code-reviewer` and `critic` on the diff with the change path, in one message — review findings ≥ 80 and confirmed critic blockers fixed test-first or listed in the report; critic questions — to the user
- [ ] 3.3 `review-migration` on the new changesets — no blocking findings
```

The contents of the "Verification" group depend on size and signals (phase 5 in `SKILL.md`). For M and L it always has two agents: `java-code-reviewer` and `critic`, in one message. Instead of a retelling give both the path to `openspec/changes/<name>/`: proposal, design and specs are a ready description of the intent; give the critic also the size and what is known about production. The L agents (`security-reviewer`, `schema-reviewer`, `incident-thinker`) and `java-extensibility-review` go here too if branching on type or status grew in the diff.

If `design.md` decided to refactor first, the first group is "Preparatory refactoring". Behavior does not change in it: tests green before and after (`java-tdd`, mode C; no tests — characterization tests, mode D). There are usually no scenarios in specs for this group, and that is fine: if behavior does not change, the spec does not change either. The new variant is added in the following groups.

## During `/opsx:apply`

The `openspec-apply-change` skill runs the task loop: shows a task, ticks `[x]` after it is done and rereads progress. Inside every task the orchestrator works:

1. Find the scenarios the task refers to and the signals it touches. Load domain skills by those signals.
2. Implement the task via `java-tdd`: test → run and the right failure → minimal code → refactoring.
3. Handle the `backend-design-java` hook warnings.
4. Tick `[x]` only after you saw the task's test red and then green together with the module tests. OpenSpec itself requires ticking a task only when the described behavior is fully implemented.
5. The implementation diverged from `design.md` or the spec? Stop and suggest `/opsx:update`. Do not deviate silently. Both OpenSpec and the orchestrator have this rule.
6. A review found a bug within the change — fix it via route B in the current group. If it is work outside the change — name it and ask. OpenSpec forbids silently widening the scope.

No pauses between tasks without a reason. You may stop for OpenSpec's reasons (a blocker, an unclear task, a divergence from the design) and for the reasons in "When to stop and ask" in `SKILL.md`.

Slices of an L task can go to subagents (`references/subagent-handoff.md`). Instead of the design summary give the paths to `proposal.md`, `design.md`, `specs/` and the group number in `tasks.md`. **Only the coordinator ticks checkboxes**, after its own check: parallel edits of one `tasks.md` break tracking.

Several agents in an `agent-network` swarm on one change — see "Swarm on top of an OpenSpec change" in `references/swarm.md`: the lead owns the change directory, nobody runs the `/opsx:apply` loop, the "Verification" group is spread over the swarm phases.

## Before `/opsx:archive`

- All tasks are ticked, including the "Verification" group.
- The full test run happened in this session after the last edit.
- If `/opsx:verify` is available (extended profile), its report has no CRITICAL. Verify checks conformance with the artifacts: tasks, scenarios, design. It does not replace tests and review, and the orchestrator's verification does not replace it.
- The report per the `references/templates.md` template was given to the user.

Archiving moves the spec deltas into `openspec/specs/`. After that the described behavior becomes the reference that future bugfixes restore without a new change.

## Setting it up in a project

Ready files are in this skill's `assets/openspec/`:

| File | Where | What it gives |
|---|---|---|
| `config.yaml` | the project's `openspec/config.yaml`; if the file exists — move the sections by hand | `context` for all artifacts; `rules` for proposal, specs, design, tasks; `operations.apply/archive.guidance` that make `/opsx:apply` work through the orchestrator and `java-tdd` |
| `CLAUDE.md.fragment.md` | append to the project's `CLAUDE.md` | routing: when a change, when not, which command at which step |
| `../agents/java-code-reviewer.md`, `../agents/critic.md`, `../agents/test-runner.md` | `~/.claude/agents/` or the project's `.claude/agents/` | the "Verification" group agents: independent review, pre-mortem, test run with a summary |
| `schemas/java-flow/` | the project's `openspec/schemas/java-flow/` and `schema: java-flow` in `config.yaml` | optional. `design.md` and `tasks.md` templates for the orchestrator and a mandatory `apply` instruction instead of the advisory `guidance` |

Copy files into the project only at the user's request: it changes their repository.

`operations.*.guidance` in OpenSpec is a recommendation: the apply skill follows it if it is compatible with the built-in workflow. If you notice the project ignores the guidance, switch to the `java-flow` schema. It has the same rules as part of the schema's own instruction.

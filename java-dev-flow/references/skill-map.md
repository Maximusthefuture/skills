# Map of skills, agents, commands and hooks

**Open when:** it is unclear whom to call, or two skills pull in different directions.

Sections:
1. [Inventory](#1-inventory)
2. [Overlaps and how they are resolved](#2-overlaps-and-how-they-are-resolved)

Short checklists for when a skill is missing in the session — [fallback-checklists.md](fallback-checklists.md).

---

## 1. Inventory

Base names. A session may add a plugin prefix (`backend-design-java:`, `backend-design:`, `anthropic-skills:`).

### Process skills

| Skill | Responsible for | Where in the orchestrator |
|---|---|---|
| `grilling` | interview in rounds with a recommended answer to each question until no open decisions remain. From `mattpocock-skills/` | phase 1, L |
| `think-before-coding` | 6 design steps: context and load, data, errors, authorization, retries and concurrency, observability; build order | phase 2; slice order in phase 3 |
| `java-tdd` | red → green → refactor, proof that the test fails, modes A (feature), B (bug), C (refactoring), D (code without tests) | phase 4, routes B and C |
| `java-diagnosing-bugs` | cause of a local bug: a command that fails on it, minimization, hypotheses, measurements, cleanup | route B, step 1 |
| `debugging-discipline` | investigating a symptom in production or staging | route B, production |
| `java-code-review` | diff review: correctness, concurrency, Spring/JPA, security, contracts; only findings with confidence ≥ 80 go into the report | phase 5, M and L |
| `java-extensibility-review` | branching on type and status, choosing a pattern, judging whether it pays off. Runs in a separate context (`context: fork`) | phase 2 (the task adds a variant), phase 5 (branching grew in the diff), route C |
| `java-spec-review` | reviewing an OpenSpec change before code: form and traceability by a script, domain skills as questions to the artifacts, facts from the code, decisions in `grilling` rounds, artifact edits after consent. Fact gathering goes to a subagent by default | OpenSpec: pause after `/opsx:propose`, M and L |
| `testing-with-discernment` | test level and Spring tooling, real Postgres, determinism | phase 4 |
| `test-audit` | test value: authoring gate, junk patterns, test-only seams in `src/main` | phases 4–5 |
| `jira-tasks` | Jira tickets with confirmation and a per-sprint limit; slicing a plan into vertical slices with "blocks" links | phase 6, only on request |
| `handoff` | a document for continuing in a new session. Invoked only by the user (`/handoff`). From `mattpocock-skills/` | an L task does not fit in a session — suggest it to the user |

### Domain skills (backend-design-java)

| Skill | Responsible for | Phase |
|---|---|---|
| `data-modeling-discipline` | invariants in the schema, types, nullability, FKs | 2 |
| `migration-safety` | safe Liquibase changesets for PostgreSQL | 4 |
| `jpa-and-transactions` | `@Transactional` proxies, mapping, persistence context, locks, IDs. **Only in the fork** | 4 |
| `query-discipline` | N+1, pagination, indexes, unbounded selects | 4 |
| `idempotency-and-side-effects` | idempotency, outbox, deduplication, retries | 2 |
| `error-handling-as-design` | ProblemDetail, stable codes, validation, rollbacks | 2 |
| `auth-and-authorization` | authentication separate from authorization, the check layer, tenant, RLS | 2 |
| `security-discipline` | IDOR, mass assignment, injections, secrets, Actuator | 4 |
| `observability-by-default` | JSON logs with traceId, Micrometer metrics, health groups | 2, 4 |
| `performance-and-scaling` | "at what load", the bottleneck, pools, vertical scaling | 2, route P |
| `boring-by-default` | defending against complexity before a new technology | before phase 2 |

### Agents

An agent works in a separate context. Reviewers are read-only: you make the edits after checking a finding. All agents except `java-code-reviewer`, `critic` and `test-runner` come from `backend-design-java`. Those three live in this skill's `assets/agents/` and are installed into `~/.claude/agents/` (or the project's `.claude/agents/`).

Models: `java-code-reviewer` and `critic` use `sonnet` (on Haiku they miss cross-file links such as "NOT NULL in the schema + entity without a value" and get PostgreSQL mechanics wrong); `test-runner` uses `haiku`. The orchestrator itself is better run on Sonnet or Opus: on Haiku it skips RED and embellishes the report.

| Agent | When | Tools |
|---|---|---|
| `java-code-reviewer` | phase 5, M and L: independent diff review with the `java-code-review` skill and spec conformance (missing, extra, implemented wrong), on request — tests against `test-audit` | read + Bash (git, compilation), no edits |
| `critic` | phase 5, M and L: pre-mortem — what breaks in production (existing data, deploy and rollback, consumers, retries, partial failures, load, observability); loads domain skills by diff signals itself | read + Bash (git, compilation), no edits |
| `test-runner` | phases 4–5: runs the test command and returns a short summary instead of logs: passed / failed / skipped, failed tests with the first assertion line, what did not run and why | Bash only, no edits |
| `component-architect` | L: a design that needs a wide code overview | read only |
| goldfish check (built-in `general-purpose`, two agents) | phase 3, L: comprehension and readiness of the plan file; gets only the project and plan paths, prompts in `subagent-handoff.md` | read only by the prompt |
| `incident-thinker` | phase 5: consumer, job, integration, money | read only |
| `schema-reviewer` | phase 5: changeset or `@Entity` in L, a big or hot table | read only |
| `security-reviewer` | phase 5: endpoint, security config, roles, tenant | read only |
| `incident-investigator` | an active production incident | read + Bash |
| `boring-tech-advisor` | a contested proposal of a new technology | read only |

### Commands (backend-design-java)

| Command | When |
|---|---|
| `design` | user entry point: "design only". The orchestrator calls `think-before-coding` instead |
| `audit` | production-readiness audit of an existing component |
| `review-migration` | phase 5: new changesets |
| `explain-this-query` | phase 5 and route P: the execution plan of a specific query |
| `hunt-n-plus-one` | route P: N+1 search across a package |

### Hooks (backend-design-java, PostToolUse on Write/Edit/MultiEdit)

They only warn and block nothing. Findings arrive as additional context right after a file is written. When installed without the plugin, the hooks must be registered in `settings.json` by hand (README, option 2) — otherwise the "handle hook warnings" step does nothing.

| Hook | What it catches |
|---|---|
| `check_migration.py` | editing an applied changeset, an index without `CONCURRENTLY`, NOT NULL without a default, an FK without `NOT VALID`, rename/drop, `UPDATE` in a changeset, no rollback and `lock_timeout` |
| `check_backend_component.py` | `@Transactional` on private, HTTP or Kafka inside a transaction, `@RequestBody` without `@Valid`, `findAll()` without a limit, `@Scheduled` without ShedLock, a client without timeouts, traps in entities and config |
| `check_security.py` | concatenation in SQL/JPQL, SpEL, unsafe deserialization, trust-all TLS, weak algorithms, `permitAll`, secrets in code and yml |

The orchestrator requires handling every warning in the current cycle: fix it or justify it in the report.

### This skill's hooks (`assets/hooks/`)

Mechanical gates: what the model forgets from the skill text, code checks. All scripts are `python3`, stdlib only, no network and no model; any internal error is a silent exit with code 0. Put them into the Java project's `.claude/settings.json`, not the user settings: other projects do not need them. A ready block — `assets/hooks/settings.example.json`.

| Hook | Event | What it does |
|---|---|---|
| `critic_gate.py` | Stop | From the changes on disk since the last user prompt (mtime and `git diff`, so edits via Bash, `git apply`, generators and subagents are visible): 4+ production files, ~150+ lines, a migration or security config → blocks the stop and asks to run `critic`. Tests, docs, `.claude/`, generated code, skill and plugin packages, whitespace/comment/import-only edits do not count. Once per prompt |
| `critic-gate.prompt.json` | Stop | Prompt hook: a light model reads the turn's conversation and decides whether it was M or L by meaning (a new endpoint in two files is M too). Costs one Haiku call per turn end |
| `evidence_guard.py` | Stop | The last `mvn` / `gradle` run in the turn failed or did not run (Docker), and the final message is silent about it → blocks the stop and asks to name the failed and not-run tests |
| `tdd_guard.py` | PostToolUse on Write/Edit/MultiEdit | An edit of `src/main/**` in a session where no failing test run followed the last test edit → a "RED was not shown" reminder. Blocks nothing; during a refactoring (mode C) the reminder can be ignored |

`critic_gate.py` and the prompt hook complement each other: the script sees real files and costs no tokens, the model understands meaning. Hooks of one event run in parallel; if both block, Claude gets both reasons.

Thresholds and switches — variables in `env`: `CRITIC_GATE_MIN_FILES`, `CRITIC_GATE_MIN_LINES`, `CRITIC_GATE=off`, `EVIDENCE_GUARD=off`, `TDD_GUARD=off`. Tests: `python3 -m unittest discover -s assets/hooks/tests`.

### OpenSpec (if the project uses it)

`openspec init` creates `.claude/skills/openspec-*` skills and `/opsx:*` commands. The base profile: `propose`, `explore`, `apply`, `update`, `sync`, `archive`. The extended one adds `new`, `continue`, `ff`, `verify`, `bulk-archive`, `onboard`. How they share the work with the orchestrator — [references/openspec.md](openspec.md).

---

## 2. Overlaps and how they are resolved

### 2.1. Who goes "first"

`think-before-coding` demands to be called first. `java-tdd` demands a test before production code. `data-modeling-discipline` wants to be called before the entity, `error-handling-as-design` before the happy path, `idempotency-and-side-effects` before the controller. Several of them fire on "implement a feature".

**Resolution:** the orchestrator goes first. Then phase 2: `think-before-coding` and domain skills by signals. Then phase 4: `java-tdd`. "First" in a specialist skill's description means "before code", and that holds.

### 2.2. Tests at the end of the build order

`think-before-coding` proposes "changeset → entity/repository → service → controller/listener → error mapping → metrics → tests". `java-tdd` demands the test first.

**Resolution:** the build order sets the slice order. Inside every slice the test comes first. At the end only an end-to-end scenario test remains, if needed.

### 2.3. "Too simple to think" vs an S task

The hard gate in `think-before-coding` says: if a task seems too simple, you are wrong.

**Resolution:** S by definition excludes new components and changes to the schema, contract, authorization, transactions and external effects — everything the six steps are about. The skill itself says "match depth to stakes". For S the design is the classification line. As soon as the task stops being S, upgrade its size.

### 2.4. A bug outside production

By its description `debugging-discipline` is for production and staging only. On "bug", `java-diagnosing-bugs` and `java-tdd` (mode B) also fire, and both talk about reproducing with a test.

**Resolution:** each has its own segment.
- `java-diagnosing-bugs` — from the symptom to a confirmed cause: a command that fails on the bug, minimization, hypotheses, measurements, and at the end cleanup of debug logs.
- `java-tdd`, mode B — the regression test and the fix: the minimal reproduction becomes a test, the test fails for the right reason, then the minimal fix.
- `debugging-discipline` — production and staging. Once the bug is reproduced locally, the work moves to `java-diagnosing-bugs`.
- An active incident with affected customers — the `incident-investigator` agent, mitigation first.

If the cause is visible from the stack trace and confirmed in one line, the hypotheses and measurements in `java-diagnosing-bugs` shrink to one sentence. The feedback loop and the regression test remain.

### 2.5. Four tools check security

The `check_security` hook, the `security-discipline` skill ("on every diff"), the security section of `java-code-review`, the `security-reviewer` agent.

**Resolution:**
- the hook runs by itself on every write;
- `security-discipline` is loaded in phase 4 when you touch a controller, security config, yml or deserialization;
- in M and L, security in the diff is covered by `java-code-review` in phase 5 — via the `java-code-reviewer` agent, with a fresh context;
- the `security-reviewer` agent — only on the "endpoint, security config, roles, tenant" signal, for the fresh context.

### 2.6. Design in three ways

The `think-before-coding` skill, the `design` command (the same workflow with questions to the user), the `component-architect` agent (the same workflow in a separate context).

**Resolution:** by default the skill in the main context. The command is the user's entry point when only a design is needed. The agent — for L when the design needs a wide code overview.

### 2.7. Four tools check migrations

`migration-safety` (while writing), the `check_migration` hook, the `review-migration` command, the `schema-reviewer` agent.

**Resolution:** while writing, the skill and the hook work. In phase 5 for M — the `review-migration` command, for L or a big, hot table — the `schema-reviewer` agent.

### 2.8. Three skills about tests

On "write a test", `java-tdd`, `testing-with-discernment` and `test-audit` fire.

**Resolution:** each has its own zone. Order and proof of failure — `java-tdd`. Level and tooling — `testing-with-discernment`. Whether the test is needed and whether it is junk — `test-audit`. There are no substantive contradictions; if one seems to appear, the owner of the question wins. Do not load all three at once: for S `java-tdd` is enough, `testing-with-discernment` comes with the first integration test, `test-audit` — in phase 5 via the reviewer flag.

### 2.9. `java-code-review --fix` fixes without a test

In `--fix` mode the test is added after the fix, and only for blocking findings. The `java-code-reviewer` agent never uses this mode — it only finds.

**Resolution:** in the orchestrator a found bug goes through route B — test first. Improvements without a bug — no test if they do not change behavior.

### 2.10. The same triggers "entity", "repository"

`data-modeling-discipline`, `jpa-and-transactions` and `query-discipline` fire on these words.

**Resolution:** they are split by phase. `data-modeling-discipline` — at design: what to store and which invariants. `jpa-and-transactions` — when implementing mapping and transactions. `query-discipline` — for queries.

### 2.11. Fork and original at the same time

`backend-design` and `backend-design-java` have skills with the same names and compete for triggering.

**Resolution:** keep one plugin installed, the fork. Disable the original synced from claude.ai: `"enabledPlugins": {"backend-design@synced": false}`. If both are in the session, call with the `backend-design-java:` prefix. The original has no `jpa-and-transactions`, and its examples are in Prisma and Python.

### 2.12. Patterns and code review

`java-extensibility-review` and `java-code-review` read the same diff. The first explicitly excludes bugs and security; the second has no patterns in its checklists. An overlap is possible in three places.

**Resolution:**
- **The "Improvements" category in `java-code-review`.** A suggestion like "replace the switch with a strategy" is not executed directly: the question goes to `java-extensibility-review`, which checks the rule of three and the change history.
- **A `switch` on an enum that does not handle new values.** If there is a concrete scenario that already works wrong (an existing value falls into `default`), it is a bug: `java-code-review`, route B. If it is the cost of the next variant (a new value must be added in N places), it is `java-extensibility-review`.
- **Both `--fix`.** A bugfix changes behavior, a refactoring keeps it. In the same code: first the bugfix with a test, then the refactoring under green tests, otherwise characterization tests pin the bug.

At design time (phase 2) there is no overlap: `java-code-review` works only with a finished diff.

### 2.13. OpenSpec and the orchestrator

Both claim the plan and the order of work: OpenSpec has artifacts and commands, the orchestrator has phases and gates.

**Resolution:** OpenSpec owns the files, statuses, checkboxes and archive. The orchestrator owns the design content, the task structure, implementation via `java-tdd` and verification. The review pause after `/opsx:propose` is needed for M too, not only for L. Details — `references/openspec.md`.

### 2.13a. Agent-network swarm and the orchestrator

Both claim the phases: the swarm server moves DISCUSS → IMPLEMENT → SYNC → INTEGRATE, the orchestrator has phases 0–6 and gates. Both run a review after implementation.

**Resolution:** the swarm owns when and who: phases, assignments, file ownership, messages, what is submitted. The orchestrator owns how: design, plan, `java-tdd`, the critic on your own diff, the evidence rule. In SYNC the peer review replaces `java-code-reviewer`. With an OpenSpec change on top, OpenSpec owns what, the lead alone owns `openspec/changes/<name>/`, and the `/opsx:apply` loop is not used. Details — `references/swarm.md`.

### 2.14. Questions to the user: `grilling`, phase 1 and `think-before-coding`

`grilling` asks every question whose premises are settled in one round and does not let go until no open decisions remain. Phase 1 used to limit questions to three at a time. `think-before-coding` and the `design` command also ask questions during the six steps.

**Resolution:** in L, phase 1 goes through `grilling`, and the design starts with the decisions already closed; `think-before-coding` asks only what surfaced in the six steps. In M — up to three questions at a time with a recommended answer. In S there are no questions; assumptions go into the report. Facts from the code, configuration and git the agent finds itself and does not ask the user.

### 2.15. Spec conformance: `java-code-reviewer` and `/opsx:verify`

The `java-code-reviewer` agent checks the diff against the spec: what is missing, what is extra, what is wrong. `/opsx:verify` in the extended OpenSpec profile also compares the code with the change artifacts.

**Resolution:** in an OpenSpec project both work. Verify checks structure: tasks ticked, scenarios and design reflected in the code. The agent reads the code and looks for where the implementation diverges from a scenario in meaning, and finds scope creep. Without OpenSpec only the agent has the spec axis, and it needs the requirements passed in (`subagent-handoff.md`).

### 2.16. Risks after implementation: `java-code-reviewer`, `critic`, `incident-thinker`

All three read the finished diff, and all three may write about retries, transactions or an external system failing.

**Resolution:** each has its own question.
- `java-code-reviewer` — what is broken now: bugs, contracts, spec conformance. Only confirmed things, confidence 80+. Always for M and L.
- `critic` — what happens in production: data already in the tables, deploy and rollback, API and event consumers, retries, partial failures, load. Always for M and L.
- `incident-thinker` — operational depth: detection, recovery and a runbook for consumers, jobs, integrations and money. On the phase 5 signal.

The same finding from two agents is one finding. Critic blockers are checked against the code just like reviewer findings and fixed via route B. Critic questions are the user's decisions; they are not closed by a silent assumption.

### 2.17. Questions about the spec: `grilling`, `/opsx:explore`, `java-spec-review`, `/opsx:verify`

All four ask questions about what we build. `java-spec-review` also loads the same domain skills as `critic`, only against artifacts rather than a diff.

**Resolution:** time separates them.
- `/opsx:explore` and `grilling` in phase 1 — before the change: what to build.
- `java-spec-review` — after `/opsx:propose`, before `/opsx:apply`: what is written in proposal, design, specs and tasks, what is missing and whether it matches the code. Decisions already closed in phase 1 and recorded in the artifacts are not reopened.
- `/opsx:verify` and the phase 5 agents — after the code: does the code match the artifacts.

The pre-mortem in `java-spec-review` (section G of its question bank) does not replace `critic`. The first looks for holes in the agreement, the second in the code written from it.

### 2.18. Plan checks: goldfish check, `java-spec-review`, `critic`

All three look for holes before or after code. They differ in what they read and whom they ask.

**Resolution:**
- goldfish check — an L plan file without OpenSpec, before approval: can a reader who saw none of the discussion retell the plan and implement it in one pass. It knows only the plan and the code, asks the user nothing and loads no domain skills.
- `java-spec-review` — an OpenSpec change before `/opsx:apply`: domain question bank, grilling rounds with the user. Its `READY` replaces the goldfish check in OpenSpec projects.
- `critic` — the code after implementation: what breaks in production.

A plan that passed the goldfish check can still be wrong: it is executable, not necessarily correct. Correctness stays with the design phases and with `critic`.

---

Ideas for the evidence rule, subagent statuses and the sliced plan are partly borrowed from [obra/superpowers](https://github.com/obra/superpowers) (MIT).

The goldfish check follows Dave Rensin's Elephant-Goldfish model; its prompts are adapted from [vshvedov/elephant-goldfish](https://github.com/vshvedov/elephant-goldfish) (MIT).

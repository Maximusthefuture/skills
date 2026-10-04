# Phases 1–3: clarification, design, plan

**Open when:** the task is M or L and you enter phase 1, 2 or 3 of route A.

## Phase 1. Clarification — L; for M only if an answer the design depends on is missing

Ask only what would change the design: expected load, who consumes the API or event, data volume, whether backward compatibility is needed, what to do when an external system is down. Facts that are in the code, configuration and git history you find yourself; ask the user only for decisions.

- **L** — call `grilling`: questions in rounds, each round has every question whose premises are already settled, and a recommended answer for each. The phase is over when no open questions remain and the user has confirmed the shared understanding.
- **M** — no more than three questions at a time, each with your recommended answer.

No answer to a question — record your guess as an assumption in the design.

**Exit:** questions closed or assumptions recorded.

## Phase 2. Design → `think-before-coding`

The skill's six steps; depth depends on size. Load domain skills by signals.

For a code overview in M and L (which classes the task touches, where the transaction boundaries are, who calls what), hand the question to the built-in `Explore` agent: the conclusion comes back to the main context, not the file contents.

**Extensibility.** The six steps of `think-before-coding` do not answer how the code survives the next variant. If the task adds a variant to a set the code already branches on, call `java-extensibility-review` on the affected classes before the plan (it runs in a separate context and returns a verdict). The verdict goes into the design summary:
- "leave as is" — the rule of three is not met, the variant goes into the existing structure;
- "recommend" — in phase 3 the first slice is a preparatory refactoring, and the new variant goes into the ready structure.

**Exit:** a design summary per the template in [templates.md](templates.md). For M — in chat, for L — in the plan file. **L: show the design to the user and wait for approval.** If an L design needs a wide code overview and the main context is too precious, hand the design to the `component-architect` agent and check its blueprint yourself.

## Phase 3. Behavior plan

Split the work into **slices** in the build order from `think-before-coding`: changeset → entity and repository → service with a transaction boundary → controller or listener → error mapping → metrics. Inside a slice list the observable behaviors: each becomes one `java-tdd` cycle. For each behavior name the test level. If the plan has integration tests, determine the infrastructure once per task from the build (`testing-with-discernment`: Testcontainers present — use them, absent — Kafka on `@EmbeddedKafka`) and write it into the plan.

**Test boundaries.** For each slice name the boundaries through which tests observe behavior: endpoint, public service method, `@KafkaListener`, repository method. Prefer existing boundaries; a new one only if the behavior is otherwise unobservable. Tests are written only at these boundaries, at the cheapest level where the behavior is visible (`java-tdd`). For L the boundaries are approved with the plan; for M they are visible in the todo list and need no separate stop. A new boundary in phase 4 is a plan change: in L ask the user, in M record it in the report.

If the design decided to refactor first, the first slice is a **preparatory refactoring**. Behavior does not change in it: `java-tdd` mode C, or mode D if there are no tests. The new variant appears only in the following slices.

**The build order is the slice order, not "tests at the end".** `think-before-coding` ends its list with "tests", but here the test comes first inside every slice. At the end only an end-to-end integration test of the scenario remains, if needed.

**Exit:** for M — test boundaries and the behavior list in the session todo list. For L — a plan file per the template in `templates.md`: `docs/plans/YYYY-MM-DD-<slug>.md` unless the project has its own place for such documents. In an OpenSpec project the plan for both M and L is the change's `specs/` and `tasks.md`. If the session is in plan mode, this plan is the plan to exit with.

## L: moving to implementation

When the user has approved the plan, offer two options: continue in this session or start phase 4 in a new one. A new session is better for a long implementation: the design discussion is no longer needed there and only takes context. An L plan is self-contained and holds the design summary, so a new session needs only a link to the file. Do not copy a retelling of the plan into the prompt. The prompt goes in one block so it can be copied whole:

```
Use the java-dev-flow skill. L task, the plan is approved — start with phase 4, slice 1.
@docs/plans/YYYY-MM-DD-<slug>.md
```

In an OpenSpec project use `/opsx:apply <change name>` instead of the plan link. The choice is the user's: do not start a new session yourself and do not continue until they answer.

# Phase 5: verification in detail

**Open when:** you enter phase 5 of an M or L task, resolve reviewer or critic findings, or decide which signal checks are needed.

The short version is in `SKILL.md`, section "Phase 5". Agent prompts and how to read their answers — [subagent-handoff.md](subagent-handoff.md).

## Independent review: `java-code-reviewer`

An agent with a fresh context: it runs the `java-code-review` skill on the diff and changes nothing. The author misses what is "obvious" to them; the reviewer does not have that context and checks only what is written. Give the agent:
- the diff scope;
- 2–5 lines on what the change does (or paths to the OpenSpec change artifacts);
- the spec — requirements to check conformance against: for M the behavior list from the todo list, for L the plan path, for OpenSpec the change's `specs/`, for a tracker task its key or text. No spec — say so, the agent skips that axis;
- a focus, if any;
- the "check tests" flag if the diff has new tests.

Its findings are hypotheses: check each against the code. On `NOT_VERIFIED` find out what was left unchecked and finish the review yourself if needed. No agent — the `java-code-review` skill in the main context, and the report marks it as self-review.

## Critic: `critic`

The second fresh-context agent, always for M and L, in the same message as the reviewer. The reviewer looks for what is broken in the diff now; the critic for what happens when the change meets production: existing data, deploy and rollback, API and event consumers, retries and races, partial failures, load, observability. It checks every hypothesis against the code and loads domain skills by signals itself.

Give it the same as the reviewer plus the classification line and what is known about production: load, table sizes, consumers, deploy method. Critic blockers are hypotheses too: fix a confirmed one via route B. Its "Questions for the user" are the user's decisions: put them in the report instead of answering for the user. No agent — go through its questions yourself with the checklist in [fallback-checklists.md](fallback-checklists.md) and say so in the report.

If a turn ends without the critic and the change is large, the `critic-gate` Stop hook reminds you. It looks at the final message and at the changes on disk, so name the size and the changed files in the report and say whether the critic ran, and if not, why. Installation — in `skill-map.md`.

## Checks by signals, for M and L

| What changed | Check |
|---|---|
| new or changed tests | `test-audit`, authoring gate: no junk patterns. Usually delegate it to `java-code-reviewer` with the "check tests" flag rather than loading the skill into the main context |
| changeset, `@Entity` | the `review-migration` command; for L or a big, hot table — the `schema-reviewer` agent |
| endpoint, security config, roles, tenant | the `security-reviewer` agent |
| consumer, job, external integration, money | the `incident-thinker` agent: always in L, in M if there are external side effects |
| new queries on a hot path | the `explain-this-query` command for those queries |
| branching on type, status or string appeared or grew (3+ variants or the same `switch` in a second place) | `java-extensibility-review` on the changed classes. "Recommend" in this task's code — fix via route C before handover; in old code — into follow-ups |

Reviewers are read-only, so run them in parallel, in one message.

## Resolving findings

- A bug at confidence 80+ — route B: test first, then the fix. Not via `--fix` without a test.
- The same finding from two agents is one finding; fix it once.
- Do not blindly fix an unconfirmed finding — put "worth rechecking" in the report if doubt remains.

`java-code-review` and `java-extensibility-review` look at the same diff with different questions: "what is broken now" and "what is expensive to change later". How to keep their findings apart:
- do not act on a pattern suggestion from the "Improvements" section of `java-code-review` by itself — pass the question to `java-extensibility-review` with its rule of three;
- if the same code has both a bug and a "Recommend", fix the bug first (route B, the test pins the correct behavior), then refactor (route C) under green tests. The reverse order bakes the bug into characterization tests.

## Running tests

In M and L hand the full run to the `test-runner` agent if it is installed: it runs the command and returns a summary "command · passed / failed / skipped · failed tests with the first assertion line · what did not run and why". Maven and Spring logs then stay out of the main context. A `test-runner` summary is the output of a command run in this session, so it counts as evidence if the command ran after the last edit.

## Collecting the diff for the report

For the report use `git diff --stat` and the agents' conclusions. Do not read the full diff into the main context again — the reviewer and the critic have already read it.

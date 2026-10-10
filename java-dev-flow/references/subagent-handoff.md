# Handing work to subagents and reviewer agents

**Open when:** an L plan file is written (goldfish check, phase 3), in an L task you want to give a slice to a subagent, or you run a reviewer agent in phase 5.

## When to give a slice to a subagent

Give it away only if all of these hold:

- the task is L and the plan is approved;
- the slice is self-contained: its seams with other slices are already implemented or pinned in the plan as signatures;
- the slice shares no files with another slice running in parallel;
- the session has a subagent tool and the user did not ask you to do everything yourself.

Do not hand off S and M tasks: transferring the context costs more than the work. Do not hand off slices that change shared code (base classes, shared config, the security chain) — do them yourself.

Dependent slices go one after another. In parallel — only slices with disjoint files.

## About skills

A subagent **does not inherit** your loaded skills and does not see this conversation. Everything it needs must be in the prompt: the design summary, the slice from the plan, the seams, the names of skills it must call itself, the verification commands.

In an OpenSpec project, instead of the design summary pass the paths to `proposal.md`, `design.md`, `specs/` and the group number in `tasks.md`. The subagent does not touch the checkboxes in `tasks.md` — the coordinator ticks them after its own check.

## Prompt for a slice implementer

```
You implement slice <N> "<name>" in the project <repository path>.

## Context
<design summary, 10–20 lines>

Already implemented and used by this slice:
<classes and signatures from previous slices>

Integration test infrastructure: <from the plan: Testcontainers | @EmbeddedKafka for Kafka>.
Use the existing base class <path> if there is one; do not create a second setup.

## What to do
<the slice's behaviors from the plan, each with a test level and the breakage it catches>

Test boundaries: <from the plan>. Write tests only at them. Need another
boundary — stop and report (status NEEDS_CONTEXT).

## Required skills
Call via the Skill tool before starting (names may carry a plugin prefix,
e.g. backend-design-java:migration-safety):
- java-tdd — every behavior via red → green → refactor, checking that
  the test failed for the right reason
- <domain skills by the slice's signals>

## Constraints
- Change only this slice's files: <list or package>. Need to touch something
  else — stop and report (status NEEDS_CONTEXT).
- Do not commit or push<, unless the user allowed a commit per slice>.
- Do not start your own subagents or reviewers — the coordinator reviews.
- Fix hook warnings after file writes or describe them in the report.
- No Docker for Testcontainers — report it; do not replace Postgres with H2 or the Kafka container with @EmbeddedKafka.
- An architectural decision with several reasonable options that is not in the
  plan — do not make it yourself, return BLOCKED with the options.

## Verification
<command for the slice's tests>
<command for the module's tests>

## Report
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- changed and created files
- tests: name, level, the message the test failed with on RED
- commands run and their results
- hook warnings and what was done about them
- doubts, decisions made, what is left
```

## After the subagent's report

A report is a claim, not evidence.

1. Look at the diff: `git diff` / `git status`. Only the slice's files changed? Anything the report is silent about?
2. Rerun the slice and module tests yourself.
3. Compare with the plan: are all the slice's behaviors covered? Do the seam signatures match the plan?
4. `DONE_WITH_CONCERNS` — resolve every concern before moving on. `BLOCKED` or `NEEDS_CONTEXT` — give context, split the slice or do it yourself. Do not resend the same subagent with the same prompt.
5. Mark the slice done in the plan or todo list.

## Goldfish check of an L plan (phase 3)

After Dave Rensin's Elephant-Goldfish model: this session is the elephant and remembers the whole discussion; a goldfish is a fresh agent that knows only what is written. If a goldfish cannot retell the plan, or cannot implement it without asking, the plan relies on the conversation rather than on its text. Prompts adapted from [vshvedov/elephant-goldfish](https://github.com/vshvedov/elephant-goldfish) (MIT).

Runs at the end of phase 3 for every L plan file, before the plan is shown to the user (`design-and-plan.md`). Agent: `general-purpose` with `model: sonnet`, not Haiku (see the models note in `skill-map.md`). The prompt holds only the project path and the plan path: no retelling of the discussion, no intent, no "pay attention to". Whatever you add is context the plan does not carry, and the check stops testing the plan.

Round 1: comprehension and readiness in one message. Later rounds: a new readiness agent; never resume the previous one, it remembers the old version. Comprehension again only if round 1 misread the plan.

Comprehension:

```
You are a fresh reader with no prior context. In the project <path> read the plan
<plan path> and the files it references. Do not critique the plan or suggest changes.

Return:
## What the change does
2–5 sentences in your own words: the behavior that changes, who triggers it, what they get.
## How the system works today
2–5 sentences on the classes, tables, endpoints and events the plan touches and how they
behave now, checked against the code.

The first line is the status: `Status: CLEAR`, or `Status: UNCLEAR` followed by the
sections you could not retell and why. Do not edit files.
```

Readiness:

```
You are an experienced Java/Spring engineer who has not seen any discussion of this task.
In the project <path> read the plan <plan path> and the files it references. You must
implement it in one pass and cannot ask the author anything.

For every file, signature at a slice seam, table and column, endpoint, event, error code,
test boundary and verification command in the plan, check:
- could you write this code without asking the author?
- could you tell when it works: are the behavior and its test concrete?
- does it match the existing code: the file exists or is clearly new, the signature fits
  its callers, the referenced classes behave as the plan assumes?

List every question you would have to ask the author before you could ship. For each:
the question in one sentence; the plan section that should have answered it; and either
`in code: <file:line>` (the answer is in the repository) or `decision` (only a human can
decide it).

The first line is the status: `Status: READY` (no questions) or
`Status: NOT_READY — <n> questions`. Do not suggest design improvements and do not review
style: only what blocks a first-pass implementation. Do not edit files.
```

How to read the answers:
- comprehension `UNCLEAR`, or a retelling that differs from what was meant — the plan does not carry the context: rewrite the sections it misread;
- a readiness question `in code` — write the answer into the plan yourself;
- a readiness question `decision` — the user's call. It goes to them with the plan for approval, with your recommended answer; do not decide it for them;
- a question may be rebutted only as: outside the task (quote the goal or the user's words), decided by the user (quote them), or forbidden by `CLAUDE.md` (cite it). "Section X already says so" is not a rebuttal: the goldfish did not find it there, so rewrite section X. Rebuttals go verbatim into the plan's "Goldfish check" section;
- only nit-picks left (wording, names that cross no seam) — record them under assumptions and end the loop.

After a revision run a new readiness round. At most three revisions: if the third still ends `NOT_READY`, stop and ask the user — answer the remaining questions, cut scope, proceed with them recorded as assumptions, or stop. The check asks the user nothing by itself, so a general "do it all" does not skip it (`SKILL.md`, "When to stop and ask").

## Reviewer agents (phase 5)

`java-code-reviewer`, `critic`, `security-reviewer`, `schema-reviewer`, `incident-thinker` are read-only and run in a fresh context. That is their value: they do not know what is "obvious". Since they change nothing, run them in parallel, in one message. The answers of `java-code-reviewer` and `critic` are limited to 60 lines; longer means the agent duplicates findings across sections.

### java-code-reviewer

Always runs for M and L. The `java-code-review` skill is preloaded, so the prompt needs only what the agent does not know:

```
Review the changes in the project <path>.

Scope: <main...HEAD | --staged | file list>; if not given — the skill's
default mode (branch vs base plus uncommitted).

What the change does: <2–5 lines from the design summary>
<or: the intent is described in openspec/changes/<name>/ — proposal.md, design.md, specs/>

Spec: <requirements to check conformance against: behavior list (M),
plan path (L), openspec/changes/<name>/specs/, ticket key or text>
<or: "no spec" — then skip the spec conformance axis>

Focus: <places you have doubts about; optional>

Tests: <"check new and changed tests against test-audit" — if the diff has tests>

Return the report in your format: the first line is the status, then findings
with file, line, confidence and type (bug / improvement). Do not fix anything.
```

How to read the answer:
- `CLEAN` — record it in the report as a check with its result, do nothing;
- `FINDINGS` — check every finding against the code. Fix a bug via route B: test first. An improvement — optional, if it does not bloat the task. The "Spec conformance" section: implement a missing requirement with a `java-tdd` cycle (mode A), remove extra behavior or agree it with the user, fix a wrong implementation as a bug. The "For java-extensibility-review" section is material for the "branching grew" signal check;
- `NOT_VERIFIED` — find out what was not checked and why (the project does not build, no branch base). Fix the cause and rerun the review or check that part yourself. Do not pass a partial review off as a full one.

### critic

Always runs for M and L, in one message with `java-code-reviewer`. The critic loads domain skills by diff signals itself, so the prompt needs only what it does not know:

```
Do a pre-mortem of the changes in the project <path>: what breaks when this reaches production.

Scope: <main...HEAD | --staged | file list>.

What was done: <2–5 lines from the design summary or the plan path>
Requirements: <behavior list (M), plan path (L), openspec/changes/<name>/specs/,
ticket key or text> <or: "no spec">
Size and signals: <classification line from phase 0>

What is known about production: <load, sizes of affected tables, API and event
consumers, deploy method, number of replicas>
<or: "unknown — search the repository, put the rest into assumptions and questions">

Focus: <places you have doubts about; optional>

Return the report in your format: the first line is the status, then the pre-mortem,
blockers, risks, questions for the user and missing tests. Do not fix anything.
```

How to read the answer:
- `CLEAN` — record it in the report as a check with its result;
- `BLOCKERS` and `RISKS` — check every finding against the code. Fix a confirmed blocker via route B: test first. Fix a risk if the fix does not bloat the task; otherwise put it in the report with a decision and into follow-ups;
- "Questions for the user" are the user's decisions. Do not answer for them: put them in the report with the critic's recommended answer. If whether something is a blocker depends on the answer (e.g. the size of the table under migration), ask before writing "done";
- "Missing tests" — add an in-scope scenario with a `java-tdd` cycle, the rest into follow-ups;
- `NOT_VERIFIED` — find the cause, fix it and rerun the critic or check that part yourself. Do not pass a partial analysis off as a full one.

If `critic` and `java-code-reviewer` found the same thing, it is one finding: fix it once.

### test-runner

Runs tests and returns a summary instead of logs (model — Haiku, Bash only). Useful for the full run in M and L and for a class of integration tests: Maven and Spring logs stay out of the main context.

```
In the project <path> run: <command, e.g. ./mvnw verify>. Return the summary in your format.
```

How to read the answer:
- `PASSED` — evidence for the report if the command ran after the last edit;
- `FAILED` — the failed tests are named; analyze each yourself (that is not `test-runner`'s job) and name them in the report;
- `NOT_RUN` — the reason (no Docker, compilation) goes into the report; you cannot write "tests are green".

### security-reviewer, schema-reviewer, incident-thinker

Prompt:

```
Check <what: the branch's changes / specific files> in the project <path>.

Scope: <the command to get the diff, e.g.
git diff $(git merge-base HEAD origin/main) -- src/main>
or a file list.

What the change does: <2–3 lines from the design summary>

What to focus on: <e.g.: access to a payment by id from the path;
a new changeset on the orders table (~40M rows, hot)>

Return a list of findings in your format with file and line.
Do not fix anything.
```

Treat reviewer findings the same way as in `java-code-review`:
- check every finding against the code before accepting it;
- fix a confirmed bug via route B (test first);
- do not blindly fix an unconfirmed finding — mention it in the report as "worth rechecking" if doubt remains.

# Routes B, C, P

**Open when:** the task is a bugfix (B), a refactoring (C) or performance (P).

## Route B — bugfix

For a bug that reproduces locally, in tests or from a clear description:

1. **Diagnosis → `java-diagnosing-bugs`.** A command that fails on exactly this bug, a minimal reproduction, hypotheses, measurements. Depth by size: if the cause is visible from the stack trace and confirmed in one line (usually S), hypotheses and measurements shrink to one sentence. The feedback loop and the regression test are always needed.
2. **Fix → `java-tdd`, mode B.** The minimal reproduction becomes a test at the right boundary, the test fails with a message about this bug, the fix removes the cause, not the symptom. No right boundary — that is a finding for the report and follow-ups, not a reason to write a box-ticking test.
3. **Verification** — phase 5 by size. The regression test stays in the suite; the confirmed hypothesis goes into the report.

Two or three refuted hypotheses or the third failed fix — a reason to stop and ask.

A symptom in production or staging: `debugging-discipline` first. If customers are suffering right now — the `incident-investigator` agent, and mitigation comes before finding the cause. Once the bug is reproduced locally, continue from step 1; if the cause is already found and confirmed — from step 2.

## Route C — refactoring

1. If the goal is extensibility ("remove the switch", "extract a strategy"), call `java-extensibility-review` on the class first: it says whether the pattern pays off and what it will look like.
2. `java-tdd`, mode C: tests green before and after. No coverage — mode D.
3. Small steps, a green run after each. Behavior does not change; if you want to change it, that is a separate task on route A.
4. Verification — phase 5 by size. For M `java-code-reviewer` is mandatory.

## Route P — performance

1. `performance-and-scaling`: at what load and what is the bottleneck. Measure first, then fix.
2. If the bottleneck is the DB, load `query-discipline` and the `explain-this-query` / `hunt-n-plus-one` commands.
3. Where possible, pin the problem with a test. For example, an assertion on the number of SQL queries (an approach from `testing-with-discernment`) fails before the fix and then guards against regression.
4. Fix → measure again the same way → phase 5.

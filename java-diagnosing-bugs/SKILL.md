---
name: java-diagnosing-bugs
description: Diagnosis loop for hard bugs in a Java / Spring Boot service that reproduce locally, in tests, or from exact steps. Build a feedback loop that goes red on this bug → minimise → hypothesise → instrument → fix with a regression test → clean up. Use when a test fails for an unknown reason, an exception or wrong result shows up locally, a bug report has steps to reproduce, or two fixes have already missed. Symptoms in production or staging go to debugging-discipline first. Triggers also on "падает тест", "разберись, почему", "найди причину", "не работает локально", "debug this".
compatibility: Claude Code. Maven or Gradle (wrapper), git. Docker if the project uses Testcontainers.
---

# Diagnosing Bugs (Java / Spring Boot)

A discipline for hard bugs: the ones whose cause is not obvious from the first read of the stack trace. Skip phases only when explicitly justified. If the stack trace points at the cause and one line of code confirms it, Phases 3–4 shrink to one sentence: the hypothesis and what confirmed it. Phases 1 and 5 are never skipped.

## Neighbours

| Question | Owner |
|---|---|
| Route, task size, final verification and report | `java-dev-flow` (Route B calls this skill) |
| Symptom in production or staging, customers hurting now | `debugging-discipline`: mitigate first. Once the bug reproduces locally, continue here from Phase 2 |
| Find the cause | **this skill** |
| Red → green cycle for the regression test | `java-tdd`, mode B |
| Test level and infrastructure (Testcontainers / `@EmbeddedKafka`) | `testing-with-discernment` |

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. That includes passwords, tokens, `Authorization` headers and connection strings from `application-*.yml`. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1: Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug (one that goes red on _this_ bug), you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one, in roughly this order

1. **Failing test** at the level where the bug is observable (`testing-with-discernment` picks the level):
   `./mvnw -q test -Dtest='FooServiceTest#rejectsX' -Dsurefire.failIfNoSpecifiedTests=false` or `./gradlew test --tests 'com.example.FooServiceTest.rejectsX'`.
2. **HTTP script** against the app running locally (`./mvnw spring-boot:run -Dspring-boot.run.profiles=dev`): `curl` asserting status and body with `jq`.
3. **Replay a captured input.** A webhook body, a Kafka record, a DB row, redacted and turned into a test fixture. Kafka runs on the project's broker: Testcontainers or `@EmbeddedKafka`.
4. **Narrow harness.** A test that starts only the slice the bug needs (`@DataJpaTest`, `@JsonTest`, `@RestClientTest` + WireMock) instead of the whole context.
5. **Property / fuzz loop.** `@ParameterizedTest` with `@MethodSource` over a hundred generated inputs, or jqwik if the project has it. For "sometimes wrong output".
6. **Bisection harness.** If a known-good version exists: `git bisect run ./mvnw -q test -Dtest='FooIT' -Dsurefire.failIfNoSpecifiedTests=false`. Bisect switches the working tree: run it only on a clean tree, and ask before touching the user's uncommitted changes. Finish with `git bisect reset`.
7. **Differential loop.** Run the same input through the old and new version, two profiles, or two dependency versions, and diff the outputs.
8. **HITL bash script.** Last resort. If a human must click (a UI, a provider dashboard), drive _them_ with [scripts/hitl-loop.template.sh](scripts/hitl-loop.template.sh) so the loop is still structured. Captured output feeds back to you.

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- **Faster:** one test method, one module (`-pl <module> -am`), a reused container, `@DataJpaTest` instead of `@SpringBootTest`.
- **Sharper signal:** assert the specific symptom (status and ProblemDetail `code`, a field value, the SQL statement count), not "didn't crash".
- **More deterministic:** `Clock.fixed(...)`, a fixed seed, Awaitility instead of `Thread.sleep`, unique keys on a shared broker.

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight, a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. `@RepeatedTest(200)`; for races, several threads released together through an `ExecutorService` and a `CountDownLatch`; add stress, narrow timing windows. A 50%-flake bug is debuggable; 1% is not, so keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a redacted captured artifact (a log excerpt with `traceId`, a thread dump, a request body, a screen recording with timestamps), or (c) permission to add temporary logging. Do **not** proceed to hypothesise without a loop.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command** that you have **already run at least once** (show the invocation and its output, redacted), and that is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the **user's exact symptom**. A compilation error, a failed Spring context, or `Could not find a valid Docker environment` is not red (see VERIFY RED in `java-tdd`).
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes. An integration test pays container start-up once; repeat runs must be fast.
- [ ] **Agent-runnable**: you can run it unattended; a human in the loop only via the HITL script.

If you catch yourself reading code to build a theory before this command exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong value, timing) so later phases can verify the fix addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut fixture fields, beans, config properties, DB rows and steps **one at a time**, re-running the loop after each cut, and keep only what's load-bearing for the failure.

A minimal repro shrinks the hypothesis space in Phase 3 and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them makes the loop go green.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

Sources: recent changes (`git log -p -- <file>`), plus the domain skills the signals point at: `jpa-and-transactions` (proxies, lazy loading, dirty checking, rollback rules), `query-discipline`, `idempotency-and-side-effects`, `error-handling-as-design`.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just changed #3"), or know hypotheses they've already ruled out. Don't block on it; proceed with your ranking if the user is AFK.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger.** If the user works in an IDE, ask them to set a breakpoint at the point that separates the hypotheses. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. **SQL and transactions through test properties**, not code changes: `logging.level.org.hibernate.SQL=debug`, `logging.level.org.hibernate.orm.jdbc.bind=trace`, `logging.level.org.springframework.transaction.interceptor=trace`.
4. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `log.info("[DEBUG-a4f2] status={} version={}", ...)`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (test timing, SQL statement count, `EXPLAIN (ANALYZE, BUFFERS)`, JFR), then bisect. Measure first, fix second. Load questions go to `performance-and-scaling`.

After two or three falsified hypotheses, or a third fix that didn't work, **stop**. Re-read the symptom, gather more data, or talk it through with the user. A run of misses usually means the problem is in the design, not in one line.

## Phase 5: Fix + regression test

Write the regression test **before the fix** (`java-tdd`, mode B), but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. Examples of a seam that is too shallow:

- a `@Transactional` self-invocation bug: a unit test with mocks cannot reproduce it, it needs the Spring context;
- commit-time behaviour: a test class annotated `@Transactional` rolls back and never sees the commit;
- a SQL or constraint bug: a mocked repository never sees it, it needs `@DataJpaTest` against real Postgres.

**If no correct seam exists, that itself is the finding.** Note it in the report and follow-ups: the codebase architecture is preventing the bug from being locked down. Do not write a test that gives false confidence.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail with a message that describes this bug.
3. Apply the fix: the **cause, not the symptom**. A `try/catch` around an NPE, or `if (x != null)` without knowing where the null came from, fixes the symptom.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

## Phase 6: Cleanup

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep -rn 'DEBUG-' src`), temporary logging properties reverted
- [ ] Throwaway harnesses and scripts deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the report or commit message, so the next debugger learns

Commit only with the user's permission.

---

Adapted from `diagnosing-bugs` in [mattpocock/skills](https://github.com/mattpocock/skills) (MIT, commit `d81f3a1`): phases and completion criteria kept, examples rewritten for Java / Spring, plus the neighbour table and examples of a too-shallow seam for the regression test.

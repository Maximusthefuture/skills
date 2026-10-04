---
name: java-tdd
description: "Test-driven development for Java / Spring Boot: red → green → refactor with proof that every test can fail; modes for a feature, a bugfix, a refactoring and code without tests (JUnit 5, AssertJ, Mockito, Spring test slices, Testcontainers or @EmbeddedKafka, Maven/Gradle). Use BEFORE writing production code whenever you implement or change behavior in Java — new feature, bug fix, endpoint, query, listener, business rule — and on TDD, test first, red green refactor, «сначала тест», «почини баг», «реализуй», /java-tdd. Not for renames, formatting, yaml and generated code. The test level is chosen by testing-with-discernment, the test's value by test-audit."
compatibility: Claude Code. Maven or Gradle (preferably the ./mvnw / ./gradlew wrapper). Docker — for Testcontainers if the project has them; without them Kafka is tested on @EmbeddedKafka (spring-kafka-test). git — optional (proving a failure via stash).
---

# Java TDD

The test is written before the code. You see it fail for the right reason. Then you write the minimal code to make it pass.

**The main principle:** if you have not seen the test fail, you do not know whether it checks what it should. A test that has never been red could just as well be checking a mock, a typo or nothing.

## Checklist for every behavior

1. **A test** for one behavior, at the cheapest level where it is visible. Before writing the test body, name the code breakage it will catch.
2. **Run only this test → red.** Show the failure line: an assertion failing for the expected reason. A compilation error, a failed Spring context, 401/403 or "no Docker" is not RED.
3. **Minimal code** to make the test pass. Nothing "while I'm at it".
4. **Run → green**, together with the tests of the same class or module.
5. **At the end of the task — the full suite** (`./mvnw verify` / `./gradlew check`). Every failed and every not-run test goes into the report by name, with the reason (e.g. no Docker).

Skipped step 2 — go back and prove the failure (section "If the code was written before the test").

## Boundary with neighboring skills

| Question | Owner |
|---|---|
| What the task is, phases, design, slice plan, final verification and report | `java-dev-flow` (calls this skill in the implementation phase) |
| Order of test and code, proof that the test catches the bug, when work is "done" | **this skill** |
| Test level (unit, `@DataJpaTest`, `@WebMvcTest`, `@SpringBootTest`, WireMock) and infrastructure (Testcontainers or `@EmbeddedKafka`) | `testing-with-discernment` |
| Is the test worth its cost, is there a test-only seam in `src/main` | `test-audit` (authoring gate) |
| Honest assertions and mocks | [references/writing-good-tests.md](references/writing-good-tests.md) |

Neighboring skills are missing — the minimum on levels and infrastructure is in [references/infrastructure.md](references/infrastructure.md).

## When to apply

**Apply:** new business logic, an endpoint, a repository query, a listener or consumer, a bug fix, a change of existing behavior — even if the edit is one line.

**Do not apply:** renames, moves, formatting, dependency updates without behavior change (a green run before and after is enough); `application.yml` and generated code; a throwaway spike the user called so (the code is then rewritten through the cycle); a changeset by itself — but the constraint or behavior it adds gets a test.

In doubt whether an edit changes behavior — assume it does.

## Modes

| Situation | Mode |
|---|---|
| New behavior | **A** — the full cycle |
| A bug | **B** — reproduce with a test first |
| Refactoring without behavior change | **C** — no RED phase |
| Code without tests must change | **D** — pin the current behavior first, then A or B |

## The red → green → refactor cycle

```
RED        one test for one behavior
VERIFY RED the test fails on an assertion, for the expected reason   ── no → fix the test, RED again
GREEN      minimal code to make the test pass
VERIFY     this test and its neighbors are green                     ── no → fix the code
REFACTOR   remove duplication, improve names; tests stay green
next behavior → RED
```

**RED.** One behavior ("and" in the name — split it). The name describes behavior: `rejectsTransferWhenBalanceIsInsufficient`, not `testTransfer`. The level is the cheapest where the behavior is observable: do not start `@SpringBootTest` for a pure function and do not mock the repository to check a query. The infrastructure is what the project already has. Variants of one rule — `@ParameterizedTest` with literal expected values.

**VERIFY RED — mandatory.** Run only the new test: `./mvnw -q test -Dtest='FooTest#rejectsX' -Dsurefire.failIfNoSpecifiedTests=false` or `./gradlew test --tests 'com.example.FooTest.rejectsX'`. A correct RED is a failure for the expected reason, usually an assertion: `expected: 409 but was: 201`. A compilation error — create a stub with the needed signature and run again. How to tell RED from an error in the other cases (context, Docker, Kafka, security, JSON) — [references/red-failures.md](references/red-failures.md). A test that is green right away in modes A and B does not check the new behavior — rewrite it.

**GREEN.** The simplest code that makes the test pass. Do not add parameters, settings, generalizations. It turned out the test itself was wrong — that is a return to RED: fix the test and **again** make sure it fails without the implementation.

**VERIFY GREEN.** The new test and the tests of the same class or module are green; the output has no new exceptions or warnings.

**REFACTOR.** Only after green. Duplication, names, helpers — in code and tests. A green run after every step.

One cycle — one behavior. Do not write five tests and then the whole implementation at once.

## Modes in detail

**A. New feature.** Split it into observable behaviors: rules, branches, errors, edge cases; start with the simple success scenario. Error paths are behaviors too, each its own cycle: invalid input → 400 ProblemDetail with a code, someone else's resource → 404, a conflict → 409, no permission → 403.

**B. Bugfix.** Reproduce the bug with a test at the level where it is observable (often `@DataJpaTest` or `@SpringBootTest` + Testcontainers, not a unit test with mocks). VERIFY RED: **the error message describes exactly this bug**, otherwise you reproduced a different one. Minimal fix → VERIFY GREEN → the full suite. One regression test per bug, at the level that owns the behavior. A bug is not fixed without a failing test.

**C. Refactoring.** Find the tests for the code you change, run them — green. Check that they catch a breakage: break the code (remove a branch, return `null`) — a test must fail; none does — there is no coverage, mode D. Refactor in small steps with a green run. A test that failed from a refactoring without behavior change checks the implementation — rewrite it against observable behavior.

**D. Code without tests.** Characterization tests pin the current behavior the edit will touch; they **pass right away**, that is expected. Prove they can fail: break the code, see red, restore the code. The current behavior looks like a bug — do not pin it silently, ask the user whether it is a contract or a bug. Then A or B.

## If the code was written before the test

Deleting the implementation is pointless: the code is already in the context. **Prove the test can fail without this code:**

1. Write a test for the behavior — from the task description, not from how the implementation works.
2. Remove your change: `git stash push -- <files>` or temporarily restore the old version of the method.
3. Run the test — it must fail on an assertion for the expected reason. It passes — the test checks nothing, rewrite it.
4. Restore the change (`git stash pop`), run — green.

Only for code you wrote yourself in this session. Do not stash someone else's uncommitted changes without asking.

## Infrastructure and commands — briefly

- Use the wrapper (`./mvnw`, `./gradlew`) and the commands from the project's `CLAUDE.md`. Other commands (a class, an IT, a module) — [references/commands.md](references/commands.md).
- The build chooses the infrastructure, not the environment: Testcontainers present — tests run on them; absent — Kafka on `@EmbeddedKafka`, the DB the way the project already starts it, and if it does not — ask. Not H2. No Docker — tell the user and name the tests that did not run; do not rewrite a test to `@EmbeddedKafka` or H2 for a green run. Details — [references/infrastructure.md](references/infrastructure.md).
- Do not change sources while a build is running in the same working copy.

## When the work is done

1. **Run the project's full suite**, even if the task touched one class. A green new test is not a green suite.
2. **Name every failed test in the report**, including those that failed not because of you. Kept quiet about a failed test — the report is false.
3. **Name what did not run and why**: e.g. `*IT` did not run — no Docker. Do not write "all tests are green" if some did not run.
4. **Commit** — only if the user allowed it; the test and implementation of one behavior go in one commit.

Quality checklist: every new behavior is covered at its level; you saw every A/B test red; every characterization test was checked by breaking the code; the implementation is minimal; expected values are literals; error paths and edges (null, empty, 0, someone else's id, no permission, duplicate) are covered where real; added test dependencies are named in the report.

## Red flags

Stop and go back to the cycle if you notice that:

- you write an implementation for a behavior that has no failing test yet;
- a new test in mode A/B passed on the first run and you move on;
- you cannot explain why the test failed; the "RED" is a compilation error or a failed context;
- you change an expectation in a test to make it green;
- you ran only your test and are about to say "done";
- you add a method, setter or `@VisibleForTesting` to `src/main` only for a test;
- you write `verify(mock)` where the result is visible through an observable effect.

Tempted to skip a test ("too simple", "I'll check later", "H2 is faster") — [references/rationalizations.md](references/rationalizations.md). Full cycle samples (plain JUnit, `@DataJpaTest` + Testcontainers, `@WebMvcTest`, `@KafkaListener`) — [references/examples.md](references/examples.md).

The skill is adapted from `test-driven-development` in [obra/superpowers](https://github.com/obra/superpowers) (MIT): contradictions removed, modes for refactoring and legacy added, examples rewritten for Java/Spring.

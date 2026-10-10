# Artifact templates

**Open when:** you write a design summary (phase 2), an L-task plan (phase 3) or the final report (phase 6).

An artifact is not decoration. It closes a phase and shows that the phase was done. It can also be handed to a subagent, so it does not have to rebuild the context.

The templates fix the structure. Write the text and headings in the user's language.

---

## Classification line (phase 0)

```
Route: <feature | change | bugfix | refactoring | schema | performance> · <S | M | L> · signals: <evidence> → <skills>
```

Examples:

```
Route: change · S · no signals → java-tdd
Route: feature · M · signals: new table, filtered list → data-modeling-discipline, migration-safety, query-discipline
Route: bugfix (local) · S · signals: @Transactional → jpa-and-transactions
Route: feature · L · signals: webhook, payment, new table, roles → idempotency-and-side-effects, data-modeling-discipline, migration-safety, auth-and-authorization
```

---

## Design summary (phase 2)

M — in chat, L — at the top of the plan file. 10–20 lines. Do not fill empty items for the sake of form. For example, "Authorization: like the other endpoints of the module, role USER" is a fine answer.

```markdown
## Design: <name>

**Context:** <component type, where it lives, expected load, latency budget>
**Data:** <entities and relations; invariants → constraints; changeset: yes/no, what changes>
**Errors:** <error → HTTP status / code / behavior; what happens when an external system fails>
**Authorization:** <who calls, which permission, how row access is limited>
**Retries and concurrency:** <idempotency key / dedup / @Version / lock / outbox>
**Observability:** <logs at the boundary, metrics, health>
**Extensibility:** <only if the task adds a variant to an existing set: the java-extensibility-review verdict and whether a preparatory refactoring is needed>
**Assumptions:** <what the user has not confirmed and what it affects if wrong>
```

Before showing it, reread the summary and check:
- no "TBD", "clarify later" or items without a decision;
- the items do not contradict each other: e.g. errors and retries agree with data and authorization;
- every requirement can be read only one way. If two readings are possible, pick one, record it under "Assumptions" and show the user.

---

## L-task plan (phase 3)

In an OpenSpec project this template is not used: the plan is the change, and the `tasks.md` format is in `references/openspec.md`.

File: `docs/plans/YYYY-MM-DD-<slug>.md`, unless the project has its own place (ADR, `docs/design`, a note in `CLAUDE.md`).

The plan pins the decisions the implementer cannot make alone: files, names and signatures at slice seams, behaviors and test levels. Method bodies do not go into the plan. A plan longer than the future code is already code, not a plan.

````markdown
# <Feature> — implementation plan

**Goal:** <one sentence>
**Design:** <the full design summary or a link>
**Constraints:** <Java/Boot versions, API backward compatibility, prohibitions from CLAUDE.md, dependency limits>
**Integration test infrastructure:** <from the build: Testcontainers (Postgres, Kafka) | no Testcontainers: Kafka — `@EmbeddedKafka`, DB — <how the project starts it in tests>>; added test dependencies: <none | `org.testcontainers:kafka` | `spring-kafka-test`>

## Rejected alternatives
- <option> — <why not: the user's decision, a constraint, a measurement>

## PR split
- PR 1: slices 1–2 (schema and repository) — can be merged separately
- PR 2: slices 3–5

## Slice 1: <name, e.g. "Payments schema and repository">

**Files:**
- create: `src/main/resources/db/changelog/2026/10/001-payments.sql`
- create: `src/main/java/com/acme/payment/Payment.java`, `PaymentRepository.java`
- tests: `src/test/java/com/acme/payment/PaymentRepositoryTest.java`

**Seams:** <what the slice gives to the next ones: method signatures, types>

**Test boundaries:** `PaymentRepository` (queries and constraints). Existing boundaries only; a new one — with the reason the behavior is otherwise unobservable

**Behaviors:**
- [ ] a repeated payment with the same `provider_payment_id` is rejected — `@DataJpaTest` + Testcontainers — catches: no unique constraint
- [ ] `findPendingOlderThan` returns only PENDING older than the threshold — `@DataJpaTest` — catches: wrong filter or boundary

**Slice skills:** data-modeling-discipline, migration-safety, jpa-and-transactions

**Verification:** `./mvnw -q test -Dtest=PaymentRepositoryTest -Dsurefire.failIfNoSpecifiedTests=false`

## Slice 2: ...

## Risks not covered by slice tests
<Inputs and failures the task implies but no slice checks yet. For example: a duplicate webhook while the first is still processing; a provider timeout after the charge. For each — which slice gets the test.>

## Goldfish check
Rounds: <n> · comprehension: <CLEAR | UNCLEAR → what was rewritten> · readiness: <READY | n questions left>
- rebutted: <question> — <reason, verbatim>
- accepted as an assumption: <question> — <assumption>
````

Before showing it to the user, check the plan yourself:
- every requirement has a slice;
- names and signatures at seams match between slices;
- the plan has no lines that decide nothing ("handle errors", "add tests");
- every option that was discussed and dropped is under "Rejected alternatives": a later session would otherwise propose it again.

Then run the goldfish check (`subagent-handoff.md`) and fill in its section.

---

## Final report (phase 6)

````markdown
## Summary: <one sentence: is it done and what blocks it>

Route: <classification line; if the size changed — from what to what and why>

### Done
- <behavior> — `<files>` — test `<Class#method>` (<level>), red: «<failure message>»
- ...

### Cause (bugfix only)
<the confirmed hypothesis and what confirmed it; if there is no right boundary for a regression test — why>

### Checks
- `./mvnw verify` — <N tests, 0 failed> (or the failed ones by name)
- java-code-reviewer — <status; n findings ≥ 80: fixed m, left k — why> (no agent: "java-code-review, self-review")
- critic — <status; blockers: fixed m of n; risks: fixed k, left l — why> (no agent: "critic questions, self-review")
- goldfish check (L) — <READY in n rounds | skipped by the user | k open questions accepted as assumptions>
- <agent / command> — <result>

### Questions before release (from critic)
- <question — recommended answer — what breaks if the answer differs>

### Not run and not checked
- <e.g.: *IT did not run — no Docker>
- <skill X is not installed — the step used the short checklist>

### Decisions and assumptions
- <decision — why — the risk if it is wrong>

### Hook warnings left on purpose
- <file:line — warning — why it was left>

### Follow-ups
- <what was deliberately not done in this task>
````

Delete empty sections. If everything is green and checked, the report may fit in five lines, and that is fine.

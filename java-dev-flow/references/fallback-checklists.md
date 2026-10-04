# If a skill or agent is missing — short checklists

**Open when:** the needed skill or agent is not in the session. Use only in that case and mention it in the report. A checklist does not replace the skill; it only keeps you from skipping the step entirely.

**grilling.** Ask in one round every question whose answer does not depend on still-open ones, number them and give a recommended answer to each. After the answers, recompute which questions became available and ask the next round. Finish when no open decisions remain and the user has confirmed the shared understanding.

**think-before-coding.** Answer six questions, 10–20 lines:
1. component type and expected load;
2. entities, invariants and their constraints, whether a changeset is needed;
3. errors: what, with which code, how to recover;
4. who calls, with which permission, which rows they can access;
5. what happens on a retry and on a parallel run (idempotency key, `@Version`, outbox);
6. logs, metrics, health.

**java-tdd.** One behavior → test → run: the test must fail on an assertion for the expected reason (a compilation error or a failed context is not RED) → minimal code → run → refactor. At the end — the full suite; name the failed and not-run tests.

**java-diagnosing-bugs.**
- First, one command, already run and failing on exactly this bug: a test, `curl`, a replay of a captured input. No hypotheses without it.
- Shrink the reproduction until every remaining element is load-bearing.
- 3–5 hypotheses by likelihood, each with a prediction "if X, then Y". Show the list to the user.
- Measure one variable at a time; debug logs tagged `[DEBUG-xxxx]`, remove them with `grep` at the end.
- A regression test at the boundary where the bug really reproduces; none — record it in the report.

**debugging-discipline.**
- Determine the mode: an incident in progress (mitigation first; take a thread dump, heap histogram and `pg_stat_activity` before a restart) or a stable bug.
- The symptom: when it started, whom it affects, what share, what exactly is wrong.
- Where to look: Hikari pending, error rate by route, recent deploys.
- Reproduction, bisect, one hypothesis at a time.

**java-code-reviewer (agent).** No agent — run the `java-code-review` skill in the main context and note in the report that the review was the author's self-review.

**java-code-review.** Take your diff against the base, including uncommitted changes. For every changed method read the whole file and the calling code. Check:
- null and edge cases;
- `@Transactional` and proxies;
- N+1 and lazy loading;
- authorization and injections;
- backward compatibility of DTOs and statuses.

Try to refute every finding with the code. Keep only confirmed ones.

**critic (agent).** No agent — ask yourself the questions, against your diff, and find each answer in the code with file and line:
- what happens to the data already in the affected tables;
- are the old and new versions compatible during a rolling deploy, can the code be rolled back without rolling back the schema;
- who consumes the changed APIs, events and formats;
- what happens on a retry, a race and a failure between steps;
- what runs out first under production load;
- will we notice the breakage at night and how will we recover.

What the code does not answer goes into questions for the user. Note in the report that this was the author's self-review.

**java-spec-review.** Read in full the proposal, design, tasks, all deltas and the main specs the change modifies. Check:
- every requirement has SHALL or MUST and a scenario with `#### Scenario:`; THEN has literals: status, `code`, field, state;
- there are scenarios for errors (400/403/404/409), retries and existing data;
- error codes and statuses are the same in specs, design and code;
- MODIFIED does not lose base scenarios;
- Open Questions do not change specs and tasks;
- every new scenario has a task, the last group is "Verification".

Decisions — as questions to the user with a recommended answer. Edit the artifacts after consent.

**java-extensibility-review.** The question: what has to change when another variant is added? Candidates: a `switch` or an `if` chain on type, status, string; repeated branching on one enum; `instanceof` chains. Options: an enum with behavior, `Map<String, Bean>`, a strategy, sealed + switch. A `switch` on three stable branches is often better than a pattern.

**testing-with-discernment.**
- Pure logic — JUnit without Spring.
- Queries and constraints — `@DataJpaTest` + Testcontainers Postgres.
- HTTP contract — `@WebMvcTest`.
- The whole scenario — `@SpringBootTest` + Testcontainers.
- Infrastructure — from the project build (`grep -rnE 'org\.testcontainers|spring-kafka-test'` over `pom.xml` / `*.gradle*`):
  - Testcontainers present — DB and Kafka on them; no `org.testcontainers:kafka` module — add it with the same version;
  - absent — Kafka on `@EmbeddedKafka` (`spring-kafka-test`, version from the BOM), the DB the way the project already starts it in tests, otherwise ask;
  - no Docker — report it, do not switch the option.
- Kafka test: `auto-offset-reset=earliest`, Awaitility on the result (DB, outgoing topic, DLT); a repeated event — one effect.
- External HTTP — WireMock; async — Awaitility; time — `Clock`.
- No H2 and no `Thread.sleep`.

**test-audit.** Before adding a test answer four questions: which behavior it protects; which realistic regression breaks it; why existing tests do not catch it; does it require a seam in `src/main` that only tests need. Junk:
- a test without assertions;
- the only assertion is a `verify` on a mock;
- a mock returns what is then asserted;
- the expected value is computed by the code under test;
- H2 instead of Postgres;
- `Thread.sleep`.

**data-modeling-discipline.**
- NOT NULL by default; UNIQUE, CHECK, FK with an explicit `ON DELETE` and an index on the FK side.
- Money — `numeric` / `BigDecimal`; instants — `timestamptz` / `Instant`; fixed sets — `text` + CHECK and `@Enumerated(STRING)`.
- Soft delete — only with a justification.

**migration-safety.**
- Applied changesets are not edited.
- An index — `CONCURRENTLY` and `runInTransaction:false`.
- NOT NULL on a big table — `CHECK NOT VALID` → `VALIDATE` → `SET NOT NULL`; an FK — `NOT VALID`, then `VALIDATE`.
- Rename, drop and type change — via expand/contract, not in one step.
- `lock_timeout` and a rollback are mandatory; backfill — not inside the changeset.

**jpa-and-transactions.**
- `@Transactional` — only on public methods called through the proxy (no self-invocation).
- No HTTP or Kafka inside a transaction; a checked exception does not roll back by default.
- to-one associations — LAZY; enums — STRING; no Lombok `@Data` on entities.
- `@Version` where concurrent edits are possible; OSIV off.

**query-discipline.**
- No queries in a loop and no lazy access in mappers.
- No `findAll()` without a limit.
- `JOIN FETCH` of a collection with `Pageable` paginates in memory.
- Keyset pagination on big tables.
- An index for `WHERE` and `ORDER BY`.

**idempotency-and-side-effects.**
- An idempotency key for mutating HTTP requests; a dedup table for consumers.
- DB write + message — via outbox; nothing remote inside `@Transactional`.
- Retries — with the same key; `@Scheduled` — with ShedLock.

**error-handling-as-design.**
- `@RestControllerAdvice` + ProblemDetail with a stable `code`; validation at the boundary via `@Valid`.
- Exceptions are not swallowed and the cause is not lost.
- Unique violation → 409; timeouts on all outgoing calls.

**auth-and-authorization.**
- Authentication separate from authorization; the filter chain ends with `authenticated()` or `denyAll()`.
- Owner or tenant check at the row level (`findByIdAndOwnerId`, RLS).
- The tenant comes from the principal, not from the request body.
- `@PreAuthorize` — only on public bean methods.

**security-discipline.**
- IDOR on access by id; mass assignment (`@RequestBody` with an entity).
- Concatenation in SQL/JPQL/SpEL.
- Secrets in yml, open Actuator, stack traces in responses, disabled TLS checks.

**observability-by-default.**
- JSON logs with traceId and business identifiers at the boundary.
- Metrics: RED for HTTP; lag, DLT and retries for consumers; duration and last success for jobs.
- Readiness includes mandatory dependencies; liveness never includes the DB.

**performance-and-scaling.**
- First "at what load" and the bottleneck: pool, query plan, GC, locks.
- Query and index are fixed before scaling.
- Measure before and after — the same way.

**boring-by-default.** Four questions:
1. Which measurable problem does the current stack not solve?
2. What is the cheapest extension of the current stack that solves it?
3. How much will the new technology cost to operate over five years?
4. Who will fix it at three in the morning?

**jira-tasks.** Without the skill do not create Jira tickets. Give the user the follow-ups as text.

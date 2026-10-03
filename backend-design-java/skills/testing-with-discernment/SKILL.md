---
name: testing-with-discernment
description: Use when writing, reviewing, or planning tests for Spring Boot backend code (JUnit 5, Mockito, AssertJ, Testcontainers, @EmbeddedKafka, @SpringBootTest, @DataJpaTest, @WebMvcTest, WireMock). Forces a "what is worth testing" decision instead of a coverage target, and picks the integration-test infrastructure from the project's build (Testcontainers if the project has it, otherwise @EmbeddedKafka for Kafka). Catches tests that mock the code they claim to test, H2 instead of PostgreSQL, @Transactional tests that hide commit-time behavior, and Thread.sleep flakiness. Apply BEFORE marking a bug fix done. Triggers also on "напиши тест", "тесты", "покрытие", "интеграционный тест", "Testcontainers", "EmbeddedKafka", "тест на Kafka", "тест консьюмера", "флаки тест".
---

# Testing With Discernment

Coverage is not the goal; confidence is. A suite of Mockito tests that mock the repository and assert that `save()` was called proves nothing about the SQL, the constraints or the transaction. Ten integration tests against real Postgres prove what matters.

## The Discipline

Before adding a test, answer:

1. **What could break here in an interesting way?** Branching logic, state transitions, money, parsing external formats, queries and constraints, retries and dedup, authorization decisions.
2. **What would the test prevent?** A named regression. "Coverage" is not an answer.
3. **At what level?** A plain unit test for pure logic. A slice or integration test with real Postgres for anything touching JPA, SQL, Liquibase, transactions or Spring wiring.
4. **Will it stay fast and deterministic?** No `Thread.sleep`, no real clock, no network, no shared mutable state.

## Choose The Infrastructure From The Project

Before the first integration test, check what the build already has. The project decides, not habit and not the machine the tests happen to run on.

```bash
# build files of every module: Maven, Gradle, version catalogs
grep -rnE 'org\.testcontainers|spring-boot-testcontainers|spring-kafka-test' \
  --include=pom.xml --include='*.gradle' --include='*.gradle.kts' --include='*.toml' \
  --exclude-dir=target --exclude-dir=build .
# test setup that already exists and should be reused
grep -rlE '@Testcontainers|@ServiceConnection|@EmbeddedKafka' \
  --include='*.java' --include='*.kt' --exclude-dir=target --exclude-dir=build .
```

| The build has | Database tests | Kafka tests |
|---|---|---|
| Testcontainers (any `org.testcontainers` artifact or `spring-boot-testcontainers`) | Testcontainers Postgres + `@ServiceConnection` | Testcontainers Kafka + `@ServiceConnection`. If only other modules are declared (e.g. `postgresql`), add `org.testcontainers:kafka` at the version the project already uses |
| No Testcontainers | The production engine, started the way the project already starts it for tests. If there is no such way, stop and ask the user before adding Testcontainers. Never H2 | `@EmbeddedKafka` from `spring-kafka-test` (test scope, version from the Spring Boot BOM; add it if missing) |

- **Decide per module**, together with its parent POM or convention plugin. Testcontainers in a sibling module counts: it is already the project's tool, so add it to this module at the same version.
- **No Docker is not "no Testcontainers".** If the project uses Testcontainers and Docker is unavailable where the tests run, report it. Do not rewrite the test to `@EmbeddedKafka` or H2 to get a green run.
- **Reuse before you add.** An existing base class, a `@TestConfiguration` with `@ServiceConnection` beans, or a meta-annotation with `@EmbeddedKafka` is where the new test goes. A second setup is a second Spring context and a second broker.
- **Do not migrate** existing tests from one option to the other inside an unrelated task. New tests follow the table; a migration is its own change, agreed with the user.
- **Name what you added.** A new test dependency (`org.testcontainers:kafka`, `spring-kafka-test`) goes into the report.

## The Spring Test Toolbox, By Purpose

| Testing... | Use | Not |
|------------|-----|-----|
| Domain logic, calculations, state machines | Plain JUnit + AssertJ, no Spring | `@SpringBootTest` |
| Repositories, queries, constraints, mappings | `@DataJpaTest` + `@AutoConfigureTestDatabase(replace = NONE)` + Testcontainers Postgres | H2, mocked repositories |
| Controller contract (status, ProblemDetail, validation, security rules) | `@WebMvcTest` + `MockMvc`/`MockMvcTester` + `@WithMockUser`/`jwt()` | Calling the controller method directly |
| Use case end to end (tx boundaries, outbox, listeners) | `@SpringBootTest` + Testcontainers (Postgres, Kafka); Kafka on `@EmbeddedKafka` if the project has no Testcontainers | Mocking your own services |
| Kafka listeners and producers | `@SpringBootTest` + a real broker [chosen from the project](#choose-the-infrastructure-from-the-project), Awaitility on the outcome | A mocked `KafkaTemplate`; calling the `@KafkaListener` method by hand as the only test |
| Outbound HTTP | WireMock (or `MockRestServiceServer`) at the HTTP boundary | Mocking the `RestClient` fluent chain |
| Async / consumers | Awaitility `await().atMost(...)` on an observable outcome | `Thread.sleep` |
| Time | Injected `Clock`, `Clock.fixed(...)` in tests | `Instant.now()` in code |

## Real PostgreSQL, Always

- **H2 lies.** Its SQL dialect, types (`jsonb`, `timestamptz`, arrays), constraint behavior, locking (`SKIP LOCKED`), and RLS all differ. A green H2 suite says nothing about prod.
- **Testcontainers with `@ServiceConnection`** (Boot 3.1+) wires the DataSource automatically. Reuse one container per JVM (a static container in a base class, or `spring.testcontainers` with reuse locally) to keep the suite fast.
- **Liquibase runs in tests.** The changelog is exercised on every run, and `ddl-auto=validate` catches entity/schema drift. That is one of the most valuable checks in the suite, for free.
- **No Testcontainers in the project** does not make H2 acceptable. See [Choose the infrastructure](#choose-the-infrastructure-from-the-project): use the project's existing way to run the real engine, or ask.

## Kafka Tests

Both options run a real broker: serializers, the listener container, the error handler, retries, `@RetryableTopic` and the DLT behave as in prod. Neither is a reason to mock `KafkaTemplate` in an integration test.

**Testcontainers Kafka.** Use the container class of the project's Testcontainers version: `org.testcontainers.kafka.KafkaContainer` in 1.20+, the deprecated `org.testcontainers.containers.KafkaContainer` before it. Pin an image close to the prod broker version. If `@ServiceConnection` does not recognize the container on the project's Boot version, register `spring.kafka.bootstrap-servers` with `@DynamicPropertySource`. One container per JVM, like Postgres.

**`@EmbeddedKafka`.** An in-JVM broker started with the Spring context:

```java
@SpringBootTest(properties = "spring.kafka.consumer.auto-offset-reset=earliest")
@EmbeddedKafka(partitions = 1, topics = "payments.captured",
               bootstrapServersProperty = "spring.kafka.bootstrap-servers")
class PaymentEventsListenerTest { ... }
```

- The broker lives in the cached context. Every distinct set of `@EmbeddedKafka` attributes is a new context and a new broker: keep one configuration in a meta-annotation or base class. Do not copy `@DirtiesContext` from examples; it restarts the broker for every class.
- Let the Spring Boot BOM manage the `spring-kafka-test` version. A pinned version brings Kafka server jars that disagree with `kafka-clients`.
- What it does not give you: the prod broker version and config, Schema Registry (Confluent serializers accept a `mock://` registry URL), broker restarts and network faults. If the behavior under test depends on those, say so in the report.

**Both:**
- `auto-offset-reset=earliest` for the consumer under test. With the default `latest`, a record sent before partition assignment is skipped, and the test times out for a reason unrelated to your code.
- Assert the observable outcome with Awaitility: the row in the DB, a record on the outbound topic read by a test consumer, a record in the DLT. Not `verify` on a mocked service.
- The broker is shared between tests: use a unique key and unique ids per test, and assert on your record, not on "the topic has exactly one message".
- Before you accept a timeout as a failing test, check the log that the listener received the record. A timeout caused by a deserialization error or a missing topic is not the missing behavior.
- Cover what Kafka does to you: the same event twice gives one effect; a poison message lands in the DLT and does not block the partition.

## Tests That Lie (Spring Edition)

- **`@Transactional` on the test class.** Each test rolls back at the end, so nothing ever commits. Constraint violations deferred to commit never fire, `@TransactionalEventListener(AFTER_COMMIT)` never runs, the outbox publisher never sees the row, and lazy loading "works" because the session is still open. For use-case tests, let the service commit and clean up explicitly (truncate tables between tests).
- **Mocking the repository to test the service.** "Verify `save` was called" passes even if the query is wrong, the constraint rejects the row, or the transaction never commits. For data-heavy services, test against the DB.
- **`@MockitoBean` everywhere.** Every distinct set of mocked beans creates a new application context. A suite with 30 variants starts Spring 30 times. Keep mocks for true externals and share configurations.
- **`@SpringBootTest` for a pure function.** Seconds of context startup to test `a + b`.
- **Snapshot JSON assertions on whole responses.** Assert the fields and codes the contract promises.
- **The "it should work" assertion.** `assertThat(result).isNotNull()`. Assert the value.

The inversion question: "If the feature breaks, does this test fail?" If you cannot say yes with certainty, it is decoration.

## What To Test Densely

- **Constraints and queries:** the unique violation maps to 409 with `EMAIL_TAKEN`, tenant A cannot read B's row (including through native queries if RLS is used), a keyset page returns the right next page.
- **Transaction semantics:** a checked exception rolls back (or does not, as designed), concurrent update → `@Version` conflict → 409, the outbox row exists if and only if the business row exists.
- **Idempotency:** the same `Idempotency-Key` twice gives one effect and the same response; redelivering the same Kafka event is a no-op.
- **Security rules:** anonymous → 401, wrong role → 403, foreign id → 404, mass-assignment fields ignored.
- **Error contract:** invalid body → 400 ProblemDetail with field errors and a stable code.
- **Query count on hot paths:** assert the number of statements (Hypersistence Utils `SQLStatementCountValidator`, datasource-proxy's `QueryCountHolder`, or Hibernate `Statistics`) so an N+1 regression fails the build.
- **Anything that broke before:** one regression test per bug.

Test thinly or skip: getters, mappers without logic, Spring wiring that `@SpringBootTest` startup already proves, framework behavior.

## Bug-First Rule

1. Reproduce as a failing test, usually an integration test with Testcontainers.
2. Watch it fail for the expected reason.
3. Fix the code.
4. Watch it pass.
5. Commit the test with the fix.

## Speed And Determinism

- One Postgres and one Kafka (container or embedded broker) for the whole run. Truncate between tests instead of new containers.
- Keep the number of distinct Spring contexts small (watch the context cache).
- No `Thread.sleep`: use Awaitility on a condition.
- Inject `Clock`; seed randomness; WireMock for every remote.
- Tests are order-independent and can run in parallel classes.
- A flaky test is fixed or deleted today.

## The CI Contract

- **Unit + slice tests:** every push, minutes.
- **Integration (`*IT`, Testcontainers):** every PR, under ~10 minutes. Failsafe/Gradle test sets keep them separate.
- **Changelog check:** run Liquibase against a copy of the previous release's schema in CI, so forward compatibility is tested, not assumed.
- **E2E / contract tests:** a selected set on main or before deploy.

## Quick Decision Guide

| Situation | Reflex |
|-----------|--------|
| New business rule | Plain unit test, one assertion per branch |
| New repository query | `@DataJpaTest` + Testcontainers, assert results and statement count |
| New endpoint | `@WebMvcTest` for contract + security; integration test for the use case |
| New changeset | Runs in every integration test; add a test for the constraint it adds |
| First integration test in a module | [Check the build](#choose-the-infrastructure-from-the-project): Testcontainers if present, otherwise `@EmbeddedKafka` for Kafka |
| New `@KafkaListener` | Integration test on Testcontainers Kafka, or `@EmbeddedKafka` if the project has no Testcontainers: process, redeliver, poison → DLT |
| New Kafka producer or outbox publisher | Read the record back with a test consumer on the same broker: topic, key, headers, payload |
| Project uses Testcontainers, Docker unavailable | Report it; no H2, no switch to `@EmbeddedKafka` |
| Outbound client | WireMock: 200, 4xx, 5xx, timeout, retry with the same idempotency key |
| Bug fix | Failing test first |
| Tempted to mock the repository | Write the DB test instead |
| Flaky test | Fix or delete today |

## See also

- [[debugging-discipline]] for the bug-first investigation
- [[jpa-and-transactions]] for transaction behavior worth pinning
- [[idempotency-and-side-effects]] for replay scenarios
- [[query-discipline]] for query-count assertions

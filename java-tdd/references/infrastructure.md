# Infrastructure and test level

**Open when:** you write the first integration test in a task or are unsure at which level to test. Details — the `testing-with-discernment` skill; this file is the minimum in case it is missing.

## Choosing the infrastructure

Before the first integration test look at what the build already has. The project decides, not habit and not what happens to be running on the machine. Details — `testing-with-discernment`.

```bash
grep -rnE 'org\.testcontainers|spring-boot-testcontainers|spring-kafka-test' \
  --include=pom.xml --include='*.gradle' --include='*.gradle.kts' --include='*.toml' \
  --exclude-dir=target --exclude-dir=build .
grep -rlE '@Testcontainers|@ServiceConnection|@EmbeddedKafka|@AutoConfigureTestDatabase' \
  --include='*.java' --include='*.kt' --exclude-dir=target --exclude-dir=build .
grep -rnE 'h2database|hsqldb|embedded-database|zonky|spring\.datasource\.url' \
  --include=pom.xml --include='*.gradle*' --include='application*.yml' --include='application*.properties' \
  --exclude-dir=target --exclude-dir=build .
```

No particular infrastructure is required: the new test runs on what the existing tests use.

| The tests use | DB | Kafka |
|---|---|---|
| Testcontainers (any `org.testcontainers` artifact or `spring-boot-testcontainers`) | Testcontainers + `@ServiceConnection` | Testcontainers Kafka + `@ServiceConnection`; no `org.testcontainers:kafka` module — add it with the same version as the rest |
| A database started another way (a server from the test config, an embedded Postgres) | That database, configured like the existing tests | — |
| H2 / HSQLDB | The same in-memory database; a behavior that depends on Postgres (jsonb, `SKIP LOCKED`, constraints) — name it in the report as not checked | — |
| `@EmbeddedKafka` | — | `@EmbeddedKafka` |
| Nothing yet | Ask the user | Ask the user; `@EmbeddedKafka` (`spring-kafka-test`, no Docker) is the light option to offer |

- Look at the module you write the test in together with the parent pom / convention plugin. A setup in a neighboring module counts too: add it with the same version.
- The machine does not pick the infrastructure. The project's tests need Docker or a server that is unavailable here — tell the user and name the tests that did not run; do not move the test to another database or broker for a green run.
- There is a base class, a `@TestConfiguration` with containers or a meta-annotation with `@EmbeddedKafka` — write the test on them instead of creating a second setup: that would be a second Spring context and a second broker.
- Do not migrate existing tests from one option to another as part of someone else's task.
- Name an added test dependency in the report.

## Test level — the minimal table

Details — `testing-with-discernment`. If it is missing:

| Behavior | Level |
|---|---|
| Business rule, calculation, state machine, value object | JUnit 5 + AssertJ, no Spring |
| Query, mapping, constraint, migration | `@DataJpaTest` on the project's test database (`@AutoConfigureTestDatabase(replace = NONE)` for a container or a server) |
| HTTP contract: status, body, validation, security | `@WebMvcTest` + `MockMvc`/`MockMvcTester` |
| The whole scenario: transactions, outbox, listeners | `@SpringBootTest` on the project's test database and broker |
| `@KafkaListener`, producer | `@SpringBootTest` + a broker per the infrastructure choice above, `auto-offset-reset=earliest`, Awaitility on an observable result (a DB row, a record in an outgoing topic or DLT) |
| Outgoing HTTP | WireMock at the HTTP boundary |
| Async | Awaitility on an observable result, not `Thread.sleep` |
| Time | an injected `Clock`, `Clock.fixed(...)` in the test |

# Infrastructure and test level

**Open when:** you write the first integration test in a task or are unsure at which level to test. Details — the `testing-with-discernment` skill; this file is the minimum in case it is missing.

## Choosing the infrastructure

Before the first integration test look at what the build already has. The project decides, not habit and not what happens to be running on the machine. Details — `testing-with-discernment`.

```bash
grep -rnE 'org\.testcontainers|spring-boot-testcontainers|spring-kafka-test' \
  --include=pom.xml --include='*.gradle' --include='*.gradle.kts' --include='*.toml' \
  --exclude-dir=target --exclude-dir=build .
grep -rlE '@Testcontainers|@ServiceConnection|@EmbeddedKafka' \
  --include='*.java' --include='*.kt' --exclude-dir=target --exclude-dir=build .
```

| In the build | DB | Kafka |
|---|---|---|
| Testcontainers present (any `org.testcontainers` artifact or `spring-boot-testcontainers`) | Testcontainers Postgres + `@ServiceConnection` | Testcontainers Kafka + `@ServiceConnection`; no `org.testcontainers:kafka` module — add it with the same version as the rest |
| No Testcontainers | The same engine as production, the way the project already starts it in tests. No such way — ask the user before adding Testcontainers. Not H2 | `@EmbeddedKafka` from `spring-kafka-test` (test scope, version from the Spring Boot BOM; no dependency — add it) |

- Look at the module you write the test in together with the parent pom / convention plugin. Testcontainers in a neighboring module counts too: add it with the same version.
- No Docker is not "no Testcontainers". The project uses Testcontainers and Docker is unavailable — tell the user; do not rewrite the test to `@EmbeddedKafka` or H2 for a green run.
- There is a base class, a `@TestConfiguration` with containers or a meta-annotation with `@EmbeddedKafka` — write the test on them instead of creating a second setup: that would be a second Spring context and a second broker.
- Do not migrate existing tests from one option to another as part of someone else's task.
- Name an added test dependency in the report.

## Test level — the minimal table

Details — `testing-with-discernment`. If it is missing:

| Behavior | Level |
|---|---|
| Business rule, calculation, state machine, value object | JUnit 5 + AssertJ, no Spring |
| Query, mapping, constraint, migration | `@DataJpaTest` + `@AutoConfigureTestDatabase(replace = NONE)` + Testcontainers Postgres |
| HTTP contract: status, body, validation, security | `@WebMvcTest` + `MockMvc`/`MockMvcTester` |
| The whole scenario: transactions, outbox, listeners | `@SpringBootTest` + Testcontainers; Kafka without Testcontainers in the project — `@EmbeddedKafka` |
| `@KafkaListener`, producer | `@SpringBootTest` + a broker per the infrastructure choice above, `auto-offset-reset=earliest`, Awaitility on an observable result (a DB row, a record in an outgoing topic or DLT) |
| Outgoing HTTP | WireMock at the HTTP boundary |
| Async | Awaitility on an observable result, not `Thread.sleep` |
| Time | an injected `Clock`, `Clock.fixed(...)` in the test |

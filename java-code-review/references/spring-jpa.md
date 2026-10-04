# Spring and JPA/Hibernate

## Transactions
- **Self-invocation**: calling a `@Transactional`/`@Async`/`@Cacheable`/`@Retryable` method from the same class bypasses the proxy — the annotation does not work.
- `@Transactional` on `private`/`final` methods or a `final` class — not proxied.
- By default rollback happens only for `RuntimeException` and `Error`: a checked exception commits the transaction unless there is `rollbackFor`.
- An exception caught and swallowed inside a transaction after an `UnexpectedRollbackException` from a nested `REQUIRED` call.
- External calls (HTTP, Kafka, mail) inside a transaction: long-held locks, and the event goes out even if the transaction later rolls back. Look for `@TransactionalEventListener(phase = AFTER_COMMIT)` or an outbox.
- `readOnly = true` on methods that write; no transaction on a method that makes several related writes.
- `REQUIRES_NEW` in a loop or with the same resource the outer transaction holds (deadlock, pool exhaustion).

## JPA / Hibernate
- **N+1**: iterating a lazy collection in a loop or in a DTO mapper. A `JOIN FETCH`, `@EntityGraph` or projection is needed.
- `LazyInitializationException`: accessing a lazy association outside a transaction (in the controller, after returning from the service, in `toString`/Jackson). `spring.jpa.open-in-view=true` masks it — check whether the code relies on OSIV.
- `FetchType.EAGER` on `@OneToMany`/`@ManyToMany`; `@ManyToOne` is EAGER by default.
- `JOIN FETCH` of a collection + pagination → pagination in memory (warning HHH90003004).
- An entity returned from REST directly instead of a DTO (leaking fields, recursion, lazy loads).
- A change to a managed entity is written even without `save` (dirty checking) — unintended updates; and conversely, expecting that `save` of a detached entity will not overwrite fields.
- `saveAll`/`deleteAll` one row at a time on large volumes; no batch settings for bulk inserts; `IDENTITY` disables batch insert.
- No `@Version` where concurrent updates are possible (lost updates); pessimistic locks without a timeout.
- Native queries and JPQL built by string concatenation (see security.md).
- Entity `equals`/`hashCode` — see java-core.md.

## Migrations (Flyway / Liquibase)
- An already applied migration script was changed (breaks the checksum on environments).
- A `NOT NULL` column without a default on an existing table; renaming/dropping a column that a still-running old version of the application reads (expand/contract is needed).
- An index on a big table without `CONCURRENTLY` (PostgreSQL) — writes are blocked.
- Entity changes without a matching migration (or `ddl-auto=update` in production).

## Beans and configuration
- Field injection (`@Autowired` on a field) where the project requires constructor injection; circular dependencies.
- Mutable state in a singleton (see java-core.md); a prototype bean injected into a singleton, expected to be "new" every time.
- `@Value` without a default for optional properties; a new property not added to `application.yml`/profiles; secrets in `application.yml` in the repository.
- `@ConfigurationProperties` without `@Validated` when the values are critical.
- `@Scheduled` on several instances without a distributed lock (ShedLock) — the job runs N times.
- A synchronous `@EventListener` that throws — rolls back the publisher's transaction.

## Web / REST
- No `@Valid` on `@RequestBody` although the DTO is annotated with constraints; validating nested objects without `@Valid` on the field.
- Wrong response codes (200 on create instead of 201, 500 instead of 4xx for client errors); exceptions without a mapping in `@ControllerAdvice`.
- A breaking contract change: renaming/removing a DTO field, a type change, a new required request field, a changed date format, an enum without handling of unknown values on the consumer side.
- Pagination without an upper bound on page size; endpoints that return the whole table.
- `RestTemplate`/`WebClient` without timeouts; retries of non-idempotent operations.

## Cache
- `@Cacheable` with a key that does not include all parameters affecting the result (including the user/tenant).
- Caching mutable objects or JPA entities; no invalidation on write.

## Spring Boot 2 → 3
- Mixing `javax.*` and `jakarta.*`; the deprecated `WebSecurityConfigurerAdapter`; `spring.factories` → `AutoConfiguration.imports` changes.

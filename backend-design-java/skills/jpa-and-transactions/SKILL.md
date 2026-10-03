---
name: jpa-and-transactions
description: Use whenever writing or reviewing a JPA entity, a Spring Data repository, a @Transactional service method, or anything that touches Hibernate's persistence context (lazy loading, dirty checking, flush, locking, IDs). Catches proxy pitfalls, OSIV, EAGER fetching, broken equals/hashCode, lost updates and pool-exhausting propagation BEFORE they ship. Triggers also on "сущность", "entity", "@Transactional", "транзакция", "LazyInitializationException", "Hibernate", "JPA", "репозиторий".
---

# JPA And Transactions

Hibernate makes the database look like a heap of objects. It is not one. Every getter can be a query, every setter can be an UPDATE, and every `@Transactional` is a proxy with rules. The senior reflex is to know which SQL runs and which connection it holds, at every line.

## The Discipline

For every service method that touches entities, answer:

1. **Where is the transaction boundary?** One public service method per use case. Never the controller, never the repository alone for multi-step work.
2. **Which SQL runs?** Loads, lazy loads, the flush at commit. If you do not know, turn on SQL logging and look.
3. **How long is the connection held?** From the first query to commit. Nothing slow belongs inside: no HTTP, no broker, no file I/O.
4. **What happens under concurrency?** Two requests modify the same aggregate. Pick `@Version`, `SELECT ... FOR UPDATE`, or a constraint that rejects the loser.

## @Transactional Is A Proxy

These are the rules that silently turn a transaction off or change its meaning:

- **Self-invocation bypasses the proxy.** `this.save()` from inside the same bean runs with no transaction and no new propagation. Move the method to another bean, or restructure.
- **`private` methods are never intercepted.** `final` methods and classes are not intercepted under CGLIB either.
- **Checked exceptions commit by default.** Only `RuntimeException` and `Error` roll back. Use `rollbackFor = Exception.class`, or prefer unchecked domain exceptions.
- **A swallowed inner failure still dooms the outer transaction.** An inner `REQUIRED` method throws, gets marked rollback-only, and the caller catches. The commit then throws `UnexpectedRollbackException`. Either let it propagate or give the inner work its own transaction on purpose.
- **`REQUIRES_NEW` takes a second connection** while the outer one is held. With N request threads and a pool of N, every thread holds one connection and waits for a second: the pool deadlocks and requests time out after `connection-timeout`. Use it only from non-transactional callers or for short audit writes, and size the pool for it.
- **`@Async` and new threads lose the transaction** and the `SecurityContext`. Pass ids, not entities, to async work.
- **`readOnly = true`** sets Hibernate flush mode to manual and lets the driver route to replicas. It does not stop a native `UPDATE`. Use it on every read path.

## Open Session In View: Off

Boot defaults to `spring.jpa.open-in-view=true` and logs a warning. OSIV keeps the session and its DB connection open for the whole HTTP request, including JSON serialization. That has two effects: lazy N+1 hides inside Jackson, and the connection is held while the client reads slowly. Set it to `false`. Then each endpoint fetches what it needs inside the service, and a `LazyInitializationException` becomes a design signal, not a bug to patch with `@Transactional` on the controller or `FetchType.EAGER`.

## Entity Mapping Hygiene

- **All `@ManyToOne` / `@OneToOne` are `fetch = LAZY`.** The JPA default for to-one is EAGER. EAGER fires one extra SELECT per row for every JPQL query, even ones that never touch the association, and cannot be switched off per query.
- **Never `FetchType.EAGER` on collections.** Fetch per use case with `JOIN FETCH`, `@EntityGraph`, or a DTO projection.
- **`@Enumerated(EnumType.STRING)`**, plus a CHECK constraint in the changelog. The default ORDINAL corrupts data when someone reorders constants.
- **No Lombok `@Data`, `@EqualsAndHashCode` or `@ToString` on entities.** `hashCode` over mutable fields breaks `Set`s after persist. `toString` walks lazy associations, which causes extra queries, recursion, or `LazyInitializationException` inside a log line. Write `equals` on the id with a constant `hashCode` (`getClass().hashCode()`), or on an immutable natural key.
- **Collections:** use `Set` for `@ManyToMany`. Two `List` bags fetched together throw `MultipleBagFetchException`. Keep both sides of a bidirectional association in sync with helper methods.
- **Cascades:** `CascadeType.ALL` / `REMOVE` only from aggregate root to owned children. Never on `@ManyToOne`, where deleting a line would delete the customer. `orphanRemoval = true` means "removing from the collection deletes the row". Choose it consciously.
- **Types match the changelog:** `BigDecimal` ↔ `numeric(p,s)`, `Instant`/`OffsetDateTime` ↔ `timestamptz` with `hibernate.jdbc.time_zone=UTC`, `UUID` ↔ `uuid`, JSON via `@JdbcTypeCode(SqlTypes.JSON)` ↔ `jsonb`. `ddl-auto=validate` in an integration test catches mismatches.
- **`@Column(nullable = false, length = 50)`** is documentation for Hibernate. The constraint exists only if the changeset creates it.

## IDs

- **SEQUENCE, not IDENTITY**, when insert volume matters. IDENTITY disables JDBC batch inserts. Use a pooled `@SequenceGenerator` whose `allocationSize` equals the sequence's `INCREMENT BY` in the changelog; a mismatch gives duplicate keys or a startup failure.
- **Public ids are UUIDv7** in their own unique column, or as the PK. Generate them in the app (a UUIDv7 library, or Hibernate's v7 generator if your version has one) or with `uuidv7()` on PostgreSQL 18+. Never expose sequential ids in URLs.
- **`getReferenceById(id)`** sets a FK without loading the parent row.

## The Persistence Context

- **Dirty checking writes without `save()`.** Any change to a managed entity inside a read-write transaction is flushed at commit, including the "temporary" one you made for display. Map to DTOs before mutating for presentation.
- **`save()` on a new entity with an assigned id does `merge()`**, which means a SELECT first. Implement `Persistable#isNew` or let the DB generate ids.
- **Bulk `@Modifying` queries bypass the context.** Use `clearAutomatically = true`, or managed entities keep stale state.
- **Batching needs config:** `hibernate.jdbc.batch_size=50`, `order_inserts=true`, `order_updates=true`, and not IDENTITY.
- **Long loops over entities** grow the first-level cache without limit. Process in chunks, `flush()` + `clear()` per chunk, or use a stream with a fetch size.

## Concurrency

- **Lost update is the default.** Two users load, both save, and the last write wins silently. Add `@Version` on aggregates edited concurrently and map `ObjectOptimisticLockingFailureException` to `409 CONFLICT`.
- **Pessimistic:** `@Lock(PESSIMISTIC_WRITE)` gives `SELECT ... FOR UPDATE`. Always set `jakarta.persistence.lock.timeout`. For work queues use `FOR UPDATE SKIP LOCKED` (a native query, or lock timeout hint `-2` in Hibernate).
- **Invariants across rows** (unique email, one active subscription) are DB constraints. A `existsBy...` check followed by an insert is a race. Catch `DataIntegrityViolationException` and map the constraint name to a stable error code.

## Anti-Patterns

- **`@Transactional` on the controller** to "fix" `LazyInitializationException`. It widens the connection hold to the whole request.
- **Entities as API DTOs.** Mass assignment, lazy-load serialization, and schema leaks into the contract. Use request and response records.
- **`findAll()` then filter in Java.** Push the predicate to the query.
- **`FetchType.EAGER` as a fix for N+1.** It moves the N+1 everywhere.
- **Catching `Exception` inside `@Transactional`** and returning normally. You get either a commit of half the work, or `UnexpectedRollbackException` far from the cause.
- **Calling a remote API between `findById` and commit.** The connection and row locks are held for the remote's p99.

## Quick Decision Guide

| Question | Default | Deviate when |
|----------|---------|--------------|
| Transaction boundary | Public service method per use case | Never controller-wide |
| Read path | `@Transactional(readOnly = true)` + projection | Single PK lookup in a write flow |
| OSIV | `false` | Never in an API service |
| To-one fetch | `LAZY` | Never EAGER |
| Enum mapping | `STRING` + CHECK | Postgres enum type, mapped explicitly |
| ID strategy | SEQUENCE pooled, plus UUIDv7 public id | Low-volume table: IDENTITY is acceptable |
| Concurrent edits | `@Version` → 409 | Hot counters: atomic `UPDATE ... SET x = x + 1` |
| Propagation | `REQUIRED` | `REQUIRES_NEW` only for short independent writes |

## See also

- [[query-discipline]] for fetch plans, N+1 and pagination
- [[migration-safety]] for the changeset behind every mapping change
- [[idempotency-and-side-effects]] for what must not happen inside a transaction
- [[performance-and-scaling]] for pool sizing
- [[error-handling-as-design]] for mapping persistence exceptions to error codes

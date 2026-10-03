---
name: query-discipline
description: Use when writing, reviewing, or generating any database access in a Spring/Hibernate service (Spring Data derived query, @Query JPQL or native SQL, Criteria, JdbcTemplate/JdbcClient, jOOQ). Catches N+1, EAGER fan-out, unbounded lists, in-memory pagination and missing indexes BEFORE the query reaches production. Triggers also on "запрос", "N+1", "медленный запрос", "индекс", "пагинация", "репозиторий", "JOIN FETCH", "EntityGraph".
---

# Query Discipline (Hibernate + PostgreSQL)

Most "the service is slow" stories are "the data access is slow". With Hibernate the query is hidden behind a getter, so the discipline starts with seeing the SQL at all.

## The Discipline

For any non-trivial data access, before it ships:

1. **See the SQL.** `logging.level.org.hibernate.SQL=debug` plus `org.hibernate.orm.jdbc.bind=trace` locally, or datasource-proxy / p6spy. Count the statements per request, not just the time.
2. **Read the plan.** `EXPLAIN (ANALYZE, BUFFERS)` on realistic volume, with the real parameter values.
3. **Bound the result.** Every list query has a limit: `Pageable`, `Limit`, `Top50`, or keyset `Window`.
4. **Suspect N+1.** Any loop, stream, mapper or Jackson serialization over entities is N+1 until the SQL log says otherwise.
5. **Fetch what the use case needs**: a projection for reads, the aggregate for writes.

## Where N+1 Hides In Spring

```java
// One SELECT for orders, then one per order for customer (LAZY), or for every
// order in the query regardless (EAGER @ManyToOne, the JPA default).
List<Order> orders = orderRepository.findByStatus(PENDING);
return orders.stream().map(o -> new OrderView(o.getId(), o.getCustomer().getName())).toList();
```

Fixes, best first:

```java
// 1. DTO projection: one query, only the needed columns, nothing managed.
@Query("select new com.acme.OrderView(o.id, c.name) from Order o join o.customer c where o.status = :s")
List<OrderView> findViews(@Param("s") Status s, Pageable page);

// 2. Fetch plan per use case.
@EntityGraph(attributePaths = "customer")
List<Order> findByStatus(Status s, Pageable page);
```

Safety net, not a fix: `hibernate.default_batch_fetch_size=50` turns N lazy loads into N/50 `IN (...)` queries.

The usual hiding places:

- **EAGER to-one**: an extra SELECT per row on every JPQL query. Make all to-one associations LAZY.
- **Mappers** (MapStruct, hand-written) that touch `getLines()` or `getCustomer()`.
- **Jackson serializing entities**, made worse by OSIV. Return DTOs.
- **`repository.findById` inside a loop.** Use `findAllById(ids)` and build a map.
- **`saveAll` with IDENTITY ids**: N single-row inserts. Use SEQUENCE plus `jdbc.batch_size`.
- **`@Formula` and `@Where`** on collections, which add a subquery per row.

## Pagination

Default: **keyset (cursor) pagination.**

```java
// Spring Data 3.1+: Window + ScrollPosition, ordered by a unique key
Window<OrderView> page = repo.findFirst50ByTenantIdOrderByCreatedAtDescIdDesc(
        tenantId, ScrollPosition.keyset());   // pass window.positionAt(last) for the next page
```

or plain SQL:

```sql
SELECT id, created_at, total FROM orders
WHERE tenant_id = :t AND (created_at, id) < (:lastCreatedAt, :lastId)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

- **`Page<T>` runs a second `count(*)` query** on every request. On a large table that count is often slower than the page. Use `Slice<T>` or `Window<T>` unless the UI really shows "page 7 of 1,234".
- **`OFFSET` pagination** is acceptable for small, admin-only lists. `OFFSET 100000` reads and discards 100k rows.
- **`JOIN FETCH` of a collection plus a `Pageable`** makes Hibernate fetch all rows and paginate in memory (warning `HHH90003004`). Set `hibernate.query.fail_on_pagination_over_collection_fetch=true` so this fails in tests. Fix it in two steps: page the ids, then fetch the entities with their collections by those ids.
- **Cap the page size**: `spring.data.web.pageable.max-page-size`. The default is 2000.

## Indexes Match Queries

- A composite index `(tenant_id, status, created_at)` serves `WHERE tenant_id = ? AND status = ? ORDER BY created_at`. It does not serve `WHERE status = ?` alone.
- Every FK column gets an index. Postgres does not create one, and a `DELETE` on the parent then scans the child.
- Use partial indexes for hot constant filters: `... WHERE status = 'PENDING'`.
- Case-insensitive lookups (`findByEmailIgnoreCase` generates `upper(email) = upper(?)`) need an index on that expression, or a `citext` column.
- `findByNameContaining` becomes `LIKE '%x%'`, which no btree serves. Use `pg_trgm` GIN or full-text search.
- New indexes ship via [[migration-safety]]: `CONCURRENTLY`, alone, `runInTransaction:false`.

## Plans Under pgjdbc

- pgjdbc switches to server-side prepared statements after 5 executions (`prepareThreshold`). Postgres may then use a **generic plan** that ignores the actual parameter values. An `EXPLAIN` with literals can look fine while production is slow on skewed data (one huge tenant). Check with `EXPLAIN (GENERIC_PLAN)` on PG16+, or `plan_cache_mode`.
- `IN (:ids)` with varying list sizes creates a new statement per size. Set `hibernate.query.in_clause_parameter_padding=true`. For thousands of ids, use `= ANY(:array)` or a join against `VALUES`/`unnest`.

## Transactions And Reads

- Read paths use `@Transactional(readOnly = true)` with projections, so no dirty checking and no snapshot copies.
- Large exports use `Stream<T>` with `@QueryHints(@QueryHint(name = HINT_FETCH_SIZE, value = "500"))` inside a read-only transaction, or `JdbcClient`. Never `findAll()` into a `List`.
- For read-modify-write, decide between `@Version` and `FOR UPDATE` at design time. See [[jpa-and-transactions]].
- Reports run against a read replica or a snapshot, not as a 10-minute transaction on the primary.

## Anti-Patterns

- **`findAll()` + `stream().filter()`.** The database filters; Java does not.
- **`count()` for "does it exist".** Use `existsBy...`, which becomes `SELECT 1 ... LIMIT 1`.
- **Derived method names with six conditions.** Write `@Query`; a name is not a query plan.
- **`DISTINCT` to hide a duplicating join fetch.** Fix the fetch plan.
- **Native queries scattered in services.** Keep them in the repository, parameterized, and covered by an integration test against real Postgres.
- **Testing queries on H2.** The plan, the types and the SQL dialect all differ. Use Testcontainers Postgres.

## Quick Decision Guide

| Question | Default | Deviate when |
|----------|---------|--------------|
| Read endpoint shape | DTO projection, read-only tx | Write flow needs the aggregate |
| Associations needed | `@EntityGraph` / `JOIN FETCH` per query | Never EAGER mapping |
| Pagination | Keyset (`Window`) or `Slice` | Small admin list → `Page`/offset |
| Collection fetch + paging | Ids page, then fetch | Never in-memory paging |
| Lazy-load safety net | `default_batch_fetch_size=50` | Not a substitute for a fetch plan |
| Batch writes | SEQUENCE + `jdbc.batch_size` | Low volume |
| Query verification | SQL log + statement-count assert in an integration test | Trivial PK lookup |

## See also

- [[jpa-and-transactions]] for fetch types, persistence context and locking
- [[data-modeling-discipline]] for the schema these queries read
- [[migration-safety]] for shipping indexes
- [[performance-and-scaling]] for pool and plan-cache effects

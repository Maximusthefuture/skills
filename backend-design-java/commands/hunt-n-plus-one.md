---
description: Scan a Spring Boot / Hibernate codebase for N+1 query patterns (EAGER to-one, lazy access in loops/mappers/Jackson, findById in loops, collection fetch + pagination, row-by-row saves) and propose fixes with JOIN FETCH, @EntityGraph, projections or batching.
argument-hint: Path to a file, package or module to scan (defaults to src/main/java)
disable-model-invocation: false
---

# Hunt N+1 (Hibernate / Spring Data)

You are scanning for the most common shipped-to-production performance bug: queries whose count grows with the number of rows.

Input: $ARGUMENTS (default: `src/main/java`)

## What You Look For

In increasing subtlety:

1. **The literal loop.** `for (var o : orders) { customerRepository.findById(o.getCustomerId()) ... }`, or `ids.stream().map(repo::findById)`.
2. **Lazy access in a loop.** `order.getCustomer().getName()` or `order.getLines().size()` inside a loop or stream over entities loaded without a fetch plan.
3. **EAGER to-one.** `@ManyToOne` / `@OneToOne` without `fetch = LAZY` is EAGER by default: every JPQL/derived query on that entity fires one extra SELECT per row, even when nothing touches the association. Grep all entities.
4. **Mappers and serializers.** MapStruct/hand-written mappers, `toDto()` methods, Jackson serializing entities (worse with `open-in-view=true`), entity `toString()` in logs.
5. **Collection fetch + pagination.** `JOIN FETCH`/`@EntityGraph` of a collection combined with `Pageable` makes Hibernate paginate in memory (HHH90003004). That is not N+1, but it is the same class of disaster.
6. **Row-by-row writes.** `saveAll` / `save` in a loop with `GenerationType.IDENTITY` or no `hibernate.jdbc.batch_size`: N INSERTs. `deleteAll(iterable)` loads and deletes one by one; use `deleteAllInBatch` or a bulk `@Modifying` query.
7. **Hidden queries.** `@Formula`, `@ElementCollection` without a fetch plan, `size()` on lazy collections, which initializes the whole collection (use a count query or a projection), `existsBy` inside loops.
8. **Remote fan-out.** The same pattern against another service: `RestClient` called per row instead of a batch endpoint.

## How You Scan

1. **Glob entities first.** `grep -rn "@ManyToOne\|@OneToOne\|FetchType.EAGER" --include=*.java`. List the to-one associations not marked LAZY; each is a finding.
2. **Find loops near repositories.** Grep for `for (`, `.forEach(`, `.stream()` / `.map(` in services, mappers and controllers. Read the bodies for repository calls or getters of associations.
3. **Check the fetch plan of the source query.** For each loop over entities, find the repository method that loaded them: does it have `JOIN FETCH`, `@EntityGraph`, or return a projection that already has the data?
4. **Check config.** `spring.jpa.open-in-view`, `hibernate.default_batch_fetch_size`, `hibernate.jdbc.batch_size`, `order_inserts`, `hibernate.query.fail_on_pagination_over_collection_fetch`.
5. **Check controllers returning entities**, which serialize lazy graphs.

## How You Respond

```
## N+1 Scan: <path>

### High confidence (likely N+1)
- **file:line** <one-line description>
  - Pattern: <what you saw: the loop, the getter, the loading query at file:line>
  - Suggested fix: <projection / @EntityGraph / JOIN FETCH / findAllById + map / batch>, 5–8 line snippet

### Medium confidence (verify)
- **file:line** <description>
  - Reason for uncertainty: <one line>
  - How to verify: <see below>

### Low confidence (suspicious shape)
- **file:line** <description>

### Mapping-level findings
- <EAGER to-one / missing batch config / OSIV on>, with the exact annotation or property fix

### Verification notes
<How to confirm in this project: `logging.level.org.hibernate.SQL=debug` and count statements for one request; `spring.jpa.properties.hibernate.generate_statistics=true`; an integration test (Testcontainers) asserting the statement count with Hypersistence Utils `SQLStatementCountValidator` or datasource-proxy `QueryCountHolder`, so the fix cannot regress.>
```

## Fix Preferences

1. **DTO projection** (`select new ...View(...)`, interface projection, or a record via `JdbcClient`) for read paths: one query, no managed entities.
2. **`@EntityGraph(attributePaths = ...)` / `JOIN FETCH`** on the specific repository method when the use case needs entities.
3. **`findAllById(ids)` + `Map`** instead of `findById` in a loop.
4. **`hibernate.default_batch_fetch_size=50`** as a global safety net, not as the fix.
5. **Never `FetchType.EAGER`** as the fix: it moves the N+1 to every query.

For collection fetch + pagination: page the ids first (`select o.id from Order o where ... order by ...` with `Pageable`), then `select distinct o from Order o join fetch o.lines where o.id in :ids`.

## Rules

- **Cite file and line** for both the loop and the query that loaded the data.
- **Snippet the fix in Java**, matching the project's style (Spring Data interface, `@Query`, Criteria, jOOQ).
- **High confidence** needs a visible loop plus a visible per-row query or lazy getter on entities loaded without a fetch plan, or an EAGER to-one on a queried entity.
- **Always give the verification path.** Do not claim the fix works without a statement count.
- **No architectural rewrites.** Fix in place.

## What To Skip

- Loops over DTOs or projections (no lazy loading possible).
- Per-row writes where N is small and bounded (e.g., at most 5 lines).
- One-shot admin tasks where N is small and known.

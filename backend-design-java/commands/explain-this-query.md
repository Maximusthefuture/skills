---
description: Analyze a PostgreSQL query — native SQL, JPQL/HQL @Query, Spring Data derived method, Criteria, JdbcClient — for its likely execution plan, missing indexes, fetch-plan and pagination risks BEFORE it ships. Predicts EXPLAIN-style output and flags concerns.
argument-hint: SQL / JPQL, a repository method name, or path to the repository file
disable-model-invocation: false
---

# Explain This Query

You are analyzing a query before it ships. The user wants to know what it will look like when the database runs it on a non-trivial dataset.

Input: $ARGUMENTS

## Step 1: Normalize the query

If the input is not SQL, translate it to the SQL Hibernate 6 will generate, and say so:

- **Derived method** (`findTop20ByTenantIdAndStatusOrderByCreatedAtDesc`): spell out the WHERE/ORDER BY/LIMIT. `IgnoreCase` becomes `upper(col) = upper(?)`, `Containing` becomes `like '%?%'`, `In` becomes `in (...)`.
- **`Page<T>` return type**: there is also a `select count(...)` query. Analyze it too; it is often the slow one.
- **JPQL with `JOIN FETCH` / `@EntityGraph`**: list the joins. If a collection is fetched together with a `Pageable`, flag in-memory pagination (HHH90003004).
- **EAGER to-one on the selected entity**: each one adds a join, or a secondary SELECT per row.
- **Entity vs projection**: entity queries select every mapped column, so a covering index will not help. Suggest a projection when relevant.

If the input is a path, read the repository and the entity (for column names and mappings) and locate the query. To see the real SQL, the user can set `logging.level.org.hibernate.SQL=debug` and `logging.level.org.hibernate.orm.jdbc.bind=trace`.

State the SQL clearly before analysis. If the user can run `EXPLAIN (ANALYZE, BUFFERS)` on realistic data, that always beats your prediction. Suggest it.

## Step 2: Predict the plan

For each table referenced, identify:

- The filter predicates (`WHERE ...`).
- The join predicates.
- The ordering (`ORDER BY`).
- The limit (`LIMIT ...`).

For each, ask: is there an index that the planner can use? Is the column on the left side of the operator (so the index can serve it)? Is the leading column of a composite index used?

Predict:

- **Access path**: Index Scan / Bitmap Index Scan / Seq Scan / Index-Only Scan / Parallel Seq Scan.
- **Join order**: smallest filtered set first.
- **Sort step**: in-memory sort, or sort-to-disk.
- **Row counts**: rough order of magnitude expected, if known.

## Step 3: Report

```
## Query Analysis

### The query (normalized)
```sql
<SQL>
```

### Tables referenced
| Table | Filters | Joins | Ordering | Expected access path | Index match |
|-------|---------|-------|----------|---------------------|-------------|
| ...   | ...     | ...   | ...      | ...                 | ...         |

### Predicted plan, in narrative
<one paragraph: what the planner is likely to do, in plain language>

### Risks
- <missing index, with the Liquibase changeset: `--changeset <author>:<id> runInTransaction:false` + `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` + `--rollback DROP INDEX CONCURRENTLY IF EXISTS ...`>
- <unbounded sort, with the index that would fix it>
- <Seq Scan on a table that will grow, with size threshold>
- <N+1 if the surrounding code calls this in a loop>
- <pagination style if relevant: keyset (`Window`/`ScrollPosition`) or `Slice` over `Page` + count over offset>
- <generic-plan risk: pgjdbc server-prepares after 5 executions; with skewed data (one huge tenant) the generic plan can differ from your literal EXPLAIN. Check with `EXPLAIN (GENERIC_PLAN)` on PG16+>
- <`IN (:ids)` with varying sizes: `hibernate.query.in_clause_parameter_padding=true`, or `= ANY(:array)` for large lists>

### Recommended next step
<one of:>
- Run `EXPLAIN (ANALYZE, BUFFERS)` on a realistic dataset and paste the output.
- Add the suggested index as its own Liquibase changeset (`CONCURRENTLY`, `runInTransaction:false`).
- Rewrite the query as: <a specific rewrite: a projection, keyset predicate, ids-then-fetch, `existsBy` instead of `count`>.

### Notes
- Postgres version assumed: <ask the user if unknown>.
- Realistic table size assumed: <ask if unknown>.
```

## Rules

- **No guesses without flags.** If table size is unknown, say "if X is over Y rows" and qualify the verdict.
- **Concrete index statements.** Give the exact changeset (`CONCURRENTLY`, the right columns and order, partial `WHERE` if a constant filter is hot).
- **Distinguish predictions from facts.** "Predicted plan" makes it clear you did not run it.
- **Push EXPLAIN.** The user running EXPLAIN ANALYZE is always better than your prediction. Say so.
- **Flag pagination shape.** If the query has `OFFSET`, recommend cursor unless the use case justifies offset.

## What To Skip

- Generic query-optimization platitudes ("avoid SELECT *"). Apply specifics to this query, or skip.
- Theoretical performance numbers. You do not have measurements; do not produce fake ones.

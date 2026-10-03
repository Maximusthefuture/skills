---
name: migration-safety
description: Use whenever writing, reviewing, or running a Liquibase changeset or any PostgreSQL schema change (formatted SQL, XML/YAML changelog, db.changelog-master, a JPA entity change that needs a migration). Every changeset is a potential incident. Catches lock-ups, checksum breakage, partial deploys and irreversible damage BEFORE the file ships. Triggers also on "миграция", "changeset", "ченджсет", "liquibase", "добавить колонку", "добавить индекс", "переименовать колонку", "изменить схему".
---

# Migration Safety (Liquibase + PostgreSQL)

A changeset is not a code change. It is an operation against the production database with real traffic, run by every pod that boots, replayed on every new environment forever. Write each one as if it runs at 9am on Monday at peak, because one of them will.

## The Discipline

Before a changeset is committed, it passes these checks:

1. **Backward compatible with the running app version.** During a rolling deploy the old pods run against the new schema. Old Hibernate mappings must still work.
2. **Immutable once shared.** Liquibase stores an MD5 checksum per changeset. Editing a changeset that ran anywhere makes that environment refuse to start (`ValidationFailedException`). Fix forward with a new changeset.
3. **Lock budget known.** Name the lock each statement takes and for how long. Anything that waits on `ACCESS EXCLUSIVE` gets a `lock_timeout`.
4. **Reversible, or the irreversibility is written down.** `--rollback` for formatted SQL, `<rollback>` for `<sql>`. "Not reversible" is allowed if the PR says so.
5. **Tested against realistic volume.** A changeset that runs in 40 ms on an empty Testcontainers DB proves syntax, not safety.

## Liquibase Mechanics That Bite

- **Every changeset is one transaction** (`runInTransaction` defaults to true). Postgres DDL is transactional, so a failing changeset rolls back cleanly. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction: put it alone in a changeset with `runInTransaction:false`, and make it `IF NOT EXISTS`, because a failed non-transactional changeset is not recorded and will re-run.
- **Prefer formatted SQL for Postgres-specific DDL.** XML/YAML change types cannot express `CONCURRENTLY`, `NOT VALID`, or `SET LOCAL lock_timeout`. Reviewers should see the SQL that runs.
- **`addNotNullConstraint` with `defaultNullValue`** issues an `UPDATE` of every NULL row and then `SET NOT NULL`, all in one transaction. That is a hidden backfill under lock.
- **The changelog lock.** Liquibase takes a row lock in `DATABASECHANGELOGLOCK`. If a pod is killed mid-migration (liveness probe, OOM, deploy timeout), the lock stays and every new pod hangs at startup with "Waiting for changelog lock". The fix is `liquibase release-locks` after verifying nothing is running. The prevention is below.
- **Running at application startup** (`spring.liquibase.enabled=true`, the Boot default) couples schema changes to pod health. A 3-minute changeset plus a 60-second startup probe gives you a killed pod, a stuck lock, and a crash loop. For anything non-trivial, run Liquibase as a separate step: a Kubernetes Job or init container, or a CI step using the CLI or Maven/Gradle plugin. The app runs with `spring.liquibase.enabled=false` and `ddl-auto=validate`.
- **`validCheckSum` and `runOnChange`** are escape hatches. `validCheckSum` hides an edited changeset (environments that ran the old body keep the old schema). Use `runOnChange` only for idempotent definitions (`CREATE OR REPLACE VIEW/FUNCTION`).
- **Contexts and labels** gate test data (`context:test`). A seed changeset without a context runs in production.
- **Hibernate `ddl-auto` stays `validate` (or `none`).** `update` changes the schema outside review, never drops anything, and makes environments drift. `validate` checks tables and column types, not constraints or indexes. Those live only in the changelog.

## The Dangerous Patterns On PostgreSQL

| Change | What actually happens | Safe form |
|--------|----------------------|-----------|
| `ADD COLUMN x NOT NULL` (no default) | Fails on a non-empty table | Add nullable, backfill, then enforce NOT NULL (below) |
| `ADD COLUMN x ... DEFAULT <constant>` | Fast on PG11+ (metadata only) | Fine |
| `ADD COLUMN ... DEFAULT gen_random_uuid()` / `clock_timestamp()` | Volatile default rewrites the whole table under ACCESS EXCLUSIVE | Add without default, backfill in batches, then `SET DEFAULT` |
| `SET NOT NULL` | Full scan under ACCESS EXCLUSIVE | PG12+: `CHECK (x IS NOT NULL) NOT VALID`, then `VALIDATE`, then `SET NOT NULL` (instant), then drop the CHECK |
| `CREATE INDEX` | Blocks writes for the whole build | `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, alone, `runInTransaction:false` |
| `ADD FOREIGN KEY` | Scans the child table, SHARE ROW EXCLUSIVE on both tables | `... NOT VALID`, then `VALIDATE CONSTRAINT` in a later changeset. Index the FK column. |
| `ADD CONSTRAINT ... CHECK` | Full scan under ACCESS EXCLUSIVE | `NOT VALID`, then `VALIDATE CONSTRAINT` |
| `ALTER COLUMN TYPE` | Usually rewrites the table and indexes (int→bigint, text→uuid) | Expand/contract. `varchar(n)` → larger or `text` is safe. |
| `RENAME COLUMN/TABLE` | Instant, but every running old pod breaks (`@Column(name=...)`) | Expand/contract over two releases |
| `DROP COLUMN` | Old pods' INSERTs and SELECTs fail; `validate` fails if still mapped | Release N drops the mapping. Release N+1 drops the column. |
| `UPDATE` / `DELETE` of many rows | One long transaction, row locks, startup blocked | Batched, restartable job outside Liquibase |

### The lock queue is the real outage

`ALTER TABLE` on a hot table waits for `ACCESS EXCLUSIVE`. It stands in the queue behind one long-running SELECT, and every query that arrives after it queues behind the ALTER. A "fast" metadata change takes the table down for as long as the slowest open transaction. Always:

```sql
--changeset alice:orders-add-note
SET LOCAL lock_timeout = '5s';
ALTER TABLE orders ADD COLUMN note text;
--rollback ALTER TABLE orders DROP COLUMN note;
```

Or set it once on the migration role: `ALTER ROLE migrator SET lock_timeout = '5s'`. The changeset then fails fast and is retried, instead of freezing production.

### NOT NULL on an existing column, without the scan

```sql
--changeset alice:inv-currency-1
ALTER TABLE invoices ADD CONSTRAINT invoices_currency_nn CHECK (currency IS NOT NULL) NOT VALID;
--changeset alice:inv-currency-2
ALTER TABLE invoices VALIDATE CONSTRAINT invoices_currency_nn;   -- SHARE UPDATE EXCLUSIVE, online
--changeset alice:inv-currency-3
SET LOCAL lock_timeout = '5s';
ALTER TABLE invoices ALTER COLUMN currency SET NOT NULL;         -- PG12+: uses the valid CHECK, no scan
ALTER TABLE invoices DROP CONSTRAINT invoices_currency_nn;
```

Each step needs its own `--rollback`, omitted here for brevity. The backfill between "add nullable" and step 1 is a job, not a changeset.

## Expand / Contract With Hibernate

Renames, type changes and splits take two or three releases:

1. **Expand.** Changeset adds the new column (nullable). The entity maps both columns and the service writes both.
2. **Backfill.** A batched job copies old to new. It is restartable and keyed by id ranges.
3. **Switch.** Reads move to the new column, and the old one becomes `@Transient` or unmapped.
4. **Contract.** A later release drops the old column, once no running version maps it.

The deprecation window catches the consumer you forgot: a reporting query, another service, a native query.

## Review Reflexes

Scan a changelog diff in this order:

1. Has any **existing** changeset changed? That blocks the merge unless it never left a local branch.
2. Does it touch a table over ~1M rows or a hot table? Then every operation is suspect until shown cheap.
3. Every `ALTER TABLE` on an existing table has a `lock_timeout`.
4. Every index is `CONCURRENTLY`, alone, `runInTransaction:false`, `IF NOT EXISTS`.
5. Every new FK is `NOT VALID` plus `VALIDATE`, and its column is indexed.
6. No backfills (`UPDATE`, `<update>`, `defaultNullValue`) on big tables.
7. A `--rollback` exists, or irreversibility is stated.
8. The entity change and the changeset agree (`ddl-auto=validate` passes in an integration test).

## Anti-Patterns

- **"It worked on staging."** Staging has 0.1% of the rows and no traffic holding locks.
- **The mega-changeset.** One changeset that adds six columns, renames two and builds an index. Write one concept per changeset.
- **Editing yesterday's changeset** because "it only ran on dev". It also ran on your colleague's machine and in CI's cached DB.
- **Liquibase as ETL.** Changesets change schema. Data reshapes are jobs with progress logs.
- **Seed data without `context`.** Test fixtures end up in production.
- **Silent default change.** A changed `DEFAULT` affects new rows only. State it in the PR.

## Quick Decision Guide

| Operation | Safe form | Risky form |
|-----------|-----------|------------|
| Add column | nullable or constant default, plus lock_timeout | NOT NULL without default; volatile default |
| Enforce NOT NULL | CHECK NOT VALID → VALIDATE → SET NOT NULL | `addNotNullConstraint` + `defaultNullValue` on a big table |
| Add index | `CONCURRENTLY IF NOT EXISTS`, alone, `runInTransaction:false` | `<createIndex>` on a hot table |
| Add FK / CHECK | `NOT VALID`, then `VALIDATE` | One-shot `ADD CONSTRAINT` |
| Rename / retype / drop | Expand/contract across releases | One-shot |
| Fix a wrong changeset | New changeset forward | Edit + `validCheckSum` |
| Run migrations | Separate Job/step, app on `validate` | On boot of every replica with tight probes |

## See also

- [[data-modeling-discipline]] for the schema the changeset creates
- [[jpa-and-transactions]] for keeping entities and changelog in sync
- [[query-discipline]] for the indexes worth building
- [[observability-by-default]] to see lock waits while it runs

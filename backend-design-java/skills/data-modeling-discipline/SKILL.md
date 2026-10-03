---
name: data-modeling-discipline
description: Use whenever creating or changing a PostgreSQL table, a JPA @Entity, or any persisted structure. Forces invariants into the schema (Liquibase changeset) instead of trusting the service layer or JPA annotations. Use this BEFORE writing the entity and the changeset. Triggers also on "новая таблица", "сущность", "схема БД", "модель данных", "entity", "@Entity", "добавить поле".
---

# Data Modeling Discipline

The schema is the contract. The Java code is the suggestion. Anything that can be wrong in the data will eventually be wrong, unless PostgreSQL refuses it. `@NotNull`, `@Column(nullable = false)` and an `if` in the service are all bypassed by the next native query, batch job, or colleague with `psql`.

## The Discipline

Before writing the entity and the changeset, answer:

1. **What is the invariant?** What must never be false in this row? For example: total >= 0, status in a fixed set, end_at > start_at, exactly one of A or B is set.
2. **Where is it enforced?** NOT NULL, UNIQUE, CHECK, FOREIGN KEY, partial unique index, exclusion constraint, generated column. All of these go in the Liquibase changeset. If the answer is "Bean Validation" or "the service checks", reconsider.
3. **What is the ownership and lifecycle?** Who creates the row, who mutates it, who deletes it. What states exist, and which transitions are legal.
4. **Will this query well in 18 months?** At 100x the rows, with the access paths you expect.

## Postgres Types ↔ Java Types

| Data | Postgres | Java / Hibernate |
|------|----------|------------------|
| Money | `numeric(19,4)` or `bigint` minor units | `BigDecimal` / `long`. Never `double` or `float`. |
| Point in time | `timestamptz` | `Instant` / `OffsetDateTime`, with `hibernate.jdbc.time_zone=UTC` |
| Calendar date | `date` | `LocalDate` |
| Free text | `text` (CHECK on length if there is a real limit) | `String` |
| Fixed set | `text` + `CHECK (status IN (...))`, or a Postgres enum | `@Enumerated(EnumType.STRING)` |
| Public id | `uuid` (v7) | `UUID` |
| Internal id | `bigint` from a sequence | `Long` + `@SequenceGenerator` |
| Free-form payload | `jsonb` | `@JdbcTypeCode(SqlTypes.JSON)` to a record/Map |
| Flags that grow | a state column, not booleans | enum |

`varchar(255)` is a JPA default, not a decision. `@Column` without `length` plus an auto-generated DDL gives you exactly that. Write the DDL yourself in the changeset.

## Reflexes

**NOT NULL is the default.** Every column is NOT NULL unless absence has a distinct meaning. "Not set yet" is a state, not a NULL. The entity mirrors it: a non-null primitive or a field set in the constructor, and `optional = false` on mandatory `@ManyToOne`.

**Foreign keys are mandatory, with an explicit `ON DELETE`** (`RESTRICT`, `CASCADE`, `SET NULL`). JPA's `cascade = REMOVE` is not a substitute: it works only for deletes that go through Hibernate. Index every FK column; Postgres does not do it for you.

**Enums are `STRING` plus a CHECK.** `ORDINAL` (the JPA default) turns "reorder the constants" into silent data corruption. Adding a value then means a changeset that replaces the CHECK, which is good: it is reviewed.

**UUIDv7 for anything exposed.** Sequential ids leak volume and are enumerable. UUIDv4 scatters btree inserts. Generate v7 in the app or with `uuidv7()` on PostgreSQL 18+.

**Optimistic locking for aggregates users edit concurrently.** Add a `version bigint NOT NULL DEFAULT 0` column with `@Version`. Without it, the last write silently wins.

**Audit what pays the bills.** Money, contracts and permissions get `created_at`, `created_by`, `updated_at` (Spring Data `@CreatedDate`, `@CreatedBy`, `@LastModifiedDate`, or DB defaults/triggers), and a history table or append-only event log. Hibernate Envers is acceptable when the team accepts its table shape.

## Invariants Hibernate Cannot Express

These go into the changeset as plain SQL:

```sql
ALTER TABLE subscriptions ADD CONSTRAINT period_valid CHECK (ends_at > starts_at);
CREATE UNIQUE INDEX one_active_sub ON subscriptions (customer_id) WHERE status = 'ACTIVE';
ALTER TABLE payments ADD CONSTRAINT one_target
  CHECK (num_nonnulls(invoice_id, order_id) = 1);
```

The service still validates for a nice error message. The database guarantees the rule. Map the constraint name in `DataIntegrityViolationException` to a stable error code (see [[error-handling-as-design]]).

## Soft Delete Is A Trap

`@SQLRestriction("deleted_at is null")` (or `@SoftDelete`) applies only to Hibernate-generated SQL. Native queries, reports, other services and unique constraints all still see the "deleted" rows: a unique email blocks re-registration, and a report double-counts. Default: do not soft delete.

1. **Hard delete** when the entity has no afterlife.
2. **Archive table** when you need history. Move the row out, and the live table stays clean.
3. **Explicit lifecycle state** (`status = 'ARCHIVED'`) when the row stays discoverable. Every query opts in.

Deviate when regulation forces retention and the team has a story for unique constraints (partial unique index `WHERE deleted_at IS NULL`) and for joins.

## Indexes Are Part Of The Schema

Add the index in the same change as the column. On an existing table that is a separate `CONCURRENTLY` changeset; see [[migration-safety]].

- Every FK column, on the child side.
- Every `WHERE` / `ORDER BY` a repository method will run on a non-trivial table.
- A unique index for "find one by X": free correctness.
- `@Table(indexes = ...)` and `@Index` are ignored with `ddl-auto=validate`. They are documentation at best. The changeset is the truth.

## Multi-Tenancy

`tenant_id` is NOT NULL, leads the composite indexes, and is enforced by the database: Row Level Security with the tenant set per transaction. A Hibernate `@TenantId` or `@Filter` is an app-level filter that fails open on native queries. See [[auth-and-authorization]].

## Anti-Patterns

- **Schema generated by Hibernate** (`ddl-auto=update`) and "cleaned up later". The DDL nobody reviewed is the DDL in production.
- **JSON column as schema escape hatch.** A `jsonb` attributes column that the code reads by key is a schema without constraints. Model it, unless the data is truly free-form (third-party payloads, user-defined fields).
- **Polymorphic associations** (`entity_type` + `entity_id`). No FK is possible. Use separate tables or nullable FKs with a `num_nonnulls` CHECK.
- **Booleans for things that grow.** `is_archived`, then `is_suspended`, then `is_pending_review`. Model state.
- **Mutable natural keys as PK.** If the username can change, it is not the key.
- **Inheritance mapping by reflex.** `SINGLE_TABLE` forces nullable columns; `JOINED` adds joins to every query. Prefer composition unless polymorphic queries are central.

## Quick Decision Guide

| Question | Default | Deviate when |
|----------|---------|--------------|
| Who owns DDL | Liquibase changeset, reviewed | Never Hibernate `ddl-auto` |
| Public id | UUIDv7 | Internal-only table → bigint sequence |
| Time | `timestamptz` ↔ `Instant` | Calendar dates → `date` ↔ `LocalDate` |
| Money | `numeric` ↔ `BigDecimal` | Integer minor units ↔ `long` |
| Enum | `text` + CHECK ↔ `STRING` | Postgres enum if the set is very stable |
| Nullable? | No | Absence has a distinct meaning |
| Concurrent edits | `@Version` | Append-only tables |
| Soft delete | No | Regulation + partial unique indexes |

## See also

- [[migration-safety]] to ship the changeset without an incident
- [[jpa-and-transactions]] for the entity side of the mapping
- [[query-discipline]] to read this schema fast
- [[think-before-coding]] Step 2 invokes this skill

---
description: Review a Liquibase changeset / changelog (formatted SQL, XML, YAML) for PostgreSQL against senior discipline. Flags lock-ups, checksum breakage, entity drift, irreversibility and missing expand/contract BEFORE the file is committed.
argument-hint: Path to the changelog file (or directory / changelog master), or paste the SQL inline
disable-model-invocation: false
---

# Review Migration (Liquibase + PostgreSQL)

You are reviewing a schema change as a senior on-call engineer who has been burned by migrations before.

Input: $ARGUMENTS

## Step 1: Read the change in context

- Read the changelog file(s). If a directory or the master was given, follow the `include`/`includeAll` order and focus on changesets that are new in this branch (`git diff` against the base branch).
- **Check immutability first.** For every changeset in the diff, run `git log --oneline -- <file>` and `git diff <base> -- <file>`. If a changeset that exists on the base branch has changed body or attributes, that is blocking.
- Read the `@Entity` classes mapped to the touched tables, and `spring.jpa.hibernate.ddl-auto` / `spring.liquibase.*` settings.
- For each touched table, establish its size and how hot it is. Ask the user if unknown; "small" / "1M+" / "100M+" and "hot / cold" are enough.
- Note how migrations run: on app startup (Boot default) or as a separate Job/step.

## Step 2: Apply the migration-safety checklist

Invoke the `migration-safety` skill and check each changeset:

1. **Immutability:** no applied changeset edited; no `validCheckSum` used to paper over an edit.
2. **Lock budget:** every `ALTER TABLE` on an existing table has `SET LOCAL lock_timeout` (or the migration role has one).
3. **Indexes:** `CREATE INDEX CONCURRENTLY IF NOT EXISTS`, alone in its changeset, with `runInTransaction:false`. No `<createIndex>` on hot tables.
4. **NOT NULL:** no `ADD COLUMN ... NOT NULL` without a constant default; `SET NOT NULL` on big tables goes through `CHECK ... NOT VALID` → `VALIDATE` → `SET NOT NULL`; no `addNotNullConstraint` with `defaultNullValue` on big tables.
5. **Defaults:** no volatile default (`gen_random_uuid()`, `clock_timestamp()`) on `ADD COLUMN` of an existing table.
6. **Constraints:** FK and CHECK added `NOT VALID`, then `VALIDATE CONSTRAINT` in a later changeset. Every new FK column indexed. Explicit `ON DELETE`.
7. **Breaking changes:** rename, type change and drop follow expand/contract across releases. The previous app version (old entity mappings) still works against the new schema.
8. **Data changes:** no `UPDATE`/`DELETE`/`<update>` proportional to table size inside changesets. Backfills are separate batched jobs.
9. **Rollback:** `--rollback` / `<rollback>` present and honest, or irreversibility stated.
10. **Hygiene:** one concept per changeset; unique `author:id`; test data behind `context`; `runOnChange` only for views/functions; `splitStatements:false` for function bodies.
11. **Entity agreement:** the entity matches the new schema (types, nullability, names, `@Version`, sequence `allocationSize`). `ddl-auto` is `validate`/`none`.

## Step 3: Report

```
## Migration Review: <file or "inline SQL">

### Tables touched
- <table> (<size>, <hot/cold>): <operations> — lock: <lock level, expected duration>

### Blocking issues
- [file:line, changeset author:id] <issue>. Risk: <one line>. Safer pattern: <one line, often a multi-changeset plan>.

### Should-fix
- [file:line, changeset author:id] <issue>. Risk: <one line>. Safer pattern: <one line>.

### Worth considering
- <suggestion>. Reason: <one line>.

### Deploy plan
<one paragraph: does this need multiple releases (expand/contract)? Does it run on startup or as a Job? What does the old app version see during the rollout?>

### Rollback story
<one paragraph: what do we run if this deploy is bad? Is the rollback honest? What is irreversible and must be in the PR description?>

### Verdict
- **Safe to merge** | **Refactor required** | **Multi-release plan required**
```

## Rules

- **Lock budget over style.** Spend findings on what causes outages and startup failures.
- **Multi-release plans get concrete:** "Release 1: changeset A adds `currency` nullable + entity writes it. Job backfills. Release 2: changesets B/C enforce NOT NULL via CHECK NOT VALID → VALIDATE → SET NOT NULL."
- **Give the corrected changeset**, in formatted SQL with header attributes and `--rollback`, for every blocking issue.
- **No "looks fine to me".** If it is clean, say "no blocking issues, no should-fix" and stop.
- **Irreversibility is an explicit decision** that the PR description must state.

## When You Need More Info

If table size, hotness, PostgreSQL version (behavior differs before 11 and 12), or how migrations are run is unknown and changes the verdict, ask before you give a verdict.

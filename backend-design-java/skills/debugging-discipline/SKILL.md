---
name: debugging-discipline
description: Use when the user reports a Spring Boot service broken, slow, flaky, or wrong in production or staging ("it's slow", "500s", "pods restarting", "OOMKilled", "Connection is not available, request timed out", "LazyInitializationException in prod", "Kafka lag growing", "Liquibase waiting for changelog lock", "the data is wrong"). Forces an investigation method instead of guessing. Apply BEFORE proposing a fix. Triggers also on "тормозит", "упало", "падает", "ошибки в проде", "поды рестартуют", "утечка памяти", "не работает на проде".
---

# Debugging Discipline

When something is wrong, the senior reflex is not "I bet it's the cache". It is "let me see the data". Theorizing without measuring is how a 20-minute incident becomes a 4-hour outage with three panic fixes.

## The Discipline

1. **Mode:** an active incident (mitigate first) or a stable bug (investigate fully, fix once).
2. **Define the symptom:** when it started, who sees it, what fraction, the exact behavior, the expected behavior.
3. **Where to look:** which dashboard, log query, thread dump, `pg_stat_activity`, trace.
4. **Reproduce:** a failing test or a manual repro.
5. **Bisect:** commits, config, data range, tenant.
6. **One hypothesis at a time:** predict, look, confirm or kill.
7. **Document as you go:** what you saw, tried and ruled out.

## Mode One: Active Incident

1. **Stop the bleed.** Roll back the deploy, flip the feature flag, scale the consumer to 0, pause the `@Scheduled` job (ShedLock lock or a property), block the bad traffic at the gateway.
2. **Communicate** every 15 minutes.
3. **Capture state before restarting.** A thread dump (`jcmd <pid> Thread.print`, or `/actuator/threaddump` if exposed internally), a heap histogram (`jcmd <pid> GC.class_histogram`), a JFR recording (`jcmd <pid> JFR.start duration=60s filename=/tmp/rec.jfr`), and a `pg_stat_activity` snapshot. A restart destroys the evidence.
4. **Root-cause after mitigation.**

## Mode Two: Stable Bug

Reproduce, write a failing test against Testcontainers Postgres (see [[testing-with-discernment]]), find the cause, fix it, keep the test.

## Where Before What: The Spring + Postgres Map

| Symptom | Look first at |
|---------|---------------|
| Everything slow, CPU low | `hikaricp.connections.pending` and `.usage`. Pool exhaustion: connections held across remote calls, OSIV, `REQUIRES_NEW`, a leaked transaction. Thread dump: many threads in `HikariPool.getConnection`. |
| `Connection is not available, request timed out after 30000ms` | The same, plus `pg_stat_activity` for `idle in transaction` sessions (the app holds a tx while doing something else) |
| One endpoint slow | Trace for one slow request, SQL log count (N+1?), `pg_stat_statements` top total time, `EXPLAIN (ANALYZE, BUFFERS)` with real params |
| Slow only for some tenants | Data skew plus a generic plan from a prepared statement (see [[query-discipline]]) |
| Requests hang, DB fine | Thread dump: threads in `SocketInputStream.read` on an outbound client with no timeout |
| Writes stuck, then a burst of timeouts | `pg_locks` / `pg_stat_activity.wait_event_type = 'Lock'`: a migration or a long transaction holding a lock, with everything queued behind it |
| Pods restart | `kubectl describe pod`: OOMKilled (heap plus native over the limit, check `MaxRAMPercentage`), or liveness failure (is the DB in the liveness group?) |
| Memory grows until OOM | Heap dump: `OutOfMemoryError` from `findAll()` into a List, a persistence context in a batch loop, an unbounded cache, `ThreadLocal`s on pooled threads |
| GC pauses | `jvm.gc.pause`, GC log (`-Xlog:gc*`), allocation profile from JFR |
| New pods hang on startup | Liquibase: `Waiting for changelog lock` (a stale `DATABASECHANGELOGLOCK` from a killed pod; verify nothing runs, then `release-locks`), or a long changeset blocked on a table lock |
| Startup fails after deploy | `ValidationFailedException: checksum changed`: someone edited an applied changeset |
| Kafka lag growing | Listener processing time, rebalances in logs (`max.poll.interval.ms` exceeded by slow processing), a poison message being retried, consumer concurrency vs partitions |
| Duplicates downstream | Redelivery without dedup, client retries without an idempotency key, `@Scheduled` without ShedLock on N replicas |
| `LazyInitializationException` | Access outside a transaction: OSIV off (good) and the endpoint relied on it, or entity `toString()`/Jackson after the service returned |
| Data wrong | Reconstruct the timeline: which write (audit columns, logs by entity id), which job, which version. Look for lost updates (no `@Version`) and checked exceptions that committed. |

Useful Postgres queries:

```sql
-- who is running what, for how long, waiting on what
SELECT pid, now() - xact_start AS tx_age, state, wait_event_type, wait_event, left(query, 120)
FROM pg_stat_activity WHERE datname = current_database() ORDER BY tx_age DESC NULLS LAST;
-- who blocks whom
SELECT pid, pg_blocking_pids(pid) AS blocked_by, left(query, 120)
FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0;
```

## Reproduce Or You Are Guessing

1. A failing integration test (Testcontainers Postgres, WireMock for remotes, Awaitility for async).
2. A local repro with prod-like data volume and config (OSIV, pool size, profiles).
3. Staging with a sanitized prod snapshot.
4. A load test (Gatling/k6) for pool, lock or concurrency bugs.
5. Production replay, if you have capture.

## Bisect

- **Code:** `git bisect run ./mvnw -q -Dtest=RegressionIT test`.
- **Config:** diff the effective config between the last good and the bad deploy (`/actuator/env` internally, or the Helm values diff). Version bumps of Boot, Hibernate or pgjdbc change defaults.
- **Data:** bisect the tenant set, the date range, the payload fields.

## One Hypothesis At A Time

- "If the pool is exhausted, `hikaricp.connections.pending` > 0 during the window and the thread dump shows waiters in `getConnection`." Look.
- "If it is the 14:05 deploy, the error rate steps at 14:05 on new pods only." Look.
- "If it is a lock, `pg_blocking_pids` is non-empty during the stall." Look.

## Bias Killers

- **"Same as last week."** Treat it as a hypothesis, not a verdict.
- **"It can't be the DB, the DB CPU is low."** Pool exhaustion and lock waits keep DB CPU low.
- **"Just increase the pool."** If connections are held during remote calls, a bigger pool moves the problem into Postgres.
- **"It's GC."** Prove it with the GC log first.
- **Survivor bias:** requests that time out at the gateway never reach your access log.

## Anti-Patterns

- **Restarting first:** no thread dump, no heap histogram, no lock snapshot.
- **Fix without repro:** raising `maximum-pool-size` "to see if it helps".
- **Changing three settings at once:** you no longer know which one mattered.
- **`releaseLocks` without checking** that no other pod is actually migrating.
- **Skipping the postmortem.** The incident is the data; the postmortem is the learning.

## Quick Decision Guide

| Situation | Reflex |
|-----------|--------|
| "Slow / 500s in prod" | Define the symptom; open Hikari pending, error rate by route, recent deploys |
| Customer impact now | Roll back / flag off / scale consumer to 0; capture dumps first |
| Pool timeouts | Thread dump + `pg_stat_activity` (`idle in transaction`) |
| Lock stall | `pg_blocking_pids`; who holds it and why |
| OOM | Heap dump/histogram before restart; look for unbounded loads |
| Startup stuck on Liquibase | Check the changelog lock and blocking locks |
| Repro found | Failing integration test first, then the fix |

## See also

- [[observability-by-default]] for the data that makes this possible
- [[performance-and-scaling]] for pool, GC and lock contention
- [[query-discipline]] when "slow" is the DB
- [[migration-safety]] for Liquibase lock and checksum incidents
- [[testing-with-discernment]] for the regression test

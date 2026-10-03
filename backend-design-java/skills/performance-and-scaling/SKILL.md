---
name: performance-and-scaling
description: Use when building or modifying any Spring Boot component, BEFORE making performance or scaling choices (pool sizes, virtual threads, caching, replicas, async, more pods). Forces "at what load" up front, names the bottleneck axis (Hikari pool, query plan, GC, lock contention, Postgres connections), and pushes the query fix and vertical sizing before distributed anything. Triggers also on "производительность", "тормозит", "масштабирование", "нагрузка", "пул соединений", "кэш", "виртуальные потоки", "добавить поды".
---

# Performance and Scaling

Performance is a design decision. Most "the service is slow" stories in Spring are not about clever code. They come from not knowing the load, a Hikari pool sized by folklore, a connection held across a remote call, and N queries where one would do.

## The Discipline

Before writing anything non-trivial, answer:

1. **At what load?** Requests per second at peak, concurrent users, payload size, rows now and in 18 months.
2. **What is the latency budget?** Total, and how it splits across DB, CPU, remote calls and serialization.
3. **What is the bottleneck axis?** Name one: DB connections, the query plan, Postgres CPU/IOPS, JVM heap/GC, threads, lock contention, a third-party rate limit.
4. **What is "good enough"?** A number, for example p99 < 300ms at 200 rps. Without a target you cannot say "done".
5. **The boring lever first.** Index, query rewrite, fetch plan, pool size, bigger instance. Caching and distribution come fifth and sixth.

If the user has not given load numbers, ask: "How many per second at peak?" That one answer changes the design.

## The Load Question

| Tier | Rough numbers | What it takes |
|------|---------------|---------------|
| Trickle | < 1 rps, < 100 jobs/day | One instance, defaults, no cache |
| Steady | tens to hundreds rps | Fetch plans, indexes, sized Hikari pool, 2–3 replicas for availability |
| Heavy | thousands rps | Hot-path budgets, PgBouncer, read replica, cache the expensive reads, partitioned consumers |
| Big | tens of thousands+ | You measured your way here: sharding, regional, custom protocols |

Most Spring services are Trickle or Steady and get designed for Heavy.

## Bottlenecks By Layer

**The DB connection pool (the usual suspect).**
- Every replica holds a full pool: 10 pods × `maximum-pool-size: 20` = 200 connections. Postgres degrades well before `max_connections`, because each connection is a process with its own memory. Budget `pods × pool ≤ (max_connections − reserved) × 0.8`, counting autoscaling max replicas, migration jobs and batch workers.
- Small pools are faster. A starting point is `cores × 2` on the DB side, divided across replicas. Measure `hikaricp.connections.pending`; do not guess.
- Connections are held for the whole transaction. A 300ms remote call inside `@Transactional`, or OSIV keeping the connection through JSON rendering, divides your real throughput by that time. Fix the hold time before touching the pool size.
- `REQUIRES_NEW` needs two connections per request: a pool deadlock waiting to happen (see [[jpa-and-transactions]]).

**The query plan.** Most "slow" is here: N+1, a missing index, `Page` count queries, in-memory pagination. See [[query-discipline]]. Run `EXPLAIN (ANALYZE, BUFFERS)`, and check `pg_stat_statements` for the top total time.

**Threads and virtual threads.**
- `spring.threads.virtual.enabled=true` (Java 21+) removes the Tomcat thread limit as a bottleneck. **It does not add DB capacity.** With 10,000 virtual threads and 20 connections, 9,980 threads wait in Hikari. Bound the concurrency of DB-bound work: the pool is your semaphore, so set `connection-timeout` short enough to shed load instead of queueing forever.
- On Java 21–23, `synchronized` blocks around I/O pin the carrier thread (JDK 24+ fixed this). Watch for pinning in drivers and your own code (`-Djdk.tracePinnedThreads`).
- WebFlux/R2DBC is not a performance default. Virtual threads give most of the benefit with blocking JPA code you can debug. See [[boring-by-default]].

**JVM memory and GC.**
- In containers, set the heap relative to the limit: `-XX:MaxRAMPercentage=75`, and keep requests equal to limits for memory. Watch `jvm.gc.pause`. Long pauses with a full old gen usually mean an unbounded `findAll`, a big first-level cache in a batch loop, or a cache with no size limit.
- Default to G1 (or Generational ZGC for very low pause targets). Do not tune GC flags before you have a GC log that shows the problem.

**Lock contention.** Hot rows updated by many requests (counters, balances, an "inventory" row) serialize on row locks. Look at `pg_stat_activity` (`wait_event_type = 'Lock'`) and `pg_locks`. Fixes: atomic `UPDATE ... SET qty = qty - :n WHERE qty >= :n`, append-only ledgers, sharding the hot row into N buckets.

**Write throughput.** Batch inserts need `hibernate.jdbc.batch_size`, `order_inserts=true` and SEQUENCE ids (IDENTITY disables batching). Add `reWriteBatchedInserts=true` on the pgjdbc URL. For bulk loads, `COPY` through `CopyManager` beats JPA by an order of magnitude.

## The Scaling Ladder

Climb in order:

1. **Fix the query and the fetch plan.** Index, projection, keyset pagination, no N+1.
2. **Shorten the connection hold.** No remote calls in transactions, OSIV off, read-only transactions.
3. **Size the pool against Postgres**, not against threads.
4. **Resize the boring layer.** A bigger Postgres instance, more CPU and heap per pod. This is often right far longer than people expect.
5. **Add a read replica** for reports and read-heavy endpoints (route `readOnly` transactions via `AbstractRoutingDataSource` or a separate DataSource). Accept replication lag explicitly.
6. **PgBouncer (transaction mode)** when replicas × pool exceeds what Postgres handles. Server-side prepared statements need PgBouncer 1.21+ with `max_prepared_statements`; on older versions set pgjdbc `prepareThreshold=0`. Session features (`SET`, advisory locks, `LISTEN`) do not survive transaction pooling, so use `SET LOCAL` inside the transaction.
7. **Cache the expensive read**, with an invalidation story.
8. **Partition the work**: Kafka partitions by key, time-partitioned tables.
9. **Distribute**: sharding, multi-region. You arrive here with numbers.

## Cache Discipline

Most Spring services do not need a cache; they need an index and a projection.

- **Hibernate second-level cache: no by default.** It is invalidated only by writes that go through this Hibernate instance. Native queries, other services and Liquibase scripts make it lie. Consider it only for small, rarely changing reference data.
- **`@Cacheable`** fits expensive, slow-changing reads (aggregations, third-party responses). The key includes every input that changes the result, **including tenant and user**. Use Caffeine (bounded, with `maximumSize` and `expireAfterWrite`) per instance, or Redis if it must be shared. Never cache entities: cache DTOs.
- **Stampede:** `sync = true` on `@Cacheable` gives a per-key single flight within one instance. Add TTL jitter.
- **No PII in a shared cache** without an expiry and deletion story.

## Async Where It Pays Rent

If the work exceeds ~200ms, or calls a third party, and the caller does not need the result now, push it to a job (outbox + worker, Kafka). `@Async` is not a job system. Boot's default executor has an unbounded queue (or unbounded virtual threads when they are enabled). It loses queued work on restart, and it has no retry or visibility. Use a bounded `ThreadPoolTaskExecutor` for in-process fire-and-forget only. See [[idempotency-and-side-effects]].

## Anti-Patterns

- **"Add more pods."** Every pod brings its pool. Doubling pods doubles DB connections, which is how a scale-out causes the outage.
- **`maximum-pool-size: 100` "to be safe".** More connections means more Postgres contention and slower queries.
- **Virtual threads as a DB accelerator.** They make waiting cheap, not the database faster.
- **Caching to hide a 2-second query.** The cache expires under load and every miss pays the 2 seconds. Fix the query.
- **`Page<T>` on a 50M-row table.** The `count(*)` is the slow part.
- **Tuning JVM flags without a GC log.** Measure first.
- **Designing for Heavy on day one.** Kafka, Redis, a replica and CQRS for 5 rps.

## Quick Decision Guide

| Question | Default | Deviate when |
|----------|---------|--------------|
| First lever for "slow" | SQL log + EXPLAIN, fix the query/fetch plan | DB verifiably idle |
| Hikari pool size | Small (≈10), sized against Postgres across all pods | Measured pending > 0 with idle DB |
| Virtual threads | On for I/O-bound MVC on Java 21+ | Heavy `synchronized` I/O on JDK < 24 |
| Reactive stack | No | Streaming/backpressure is the product |
| Second-level cache | Off | Small immutable reference data |
| `@Cacheable` | Only measured hot reads, Caffeine, bounded | Shared state → Redis |
| More replicas | After the pool budget allows it | Never as the first fix |
| PgBouncer | When pods × pool exceeds the DB budget | Single small deployment |

## See also

- [[query-discipline]] for plans, N+1 and pagination
- [[jpa-and-transactions]] for connection hold time and batching
- [[observability-by-default]] for Hikari, GC and RED metrics
- [[boring-by-default]] for what not to adopt
- [[think-before-coding]] Steps 1 and 6 for load classification

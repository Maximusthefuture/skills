---
name: boring-by-default
description: Use when choosing a database, queue, framework, library, deployment shape, auth scheme, or any infrastructure piece for a Spring Boot / PostgreSQL system. Forces a defense of complexity before adopting new technology (WebFlux, microservices, MongoDB, Redis, Kafka, CQRS, a second-level cache). Reach for this whenever the answer involves "let's use" followed by something new. Triggers also on "давайте используем", "переписать на", "микросервисы", "нужен ли Kafka/Redis", "выбор технологии", "архитектура".
---

# Boring By Default

Complexity compounds and novelty depreciates. The job is not to pick the technology you would enjoy operating. It is to pick the one your on-call self at 3am will thank you for.

## The Discipline

Before adopting new infrastructure or a framework, answer in writing:

1. **What problem do we have that the current stack cannot solve?** Specifically, with numbers.
2. **What is the cheapest extension of the current stack that solves it?** Often a column, an index, a table-backed queue, or a config property.
3. **What does it cost over five years?** Backups, upgrades, on-call expertise, hiring, runbooks, monitoring, plus Spring Boot compatibility on every major upgrade.
4. **Who runs it at 3am?** "We will figure it out" means no.

If the new thing wins all four, adopt it. Usually it does not.

## The Default Stack

| Need | Default | Why |
|------|---------|-----|
| Runtime | Java LTS (21/25) + Spring Boot, latest supported minor | One upgrade path, huge operational knowledge base |
| Web | Spring MVC (+ virtual threads) | Blocking code you can debug and profile. WebFlux only when streaming/backpressure is the product. |
| Data | PostgreSQL | Relational, JSONB, full-text, queues (SKIP LOCKED), partitioning, RLS. Most "we need Mongo" is "we did not know Postgres". |
| Data access | Spring Data JPA for aggregates; `JdbcClient`/jOOQ for reports and bulk | Use the right tool per path, not one ORM for everything |
| Migrations | Liquibase, formatted SQL changesets | Reviewers see the SQL that runs. No `ddl-auto=update`. |
| Background jobs | `@Scheduled` + ShedLock, or a Postgres-backed scheduler (db-scheduler, JobRunr) | One store of truth, transactional with business data |
| Queue (in-service) | Postgres table + `FOR UPDATE SKIP LOCKED` | Handles thousands of jobs/s; transactional with the write |
| Events between services | Outbox → Kafka/RabbitMQ (whichever the org already runs) | Do not add a broker for one producer and one consumer |
| Cache | None, then Caffeine, then Redis | Most apps need an index, not a cache |
| Search | Postgres FTS / `pg_trgm` | Until relevance ranking or scale needs OpenSearch |
| User auth | Spring Security + server sessions (Spring Session JDBC/Redis), or the org's OIDC provider | Sessions give a kill switch; see [[auth-and-authorization]] |
| Service-to-service | HTTP via `RestClient` + OAuth2 client credentials, or mTLS | Sync where simple; async must earn its debugging cost |
| Architecture | Modular monolith (packages per module; Spring Modulith to enforce boundaries) | Split a service when a module has its own scaling or team need |
| Resilience | Timeouts + Resilience4j where needed | Not a service mesh for three services |
| Observability | Actuator + Micrometer + OpenTelemetry | Built in, standard |
| Tests | JUnit 5 + Testcontainers Postgres | Same database as prod. Not H2. |
| Public IDs | UUIDv7 | See [[data-modeling-discipline]] |
| Deployment | Container on the org's managed platform | Until you measurably outgrow it |

## Spring-Specific Temptations

- **WebFlux / R2DBC "for performance".** Reactive code changes debugging, stack traces, transactions, ThreadLocal/MDC and testing, and JPA does not work with it. Since Java 21, virtual threads give blocking MVC most of the concurrency benefit. Earn reactive with a streaming use case.
- **Spring Cloud everything** (Config Server, Eureka, Gateway) on Kubernetes. The platform already has config maps, DNS service discovery and an ingress. Every Spring Cloud piece is a component to run and upgrade in lockstep with Boot.
- **Hibernate second-level cache** to fix a slow query. Fix the query; the cache lies as soon as anything writes outside Hibernate.
- **CQRS + event sourcing** for CRUD with an audit need. A history table or an append-only log covers the audit at a fraction of the cost.
- **A second database** ("Mongo for the flexible part"). That is a `jsonb` column.
- **Kafka for in-process work.** A `jobs` table with SKIP LOCKED is transactional with your data and has nothing new to run.
- **Code generation and annotation magic everywhere** (MapStruct + Lombok + Immutables + custom processors). Each one is a build-time dependency on every JDK and Boot upgrade. Records cover most DTO needs.

## The "But At Scale" Excuse

- One PostgreSQL instance handles tens of thousands of simple writes per second with a sane schema and pool.
- A SKIP LOCKED table queue handles thousands of jobs per second.
- A Spring MVC monolith on virtual threads, scaled horizontally, serves millions of users when the DB budget is respected.

When you cross a real ceiling, you will have the graphs. Until then, scale is a fantasy, not a reason.

## When To Deviate

Leave the boring path when it measurably costs more than the alternative:

- The boring solution caps out, and the numbers come from your system, not a blog post.
- It was tried and failed for a reason you can articulate.
- A capability is irreplaceable: true streaming backpressure, vector search at scale, cross-region active-active.

"The senior wants to learn it" and "it is the new Spring way" are not reasons.

## Anti-Patterns

- **The two-database start.** Postgres + Mongo + Redis on day one: three backup, upgrade and monitoring stories.
- **Microservices from day one.** One team, five repos, distributed transactions and a shared database anyway.
- **JWT for browser sessions** "because stateless". Revocation becomes a research project.
- **The custom queue on Redis lists.** It will lose messages. Use SKIP LOCKED, then the org's broker.
- **The framework chase.** Rewriting to Quarkus/Micronaut/Kotlin coroutines without a measured problem resets institutional knowledge.
- **Pre-1.0 libraries in production.** Read the release notes, then wait.

## Quick Decision Guide

| Proposal | Default response |
|----------|------------------|
| "Let's use WebFlux" | Show the streaming need; otherwise MVC + virtual threads |
| "Add Redis cache" | Show the slow query's EXPLAIN first |
| "Add Kafka" | Is there a second consumer? Otherwise a SKIP LOCKED table |
| "Split into microservices" | Which module has its own scaling or team boundary? |
| "Add MongoDB" | `jsonb` column + GIN index |
| "Enable 2nd-level cache" | Only for immutable reference data |
| "Custom auth filter" | Spring Security + the org's IdP |
| "Switch to framework X" | Numbers, and who upgrades it for five years |

## See also

- [[performance-and-scaling]] for the ladder you climb before new tech
- [[data-modeling-discipline]] for what Postgres can carry
- [[migration-safety]] for boring changes that are still dangerous
- [[think-before-coding]] for the workflow that catches premature complexity

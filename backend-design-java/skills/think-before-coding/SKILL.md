---
name: think-before-coding
description: Use BEFORE writing any Spring Boot backend code (REST controller, @KafkaListener/@RabbitListener consumer, @Scheduled job, Spring Batch job, CommandLineRunner/admin task, outbound client, webhook receiver, JPA repository/service). Forces the 6-step senior workflow so the design is sound before the first line ships. If you are about to write a server-side component of any kind, you MUST invoke this first. Triggers also on "сделай эндпоинт", "напиши сервис", "добавь консьюмер", "новая джоба", "спроектируй", "реализуй фичу".
---

# Think Before Coding

A senior backend engineer does not start with `@RestController`. They start with six questions. This skill enforces them for any server-side component, not just HTTP endpoints.

## The Hard Gate

Do NOT write classes, sketch packages, or propose an architecture until the six steps below have answers. It applies equally to:

- REST controllers (`@RestController`), GraphQL (`@QueryMapping`), gRPC services
- Message consumers (`@KafkaListener`, `@RabbitListener`, `@SqsListener`) and webhook receivers
- Scheduled jobs (`@Scheduled` + ShedLock, db-scheduler, Quartz)
- Batch / ETL (Spring Batch, a chunked `@Scheduled` job, CSV import)
- Admin tasks and one-shot data fixes (`ApplicationRunner` with a profile, a CLI module)
- Outbound integrations (`RestClient`, `WebClient`, Feign, provider SDKs)
- Data-layer code (entities, repositories, projections, changesets)

If you think "this is too simple to think through", you are wrong. Simple components are where incidents come from. The shorter the component, the shorter the answers, but every step gets one.

**Match depth to stakes.** A health indicator deserves one line per step; a payment flow deserves paragraphs. Do not render six bold headers when the answers are obvious; weave them into your reasoning. Use the structured form when there are real choices or the user asked for a design.

## Step 1: Identify the context

| Context | Spring shape | Latency budget | Failure mode | Concurrency model |
|---------|--------------|----------------|--------------|-------------------|
| Sync HTTP | `@RestController` → `@Service` | tens–hundreds of ms | 4xx/5xx ProblemDetail | thread (or virtual thread) per request, bounded by the Hikari pool |
| Consumer | `@KafkaListener` / `@RabbitListener` | sub-second–seconds | retry, DLT, poison message | partition/queue concurrency, at-least-once |
| Scheduled | `@Scheduled` + ShedLock | per-run | missed run, overlap on N replicas | one runner via lock |
| Batch / ETL | Spring Batch or chunked job | minutes–hours | restartability, bad rows | bounded chunks, restart from checkpoint |
| Admin task | `ApplicationRunner` / CLI | n/a | exit code, partial run | one operator, audited |
| Outbound | `RestClient` / `WebClient` / Feign | the remote's p99 | timeout = unknown state | bounded by the timeout and the pool |

State the classification out loud, together with the expected load: "endpoint at 5 rps" and "endpoint at 5,000 rps" are different designs. If the user has not said, ask. See [[performance-and-scaling]].

## Step 2: Model the data

Write down the entities, their invariants, ownership and lifecycle (states and legal transitions). Every invariant that can be a constraint goes into a Liquibase changeset: NOT NULL, UNIQUE, CHECK, FK, partial unique index. Decide the JPA mapping (LAZY to-one, `STRING` enums, `@Version`?) and the queries this implies, with their indexes. See [[data-modeling-discipline]], [[jpa-and-transactions]], and [[migration-safety]] if the schema changes.

## Step 3: List the failure modes

- **HTTP:** validation (400 + code), not found / not yours (404), conflict (409: unique or optimistic lock), upstream timeout (503/504), DB pool exhausted.
- **Consumer:** transient failure (retry with backoff), permanent failure (DLT), poison message (`ErrorHandlingDeserializer` → DLT), redelivery (dedup).
- **Scheduled / batch:** overlap (ShedLock), run longer than the interval, partial run (restartable, idempotent chunks), a missed window.
- **Admin task:** bad args (non-zero exit), Ctrl-C mid-run (consistent state, resumable).
- **Outbound:** 4xx (do not retry), 5xx/timeout (retry with the same idempotency key), 429 (honor `Retry-After`).

For each: detect, surface, recover. See [[error-handling-as-design]]. Then a short security pass: what does this expose, trust, or leak? See [[security-discipline]].

## Step 4: Map authorization

- **HTTP:** the principal (session or JWT from the IdP), the permission (`@PreAuthorize` bean), the row scope (query scope / RLS). "Any authenticated user" is not an answer.
- **Consumer:** which producer may publish to this topic, and whether the payload can name a principal that you must verify.
- **Admin task:** which operator, and the audit trail.
- **Multi-tenant:** the tenant comes from the principal and is enforced by RLS.

See [[auth-and-authorization]].

## Step 5: Decide idempotence and concurrency

- **Replay:** what if it runs twice? Idempotency key for HTTP mutations, `processed_events` dedup for consumers, restartable chunks for jobs.
- **Concurrent:** what if two instances run at once? `@Version`, `SELECT ... FOR UPDATE [SKIP LOCKED]`, ShedLock, a unique constraint, or partition by key.
- **Out-of-order:** can event N+1 arrive before N? Key by aggregate id, and version-check.
- **Cross-store:** a DB write plus a message or HTTP call means an outbox. Nothing remote inside `@Transactional`.

See [[idempotency-and-side-effects]].

## Step 6: Decide observability

- **Logs:** a JSON boundary event with `traceId` and business ids.
- **Metrics:** RED via `http.server.requests` for HTTP; lag, DLT and retries for consumers; last-success gauge, duration and rows for jobs; `http.client.requests` for outbound; Hikari pending for everything.
- **Health:** readiness includes the dependencies the pod cannot work without. Liveness never includes the DB.
- **Traces:** propagation through builder-created clients and Kafka observation.

See [[observability-by-default]].

## Now You Code

Summarize the six answers in 10 to 20 lines before implementing. Then build in this order: changeset → entity/repository → service with its transaction boundary → controller/listener → error mapping → metrics → tests.

## Red Flags

Stop and come back here if:

- You wrote a repository method before Step 2.
- A `@Transactional` method calls `RestClient` or `KafkaTemplate`.
- The component sends email, makes a payment or publishes an event, and Step 5 was skipped.
- `@Scheduled` without a lock is about to run on more than one replica.
- You catch `Exception` with no log and no plan.
- The controller takes or returns an `@Entity`.

## Anti-Patterns

- **The annotation reflex:** generating controller + service + repository + DTO + mapper before Step 1.
- **The CRUD assumption:** `PUT /orders/{id}` for what is really `POST /orders/{id}/cancel`, a command with rules. Name operations by what they do.
- **Happy path first, edge cases later.** The edge cases are the design and reveal the data model.
- **"We'll add metrics when we need them."** By then you need a redeploy during the incident.

## Quick Decision Guide

| Question | Default | Deviate when |
|----------|---------|--------------|
| Sync or async? | Async (outbox/job) if > 200ms or calls a third party | Read-only, fast, in-process |
| Idempotency key on mutations? | Yes | Pure read, or a natural unique constraint |
| Transaction boundary | One public service method per use case | Never controller-wide |
| Multi-tenant scoping | RLS + query scope | Single-tenant |
| Retries on outbound | Backoff + jitter, one layer, same key | Fire-and-forget pings |
| Logs | JSON with traceId | Never plain text in prod |

## Continuous Disciplines

- [[security-discipline]] on every diff.
- [[testing-with-discernment]] as the code grows, with Testcontainers Postgres for data code.
- [[debugging-discipline]] the moment something is wrong in staging or production.

## See also

- [[data-modeling-discipline]] and [[jpa-and-transactions]] for Step 2
- [[migration-safety]] when Step 2 changes the schema
- [[query-discipline]] when Step 2 implies new reads
- [[error-handling-as-design]] and [[security-discipline]] for Step 3
- [[auth-and-authorization]] for Step 4
- [[idempotency-and-side-effects]] for Step 5
- [[observability-by-default]] for Step 6
- [[performance-and-scaling]] for load-aware choices in Steps 1 and 6
- [[boring-by-default]] when you reach for new tech

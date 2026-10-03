---
description: Audit an existing Spring Boot component (controller, @KafkaListener/@RabbitListener consumer, @Scheduled/Spring Batch job, admin task, outbound client) against senior discipline. Checks schema invariants, JPA mapping and transaction boundaries, error contract, idempotence, authorization, queries and observability.
argument-hint: Path to the component file or directory
disable-model-invocation: false
---

# Backend Component Audit

You are auditing existing backend code as a senior reviewer. The component already exists; the question is whether it is production-ready.

Input: $ARGUMENTS

## Step 1: Classify

Identify what kind of component this is:

- HTTP endpoint (`@RestController` → service → repository)
- Message consumer (`@KafkaListener`, `@RabbitListener`, `@SqsListener`, webhook receiver)
- Scheduled job (`@Scheduled`, Quartz, db-scheduler) or batch (Spring Batch)
- Admin task (`ApplicationRunner`/`CommandLineRunner` behind a profile, CLI module)
- Outbound integration (`RestClient`, `WebClient`, Feign, provider SDK)
- Outbox publisher / long-running worker

The audit checklist adapts to the type. State the classification before you proceed.

## Step 2: Read the component

Read the entry point and follow the call graph one or two hops deep. Note:

- The entities and tables it reads and writes, and the changesets that define them.
- Where `@Transactional` starts and ends, with propagation and readOnly, and what runs inside it.
- The third-party calls and publishes (`RestClient`, `KafkaTemplate`, mail), and whether they sit inside a transaction.
- Where it validates (`@Valid`), authorizes (filter chain, `@PreAuthorize`, query scope, RLS), logs, and maps errors (`@RestControllerAdvice`).
- The repository methods and queries it runs, and their fetch plans.
- Relevant config: `open-in-view`, `ddl-auto`, Hikari pool, Kafka error handler, ShedLock, client timeouts.

## Step 3: Run the audit

For each section below, give one of: **OK** / **Gap** / **Risk**, with a one-line note. Skip sections that do not apply to the component type.

```
## Audit: <component>

### Classification
<type, with file path>

### Invariants and data model
- Schema-enforced invariants (changesets): <list>
- Application-enforced invariants not in schema (Bean Validation / service checks only): <list, gap>
- Entity ↔ schema drift (types, nullability, enums, sequences): <list>
- Nullables that look like "unfilled state": <list>

### JPA and transactions
- Transaction boundary: <OK / on controller / missing / too wide>
- Proxy pitfalls (self-invocation, private @Transactional, checked exceptions committing, swallowed inner failure): <list with file:line>
- Remote calls or publishes inside transactions: <list, risk>
- Mapping traps (EAGER to-one, ORDINAL enums, Lombok on entities, missing @Version): <list>
- OSIV: <off / on (gap)>

### Authorization
- Principal identified at entry: <OK / Gap>
- Scope checked (tenant, role, ownership): <OK / Gap>
- Enforcement point (DB / app / both): <where>

### Error handling
- Validation at boundary (`@Valid` on request DTOs, listener payload validation): <OK / Gap>
- Swallowed or broad `catch` blocks, `printStackTrace`: <list with file:line>
- Caller vs system error split (4xx vs 5xx, log levels): <OK / muddled>
- ProblemDetail + stable error codes; persistence exceptions mapped (unique → 409, optimistic lock → 409): <OK / Gap>
- Timeouts (HTTP client connect/read, Hikari connection-timeout, statement timeout): <list>

### Idempotence and side effects
- Mutation idempotency key (if applicable): <OK / Gap>
- Consumer dedup and error handling (DLT, backoff, ErrorHandlingDeserializer): <OK / Gap>
- `@Scheduled` on multiple replicas without ShedLock: <OK / Gap>
- Outbox or equivalent for DB + broker/API: <OK / Gap / not applicable>
- Retry layers (Resilience4j / Spring Retry / Kafka retry stacked?): <list, risk>

### Queries and data access
- Suspected N+1 (lazy access in loops/mappers/Jackson, EAGER to-one, findById in loops): <list with file:line>
- Unbounded list queries (`findAll()`, lists without Pageable/Limit): <list>
- Indexes that back the queries (checked against changesets): <OK / unknown / Gap>
- Pagination style: <keyset (Window) / Slice / Page with count / offset / none>; collection fetch + pagination: <OK / in-memory paging>

### Observability
- Structured logging (JSON, traceId in MDC, business ids, no entity toString/PII): <OK / partial / Gap>
- Trace propagation (builder-created clients, Kafka observation, @Async/outbox context): <OK / Gap>
- Micrometer metrics for the component type (RED via http.server.requests, consumer lag/DLT, job last-success gauge, http.client.requests, Hikari): <list, with what is missing>
- Health groups (readiness includes the needed dependencies; liveness excludes the DB): <OK / Gap / fake>

### Boring-tech check
- Any complexity that is not paying rent: <list>

### Top 5 issues to fix first
1. ...
2. ...
3. ...
4. ...
5. ...
```

## Rules

- **Cite file and line.** Every issue points to a location.
- **Severity-ordered.** The top 5 list is what the team should pick up first.
- **No "consider adding more tests".** If tests are missing for a critical path, say so concretely: which path, at which level (`@DataJpaTest` + Testcontainers, `@WebMvcTest`, `@SpringBootTest` + Testcontainers), asserting what.
- **No theoretical concerns.** Either you found a specific gap, or the section is OK.
- **Read enough to be honest.** If you only read the entry file, say so, and limit your claims to what you read.

## What To Skip

- Style and naming, unless it actively confuses the reader.
- Generic security platitudes. If you find a specific issue (SQL injection, secrets in code, missing rate limit), name it. Otherwise skip.
- Performance theorizing without a measurement. Flag suspected hot paths, do not predict numbers.

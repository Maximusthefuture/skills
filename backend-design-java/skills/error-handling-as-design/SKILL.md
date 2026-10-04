---
name: error-handling-as-design
description: "Use when designing or implementing any Spring Boot component, BEFORE the happy path. Treats the error path as part of the contract: @RestControllerAdvice with ProblemDetail, stable error codes, validation at the boundary, rollback semantics, timeouts. Catches the swallowed exception, the lost cause, the generic 500 and the checked exception that silently commits. Triggers also on \"обработка ошибок\", \"исключения\", \"ControllerAdvice\", \"ProblemDetail\", \"500 ошибка\", \"валидация\", \"try/catch\"."
---

# Error Handling As Design

The error path is the contract you sign with the API's callers and with your future on-call self. It is part of the design, not a wrapper around it.

## The Discipline

Before writing the happy path, write down:

1. **What can go wrong.** Bad input, missing permission, not found, conflict, optimistic-lock failure, constraint violation, upstream timeout, DB unavailable, cancellation.
2. **How each one surfaces.** HTTP status plus a stable error code for the caller; log level, metric and alert for the operator.
3. **Whose fault it is.** The caller's (4xx, no ERROR log, no retry) or the system's (5xx, ERROR, retry if safe).
4. **What state is left.** Was the transaction rolled back? Was a message half-sent? Is a lock still held?

## Caller vs System

- **Caller's fault**: `MethodArgumentNotValidException`, a domain rule violation, `EntityNotFoundException` on the caller's id, `ObjectOptimisticLockingFailureException`, a unique-constraint violation on user input. Return 4xx with a stable code. Log at `INFO`/`WARN` without a stack trace. Do not page.
- **System's fault**: `CannotGetJdbcConnectionException`, `QueryTimeoutException`, a remote 5xx or timeout, `NullPointerException`. Return 5xx with a generic body. Log `ERROR` with the stack and `traceId`. Alert on the rate.

Mixing them ("we 500'd because the email was taken") pages on-call for nothing and teaches them to ignore alerts.

## One Advice, ProblemDetail, Stable Codes

Spring 6+ has RFC 9457 built in (`ProblemDetail`, `ErrorResponseException`). Use one `@RestControllerAdvice` (extend `ResponseEntityExceptionHandler` so Spring MVC's own exceptions are covered):

```java
@ExceptionHandler(DomainException.class)
ProblemDetail domain(DomainException e) {
    var pd = ProblemDetail.forStatusAndDetail(e.status(), e.getMessage());
    pd.setProperty("code", e.code());          // stable: "INVENTORY_INSUFFICIENT"
    pd.setProperty("details", e.details());    // structured, no prose to regex
    return pd;
}
```

- **`code` is the contract.** Clients branch on it. It is stable across versions, and renames go through deprecation.
- **`detail` is for humans.** Never echo exception messages from Hibernate, JDBC or the remote: they leak SQL, table names and hosts.
- **Translate persistence exceptions once.** For `DataIntegrityViolationException`, read the Postgres constraint name (`ConstraintViolationException#getConstraintName()` from the cause) and map it to a code: `uq_users_email` → `EMAIL_TAKEN` (409). `ObjectOptimisticLockingFailureException` → `CONCURRENT_MODIFICATION` (409).
- **Keep `server.error.include-stacktrace` and `include-message` at `never`** in production.

## Validate At The Boundary

- `@Valid @RequestBody` on every request DTO. Without `@Valid`, the annotations on the record do nothing. Nested objects need `@Valid` on the field.
- `@Validated` on the controller class for `@PathVariable` / `@RequestParam` constraints.
- Use request records with only the writable fields, not entities.
- Validate consumers at the listener: deserialize into a DTO and validate. Invalid messages go to the DLT with a reason; they do not throw forever.
- Validate `@ConfigurationProperties` with `@Validated`, so the app fails at startup rather than at 3am.
- Past the boundary, types carry the guarantee. No `if (x == null) throw` deep in the domain for things the boundary already checked.

## Transactions And Exceptions

- **Checked exceptions commit.** `@Transactional` rolls back only on `RuntimeException`/`Error`. A method that throws `IOException` after writing two rows commits both. Use unchecked domain exceptions or `rollbackFor = Exception.class`.
- **Catching inside the transaction does not undo the rollback mark.** If an inner `@Transactional` call failed, catching it and returning normally gives `UnexpectedRollbackException` at commit, far from the cause.
- **Do not translate exceptions inside the repository layer** just to rethrow. Spring already turns `SQLException` into the `DataAccessException` hierarchy.

## Never Swallow

```java
try { client.notify(order); } catch (Exception e) { }                    // the incident with no logs
try { client.notify(order); } catch (Exception e) { e.printStackTrace(); } // the same, on stdout
```

- Catch only what you have a plan for. `catch (Exception e)` is a smell unless it logs with context and rethrows, or sits at a top-level boundary (scheduler loop, listener error handler).
- Wrapping keeps the cause: `throw new PaymentFailedException(orderId, e)`, never `new X(e.getMessage())`.
- `InterruptedException`: restore the flag (`Thread.currentThread().interrupt()`) and stop. Do not swallow it.
- Never return `null`, `Optional.empty()` or an empty list to mean "it failed". The caller cannot tell "no data" from "broken".

## Retries Belong At One Layer

Choose one: the client (Resilience4j / Spring Retry with backoff + jitter + idempotency key) or the consumer (Kafka `@RetryableTopic` / RabbitMQ DLX). Never both. A client retry of 3 inside a Kafka retry of 10 is 30 calls per event, and it is how a flaky provider becomes a self-inflicted DDoS. Retry only exceptions that mean "transient": `ResourceAccessException`, `5xx`, `429`, `CannotAcquireLockException`, `PessimisticLockingFailureException`. Never retry a validation error.

## Timeouts Everywhere

The default for most Java clients is "wait forever". Set them explicitly:

- **HTTP:** connect plus read timeouts on the `RestClient`/`WebClient` builder (`spring.http.client.*` on Boot 3.4+), and on Feign.
- **DB:** `spring.datasource.hikari.connection-timeout` (time to get a connection; default 30s, often too long for an API) plus a statement timeout (`@Transactional(timeout = 5)`, the `jakarta.persistence.query.timeout` hint, or `statement_timeout` on the app's DB role).
- **Budget:** the children's timeouts must fit inside the caller's. A 10s gateway timeout over a 30s Hikari timeout means the user gives up while the server still waits.

## Anti-Patterns

- **`ResponseEntity.status(500).body(e.getMessage())`** leaks internals and has no stable code.
- **An `@ExceptionHandler` per controller** gives inconsistent shapes. Use one advice.
- **Logging and rethrowing at every layer** produces five stack traces for one failure. Log once, at the boundary that handles it.
- **`@ResponseStatus` on domain exceptions** couples the domain to HTTP and gives no code field. Map in the advice.
- **`orElseThrow()` with no exception** gives `NoSuchElementException` and a 500 for what is a 404.
- **Retry without backoff.** A tight loop against a degraded dependency turns a partial outage into a full one.

## Quick Decision Guide

| Situation | Reflex |
|-----------|--------|
| Invalid request body | `@Valid` → 400 ProblemDetail, code `VALIDATION_FAILED`, field errors |
| Not found / not yours | 404 with a stable code; same response for "not yours" (no enumeration) |
| Unique constraint hit | Map the constraint name → 409 code |
| Optimistic lock | 409 `CONCURRENT_MODIFICATION` |
| Upstream timeout | 503/504 or a retry queue; ERROR log with traceId |
| Checked exception in `@Transactional` | Unchecked, or `rollbackFor` |
| `catch (Exception e)` | Narrow it, or log + rethrow |
| Outbound call | Explicit timeouts, one retry layer, idempotency key |

## See also

- [[think-before-coding]] Step 3 invokes this skill
- [[jpa-and-transactions]] for rollback and propagation rules
- [[idempotency-and-side-effects]] for retry safety
- [[observability-by-default]] for the metrics that detect these failures
- [[security-discipline]] for what must not leak through errors

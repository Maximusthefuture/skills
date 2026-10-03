---
name: idempotency-and-side-effects
description: Use when designing any Spring operation that changes state, sends a message (Kafka, RabbitMQ, email), makes a payment, calls a third party, emits an event, or writes to more than one store. Forces idempotence and the transactional outbox so retries, redeliveries and double-clicks never duplicate side effects. Apply BEFORE writing the controller, @KafkaListener, @Scheduled job or client. Triggers also on "идемпотентность", "дубли", "повторная доставка", "outbox", "ретраи", "отправить в Kafka", "вызов внешнего API".
---

# Idempotency and Side Effects

Networks retry. Clients double-click. Kafka redelivers after a rebalance. Operators replay jobs. If your code "works" only when each operation runs exactly once, it does not work.

## The Discipline

For every state-changing operation, answer in one sentence:

**"What happens if this runs twice with the same input?"**

The answer must be "the same observable outcome as running once". "Duplicate charge", "duplicate email", "duplicate row" and "I do not know" all mean the design is incomplete.

## Idempotency Keys For HTTP Mutations

For client-driven mutations where a retry is plausible (payments, orders, anything that sends a message):

1. The client sends `Idempotency-Key: <uuid>`.
2. The server stores `(key, principal, request_hash, response_status, response_body, created_at)` in an `idempotency_keys` table with `UNIQUE (principal, key)`.
3. **Insert the key in the same transaction as the business write.** `INSERT ... ON CONFLICT DO NOTHING` returns zero rows on a replay. Then:
   - same request hash: return the stored response;
   - different hash: `409` with code `IDEMPOTENCY_KEY_REUSED`;
   - original still in flight: `409` with code `REQUEST_IN_PROGRESS`, and the client retries later.
4. Expire keys with a cleanup job (24h–7d).

Implement it once, as a `HandlerInterceptor` or a service-level helper, not per endpoint.

It is optional for operations that are idempotent by nature: reads, `PUT` of a full resource, and inserts protected by a natural unique constraint.

## Consumers Are At-Least-Once

`@KafkaListener`, `@RabbitListener` and `@SqsListener` all redeliver: on rebalance, on a crash before commit or ack, and on retry. Design for it:

- **Dedup on a stable key** (event id, business key) in the same DB transaction as the effect:
  ```sql
  INSERT INTO processed_events (event_id, consumer) VALUES (:id, 'billing') ON CONFLICT DO NOTHING
  ```
  0 rows means already handled: ack and return.
- **Or make the effect naturally idempotent**: `INSERT ... ON CONFLICT DO NOTHING`, `UPDATE ... WHERE status = 'PENDING'`, set-to-value rather than increment.
- **Spring Kafka defaults lose data.** `DefaultErrorHandler` retries 9 times with no backoff, then logs and skips the record. Configure a `DeadLetterPublishingRecoverer`, or use `@RetryableTopic` with exponential backoff and a `@DltHandler`. Wrap deserializers in `ErrorHandlingDeserializer` so a poison message goes to the DLT instead of blocking the partition.
- **Commit offsets after the DB transaction commits** (the default `AckMode.BATCH`/`RECORD` after the listener returns). Do not ack manually before the work is durable.
- **Ordering:** Kafka orders per partition. Key messages by aggregate id if order matters, and make handlers tolerate an older event arriving late (version or timestamp check).

## The Transactional Outbox

"Save the order AND publish `OrderCreated`" cannot be atomic across Postgres and Kafka. `kafkaTemplate.send()` inside `@Transactional` publishes even if the transaction rolls back. Calling it after commit loses the event if the pod dies in between.

The boring fix:

1. In the same `@Transactional` method as the business write, insert an `outbox` row: `id uuid, aggregate_id, type, payload jsonb, created_at, published_at NULL`.
2. A publisher, either `@Scheduled` with ShedLock or a dedicated worker, claims rows with `SELECT ... WHERE published_at IS NULL ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED`, sends them, and marks them published.
3. Consumers dedup by the outbox `id`. The publisher may send twice; that is the contract.

A partial index `WHERE published_at IS NULL` keeps the scan cheap. Delete or archive published rows on a schedule. Debezium CDC on the outbox table is the upgrade path when polling latency matters; earn it.

`@TransactionalEventListener(phase = AFTER_COMMIT)` is not an outbox. The event exists only in memory and dies with the pod. It is acceptable for best-effort notifications (cache eviction, metrics), and not for anything a customer or another service depends on.

## Outgoing Calls

Every call through `RestClient`, `WebClient`, Feign or an SDK assumes:

- The request may succeed while the response never arrives. A timeout means the state is **unknown**.
- A 5xx or a timeout is retryable **only** with the same idempotency key (the provider's `Idempotency-Key` header, or your outbox id).
- A 4xx is not retried, except `429` (honor `Retry-After`) and sometimes `409`/`408`.
- Explicit connect and read timeouts. The defaults are infinite.

Retry in **one** layer: Resilience4j / Spring Retry (or Spring Framework 7's built-in `@Retryable`) at the client, or the consumer's retry topic, not both. Three client retries times ten Kafka retries is thirty calls per event.

## Never Inside A Transaction

Inside a `@Transactional` method, do not:

- call HTTP APIs (`RestClient`, `WebClient`, Feign, SDKs);
- `kafkaTemplate.send`, `rabbitTemplate.convertAndSend`;
- send email or SMS, or upload to S3.

If the transaction rolls back you cannot un-send. While the remote is slow, you hold a pooled connection and row locks; the pool drains and unrelated endpoints start timing out. Use the outbox.

## Anti-Patterns

- **`@Retryable` around a non-idempotent call.** Retry without a key multiplies the side effect.
- **"Exactly-once" from Kafka transactions.** Kafka EOS covers Kafka-to-Kafka. The moment you write to Postgres or call an API, you are back to dedup.
- **Webhook handlers that act before dedup.** Providers redeliver. A webhook endpoint is a consumer; dedup by the provider's event id.
- **Counters by increment in a redelivered handler.** `balance = balance + x` twice is a bug. Use a ledger table with a unique `(source_event_id)` and derive the balance.
- **Dedup in a local `ConcurrentHashMap`.** It disappears on restart and is not shared by the other replicas.

## Quick Decision Guide

| Operation | Reflex |
|-----------|--------|
| POST that costs money | `Idempotency-Key`, key row in the same tx, unique constraint |
| Publish an event after a DB write | Outbox + SKIP LOCKED publisher, consumers dedup by id |
| `@KafkaListener` | `processed_events` dedup, DLT + backoff, ErrorHandlingDeserializer |
| Email / SMS / push | Outbox or job, provider idempotency key |
| Webhook receive | Verify signature, dedup by provider event id, then process async |
| Third-party 5xx / timeout | Retry with backoff + jitter, same key, one layer only |
| Third-party 4xx | Do not retry; surface a stable error |
| Increment / balance | Ledger with unique source id |

## See also

- [[think-before-coding]] Step 5 invokes this skill
- [[jpa-and-transactions]] for transaction boundaries and propagation
- [[error-handling-as-design]] for retry and failure shapes
- [[observability-by-default]] for outbox lag, DLT and dedup-hit metrics

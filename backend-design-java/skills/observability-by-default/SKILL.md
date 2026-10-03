---
name: observability-by-default
description: Use when building or modifying any Spring Boot component (controller, @KafkaListener, @Scheduled job, outbound client, batch job), BEFORE the code ships. Forces structured JSON logs with traceId, Micrometer RED/queue/job metrics, real Actuator health groups for Kubernetes probes, and HikariCP/JVM visibility, so it can be debugged at 3am without SSH. Triggers also on "логирование", "метрики", "трейсинг", "actuator", "healthcheck", "мониторинг", "алерты", "MDC".
---

# Observability By Default

If you cannot diagnose the service without `kubectl exec` and a heap dump, you have shipped a problem to your future on-call self. Spring Boot gives you most of this for free; the discipline is turning it on and using it right.

## The Discipline

Before merge, every component answers:

1. **What is happening right now?** Micrometer metrics tuned to the component type.
2. **What just happened?** Structured logs at the right level, carrying `traceId`.
3. **Is it healthy?** Actuator health groups that check what matters, wired to the right probe.
4. **Where did this request come from and go?** One trace across HTTP, Kafka and the DB.

## Structured Logs

- **JSON in every non-local environment.** Boot 3.4+: `logging.structured.format.console=ecs` (or `logstash`). Older versions use logstash-logback-encoder.
- **`traceId` and `spanId` in every line.** Micrometer Tracing puts them in the MDC automatically (Boot 3.2+ also adds them to the default pattern). Add business ids per request through MDC or structured arguments: `orderId`, `tenantId`, `eventId`.
- **An `event` name per business event, in the past tense:** `log.atInfo().addKeyValue("event", "order.paid").addKeyValue("orderId", id).log("order paid")`. Not `"Processing..."`.
- **Log at the boundary:** entry and failure of a use case, the outcome of a message, the outcome of a job. Not every line of internal logic.
- **Levels mean something.** `ERROR` means a human should look (a system fault). Caller errors are `INFO`/`WARN` without stack traces.
- **Never log** passwords, tokens, `Authorization`, full request bodies, or entities (`toString` loads lazy associations and dumps PII). Mask at the encoder.

## Metrics: Pick The Right Set

Expose `/actuator/prometheus` (`micrometer-registry-prometheus`). Then:

**HTTP (RED)** is free: `http.server.requests` with `uri` as the **template** (`/orders/{id}`). Never build a tag from the raw path. Enable histograms for SLOs: `management.metrics.distribution.percentiles-histogram.http.server.requests=true`. Alert on the 5xx rate and p99 per route.

**Kafka / Rabbit consumers:**
- consumer lag per partition (`kafka.consumer.fetch.manager.records.lag.max`, or the broker-side exporter);
- processing timer per listener (`spring.kafka.listener` with observation enabled);
- counters for retries, DLT publishes and dedup hits.

**Scheduled and batch jobs:** a `last_success_timestamp` gauge per job (alert when now minus last success exceeds the interval × 2), a duration timer, rows processed, and a failure counter. `@Scheduled` emits a timer when observation is on, but "it did not run at all" needs the gauge.

**Outbound clients:** `http.client.requests` (auto for builder-created `RestClient`/`WebClient`/`RestTemplate`; not for `new RestTemplate()`) by `client.name`, status and outcome. Add Resilience4j metrics if used.

**Database and JVM:** these are the ones that explain most incidents.
- `hikaricp.connections.pending`: threads waiting for a connection. Above 0 for long means the pool is exhausted. This is the first graph to check when "everything is slow".
- `hikaricp.connections.usage` and `hikaricp.connections.acquire`.
- `jvm.gc.pause`, `jvm.memory.used` by area, `jvm.threads.states`, `process.cpu.usage`.
- The outbox: count of unpublished rows and age of the oldest.

**Cardinality:** never use `userId`, `orderId` or a raw URL as a tag. One series per user means Prometheus falls over. High-cardinality ids go in logs and traces.

## Traces

- Add `micrometer-tracing-bridge-otel` plus an exporter (OTLP). Set a sampling probability (`management.tracing.sampling.probability`); 1.0 in prod is a cost decision.
- Propagation works automatically for builder-created `RestClient`/`WebClient`/`RestTemplate`, and for `KafkaTemplate`/listeners with `observation-enabled=true` (`spring.kafka.template.observation-enabled`, `spring.kafka.listener.observation-enabled`).
- **Breaks:** `new RestTemplate()`, a hand-built `HttpClient`, `@Async` without a context-propagating executor, `CompletableFuture.supplyAsync` on the common pool, and outbox publishers (store the `traceparent` in the outbox row and restore it when publishing).
- Optional: `datasource-micrometer` for JDBC spans, to see which query ate the request.

## Health Checks That Check

Kubernetes probes map to Actuator groups (`management.endpoint.health.probes.enabled=true`, automatic on k8s):

- **Liveness** (`/actuator/health/liveness`): "the JVM is not wedged". **Never include the DB or a broker.** A DB blip would then restart every pod at once, and the restart does not fix the DB.
- **Readiness** (`/actuator/health/readiness`): "can serve traffic". `management.endpoint.health.group.readiness.include=readinessState,db` and the broker if the pod cannot work without it. A failing readiness takes the pod out of the Service without restarting it.
- **Startup probe** long enough for startup, including Liquibase if it runs on boot (see [[migration-safety]]).
- Custom `HealthIndicator`s must be cheap and time-bounded. A health check that runs a 2-second query under load becomes an outage.
- Expose only `health,info,prometheus` and keep management on a separate port behind the network boundary (see [[security-discipline]]).

## Correlate To The User Story

An operator should be able to take one identifier the customer knows (order number, invoice id) and reconstruct what happened across HTTP, Kafka, jobs and the outbox. Every log line that touches the entity carries that id as a structured field, and the trace links the hops.

## Anti-Patterns

- **`System.out.println`, `e.printStackTrace()`, `show-sql=true`.** No level, no traceId, no JSON.
- **Logging entities or DTOs with `toString()`.** PII, lazy loads and megabyte lines.
- **The DB in the liveness probe.** It turns a DB failover into a cluster-wide restart storm.
- **`/actuator/health` always UP** because nothing was wired. Check that readiness actually flips when the DB is down (test it with Testcontainers: stop the container).
- **Metric tags from request data.** The cardinality explosion pages the observability team instead of you.
- **An alert without a runbook.** Every page links to what to check first.

## Quick Decision Guide

| Component | Metrics | Logs at | Health |
|-----------|---------|---------|--------|
| REST controller | `http.server.requests` per template + histogram | use-case outcome, failures | readiness: db |
| `@KafkaListener` | lag, process timer, retries, DLT, dedup hits | per message: outcome with eventId | readiness: db (+ broker if required) |
| `@Scheduled` / batch | last success gauge, duration, rows, failures | start, end, summary | n/a; alert on last success |
| Outbound client | `http.client.requests` by client/status | non-2xx outcome with traceId | not a readiness dependency unless critical |
| Outbox publisher | unpublished count, oldest age | batch summary | n/a |
| Whole service | Hikari pending/usage, GC pauses, threads | n/a | liveness: process only |

## See also

- [[think-before-coding]] Step 6 invokes this skill
- [[error-handling-as-design]] for what to log and at which level
- [[performance-and-scaling]] for reading Hikari and GC metrics
- [[debugging-discipline]] for using all of this during an incident

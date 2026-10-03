#!/usr/bin/env python3
"""
PostToolUse check for Spring Boot / JPA source files and Spring config.

Detects what the file is (controller, listener, scheduled job, outbound client,
JPA entity, transactional service, application config) and reports the senior
reflexes that are visibly missing. Heuristic, never blocks.

Java (.java, main sources only):
  - empty catch / broad catch with no log and no rethrow / printStackTrace / System.out
  - @Transactional on a private method (silently ignored by the proxy)
  - remote call / message publish inside a @Transactional method
  - REQUIRES_NEW (second pooled connection per call)
  - @RequestBody without @Valid, JPA entity bound as @RequestBody
  - per-id endpoint with no visible authorization
  - unbounded repository findAll()
  - @KafkaListener without visible dedup / error handling
  - @Scheduled without ShedLock
  - HTTP client built without timeouts; outbound POST without idempotency key
  - entity: Lombok @Data/@EqualsAndHashCode/@ToString, EAGER to-one, ORDINAL enum,
    float/double money, LocalDateTime/Date timestamps, IDENTITY ids
Config (application*.yml|yaml|properties):
  - ddl-auto other than validate/none, open-in-view not disabled, show-sql
"""

import os
import re

from _common import (
    block_after, current_content, emit, file_path, is_test_or_generated, line_of,
    read_payload, run, strip_java_comments,
)

SIDE_EFFECT_CALL = re.compile(
    r"\b(restTemplate|restClient|webClient|\w*Client|kafkaTemplate|rabbitTemplate|jmsTemplate|streamBridge|"
    r"mailSender|javaMailSender|sqsTemplate|snsTemplate|s3Client|httpClient)\s*\.\s*"
    r"(send|post|put|patch|delete|exchange|execute|convertAndSend|postForObject|postForEntity|getForObject|"
    r"getForEntity|retrieve|get|publish|putObject)\b")


def findings_for_java(path: str, raw: str):
    src = strip_java_comments(raw)
    out = []

    def add(sev, rule, msg, idx=None):
        where = " (line {})".format(line_of(src, idx)) if idx is not None else ""
        out.append((sev, rule, msg + where))

    is_controller = re.search(r"@(Rest)?Controller\b", src)
    is_entity = re.search(r"^\s*@Entity\b", src, re.MULTILINE)
    is_kafka = re.search(r"@KafkaListener\b", src)
    is_listener = is_kafka or re.search(r"@(RabbitListener|SqsListener|JmsListener)\b", src)
    is_scheduled = re.search(r"@Scheduled\b", src)

    # ---------- error handling ----------
    m = re.search(r"catch\s*\([^)]*\)\s*\{\s*\}", src)
    if m:
        add("risk", "empty-catch",
            "Empty catch block: the failure disappears with no log, no metric, no recovery. Log with context and "
            "rethrow, or handle it explicitly. See skills/error-handling-as-design.", m.start())
    for m in re.finditer(r"catch\s*\(\s*(?:final\s+)?(Exception|Throwable|RuntimeException)\s+(\w+)\s*\)", src):
        o, c = block_after(src, m.end())
        body = src[o:c] if o != -1 else ""
        if body.strip("{} \n\t") and not re.search(r"\bthrow\b|\blog(ger)?\s*\.|\bLOG(GER)?\s*\.", body):
            add("risk", "broad-catch-swallowed",
                "catch ({}) with neither a log nor a rethrow. Callers cannot tell 'no data' from 'broken'. Narrow the "
                "type or log + rethrow. Inside @Transactional, a swallowed exception can still end in "
                "UnexpectedRollbackException at commit.".format(m.group(1)), m.start())
            break
    m = re.search(r"\.printStackTrace\s*\(\s*\)|System\.(out|err)\.print", src)
    if m:
        add("risk", "stdout-logging",
            "printStackTrace / System.out bypass the logging pipeline (no level, no traceId, no JSON). Use the SLF4J "
            "logger. See skills/observability-by-default.", m.start())

    # ---------- transactions ----------
    m = re.search(r"@Transactional\b[^\n]*\n(\s*@[\w.]+(\([^)]*\))?\s*\n)*\s*private\s", src)
    if m:
        add("blocking", "transactional-private",
            "@Transactional on a private method is ignored: Spring's proxy never sees the call, so there is NO "
            "transaction. Move it to a public method of another bean.", m.start())
    class_tx = re.search(r"@Transactional\b[^\n]*\n(\s*@[\w.]+(\([^)]*\))?\s*\n)*\s*(public\s+)?(abstract\s+)?(final\s+)?class\s", src)
    tx_bodies = []
    if class_tx:
        tx_bodies.append((class_tx.start(), src[class_tx.end():]))
    else:
        for m in re.finditer(r"@Transactional\b", src):
            o, c = block_after(src, m.end())
            if o != -1:
                tx_bodies.append((m.start(), src[o:c]))
    for start, body in tx_bodies:
        sm = SIDE_EFFECT_CALL.search(body)
        if sm:
            add("risk", "side-effect-in-transaction",
                "`{}` is called inside a @Transactional method. If the transaction rolls back the call cannot be "
                "undone, and while the remote is slow the DB connection and row locks stay held. Write an outbox row "
                "in the transaction and send after commit (a @TransactionalEventListener(AFTER_COMMIT) is acceptable "
                "only if losing the event on a crash is acceptable). See skills/idempotency-and-side-effects."
                .format(sm.group(0)), start)
            break
    m = re.search(r"Propagation\.REQUIRES_NEW", src)
    if m:
        add("note", "requires-new",
            "REQUIRES_NEW borrows a SECOND pooled connection while the outer transaction holds the first. Under load "
            "(threads >= pool size) this deadlocks the Hikari pool. Make sure the outer caller is not transactional, "
            "or size for it.", m.start())

    # ---------- endpoints ----------
    if is_controller:
        for m in re.finditer(r"@RequestBody\b", src):
            window = src[max(0, m.start() - 80):m.end() + 60]
            if not re.search(r"@Valid(ated)?\b", window):
                add("risk", "request-body-not-validated",
                    "@RequestBody without @Valid: Bean Validation constraints on the DTO never run, so invalid input "
                    "reaches the service. Add @Valid and map MethodArgumentNotValidException to a 400 ProblemDetail.",
                    m.start())
                break
        for m in re.finditer(r"@RequestBody\s+(?:@\w+(?:\([^)]*\))?\s+)*(?:final\s+)?(\w+)\s+\w+", src):
            t = m.group(1)
            if re.search(r"^import\s+[\w.]*\.(entity|entities|domain|model|persistence)\.{};".format(t), src, re.MULTILINE):
                add("blocking", "entity-as-request-body",
                    "JPA entity `{}` is bound directly from the request body: mass assignment of id, owner, role, "
                    "version or tenant fields. Bind a request record DTO with only the writable fields.".format(t),
                    m.start())
                break
        if re.search(r"@PathVariable\b", src) and not re.search(
                r"@PreAuthorize|@PostAuthorize|@Secured|@RolesAllowed|@AuthenticationPrincipal|\bAuthentication\s+\w|"
                r"\bPrincipal\s+\w|SecurityContextHolder|@CurrentUser|\bJwt\s+\w", src):
            add("note", "no-visible-authz",
                "Endpoints take resource ids from the path but no authorization is visible here (@PreAuthorize, "
                "@AuthenticationPrincipal, ...). Name where ownership/tenant is checked; a filter chain that only says "
                "authenticated() is not an ownership check (IDOR). See skills/auth-and-authorization.")

    m = re.search(r"\b\w*(Repository|Repo)\s*\.\s*findAll\s*\(\s*\)", src)
    if m:
        add("risk", "unbounded-findall",
            "findAll() with no Pageable/limit loads the whole table into the persistence context. Use a Pageable/"
            "Limit, keyset scrolling (Window/ScrollPosition) or a stream with fetch size. See skills/query-discipline.",
            m.start())

    # ---------- consumers / scheduled ----------
    if is_listener and not re.search(
            r"idempot|dedup|processed|ON\s+CONFLICT|existsBy|alreadyHandled|eventId|messageId", src, re.IGNORECASE):
        add("risk", "listener-no-dedup",
            "Message listener with no visible dedup/idempotency. Delivery is at-least-once (rebalance, retry, redeploy). "
            "Key the work by event id with a unique constraint or INSERT ... ON CONFLICT DO NOTHING.")
    if is_kafka and not re.search(r"@RetryableTopic|@DltHandler|DefaultErrorHandler|DeadLetter|CommonErrorHandler|errorHandler",
                                  src):
        add("note", "kafka-error-handling",
            "No error handling visible for this @KafkaListener. Spring Kafka's default DefaultErrorHandler retries 9 times "
            "with no backoff, then LOGS AND SKIPS the record (data loss). Confirm a DeadLetterPublishingRecoverer/"
            "@RetryableTopic with backoff is configured, and that poison messages (deserialization) go to a DLT.")
    if is_scheduled and not re.search(r"@SchedulerLock\b|LockProvider|tryLock|pg_try_advisory", src):
        m = re.search(r"@Scheduled\b", src)
        add("risk", "scheduled-no-lock",
            "@Scheduled runs on EVERY replica. Add ShedLock (@SchedulerLock with lockAtMostFor) or a Postgres advisory "
            "lock, and make the job resumable. Expose a last-success-timestamp metric.", m.start())

    # ---------- outbound HTTP ----------
    for pat, name in ((r"new\s+RestTemplate\s*\(\s*\)", "new RestTemplate()"),
                      (r"RestClient\s*\.\s*create\s*\(", "RestClient.create()"),
                      (r"WebClient\s*\.\s*create\s*\(", "WebClient.create()"),
                      (r"HttpClient\s*\.\s*newHttpClient\s*\(", "HttpClient.newHttpClient()")):
        m = re.search(pat, src)
        if m and not re.search(r"[Tt]imeout", src):
            add("risk", "http-client-no-timeout",
                "{} has no timeouts: JDK/Spring defaults wait forever on a hung remote, holding a thread (and a DB "
                "connection if inside a transaction). Inject the auto-configured RestClient.Builder and set "
                "connect/read timeouts (spring.http.client.* or a request factory).".format(name), m.start())
            break
    m = re.search(r"\.post\s*\(\s*\)|HttpMethod\.POST|postFor(Object|Entity)\s*\(", src)
    if m and re.search(r"RestClient|RestTemplate|WebClient|HttpClient|@HttpExchange|@FeignClient", src) \
            and not re.search(r"[Ii]dempotency", src):
        add("note", "outbound-post-no-idempotency",
            "Outbound POST with no idempotency key. A timeout leaves the remote state unknown; a retry without a key "
            "can double-charge/double-send. Send the provider's idempotency header with a stable key.", m.start())

    # ---------- JPA entity hygiene ----------
    if is_entity:
        m = re.search(r"^\s*@(Data|EqualsAndHashCode|ToString|Value)\b", src, re.MULTILINE)
        if m:
            add("risk", "lombok-on-entity",
                "Lombok @{} on an @Entity: equals/hashCode over mutable/lazy fields breaks Sets and Hibernate "
                "dirty tracking; toString() triggers lazy loading and infinite recursion. Use @Getter/@Setter and "
                "write equals/hashCode on the id (constant hashCode) or a natural key.".format(m.group(1)), m.start())
        for m in re.finditer(r"@(ManyToOne|OneToOne)\b(\s*\(([^)]*)\))?", src):
            if "LAZY" not in (m.group(3) or ""):
                add("risk", "eager-to-one",
                    "@{} is EAGER by default: every JPQL query on this entity fires an extra SELECT per row (N+1). "
                    "Use fetch = FetchType.LAZY and fetch explicitly (JOIN FETCH / @EntityGraph) where needed."
                    .format(m.group(1)), m.start())
                break
        m = re.search(r"FetchType\.EAGER", src)
        if m:
            add("risk", "fetch-eager",
                "FetchType.EAGER cannot be turned off per query. Make it LAZY and fetch per use case.", m.start())
        m = re.search(r"@Enumerated\b(?!\s*\(\s*(EnumType\.)?STRING)", src)
        if m:
            add("risk", "enum-ordinal",
                "@Enumerated without EnumType.STRING stores the ordinal: reordering or inserting an enum constant "
                "silently corrupts data. Use STRING plus a CHECK constraint (or a Postgres enum) in the changelog.",
                m.start())
        m = re.search(r"\b(double|float|Double|Float)\s+\w*(amount|price|total|balance|cost|sum|fee|money)\w*\s*[;=]",
                      src, re.IGNORECASE)
        if m:
            add("blocking", "float-money",
                "Money mapped as {}: binary floating point cannot represent cents. Use BigDecimal + numeric(p,s), or "
                "long minor units.".format(m.group(1)), m.start())
        m = re.search(r"\b(LocalDateTime|java\.util\.Date|Date|Timestamp)\s+\w*(At|Time|Date|On)\b\s*[;=]", src)
        if m:
            add("note", "timestamp-type",
                "{} maps to `timestamp without time zone`: the instant depends on the JVM/DB timezone. For points in "
                "time use Instant/OffsetDateTime -> timestamptz and set hibernate.jdbc.time_zone=UTC."
                .format(m.group(1)), m.start())
        m = re.search(r"GenerationType\.IDENTITY", src)
        if m:
            add("note", "identity-ids",
                "GenerationType.IDENTITY disables JDBC insert batching (Hibernate must insert row by row to learn the id). "
                "Fine for low insert rates; for bulk inserts use SEQUENCE with allocationSize matching the sequence "
                "INCREMENT BY in the changelog.", m.start())
    return out


CONFIG_NAME = re.compile(r"^(application|bootstrap)([-.][\w-]+)?\.(ya?ml|properties)$", re.IGNORECASE)


def findings_for_config(path: str, src: str):
    out = []
    base = os.path.basename(path).lower()
    local_profile = re.search(r"-(local|dev|test)\.", base)
    m = re.search(r"ddl[-_]auto\s*[:=]\s*[\"']?(update|create|create-drop)\b", src, re.IGNORECASE)
    if m and not local_profile:
        out.append(("blocking", "ddl-auto",
                    "spring.jpa.hibernate.ddl-auto={} lets Hibernate change the schema behind Liquibase's back (no "
                    "review, no rollback, drift between environments). Use `validate` and put every change in a "
                    "changeset.".format(m.group(1))))
    if re.search(r"(^|\n)\s*jpa\s*:|spring\.jpa\.", src) and not re.search(r"open[-_]in[-_]view\s*[:=]\s*false", src):
        out.append(("risk", "open-in-view",
                    "spring.jpa.open-in-view is not set to false (Boot defaults to true). OSIV keeps a DB connection for "
                    "the whole HTTP request including view rendering/serialization, and hides lazy-loading N+1 in "
                    "controllers. Set it to false and fetch what the endpoint needs in the service."))
    if re.search(r"show[-_]sql\s*[:=]\s*true", src):
        out.append(("note", "show-sql",
                    "show-sql prints to stdout, bypassing the logger (no level, no traceId). Use "
                    "logging.level.org.hibernate.SQL=debug locally instead."))
    return out


def main():
    payload = read_payload()
    if not payload:
        return
    path = file_path(payload)
    if not path or is_test_or_generated(path):
        return
    content = current_content(payload)
    if not content.strip():
        return
    base = os.path.basename(path)
    if path.endswith(".java"):
        findings = findings_for_java(path, content)
        footer = ("See skills/think-before-coding and skills/jpa-and-transactions; run "
                  "`/backend-design-java:audit {}` for a full pass.".format(base))
    elif CONFIG_NAME.match(base):
        findings = findings_for_config(path, content)
        footer = "See skills/jpa-and-transactions and skills/performance-and-scaling."
    else:
        return
    emit("component", path, findings, footer)


if __name__ == "__main__":
    run(main)

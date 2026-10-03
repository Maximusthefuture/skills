---
name: security-discipline
description: Use on every diff, every new controller, listener, client or config change in a Spring Boot service. Treats security as a per-change reflex, not an audit phase. Catches IDOR/BOLA in Spring Data lookups, mass assignment via entity binding, JPQL/SQL/SpEL injection, exposed Actuator, secrets in application.yml, unsafe deserialization, disabled TLS, and leaky error responses. Apply BEFORE marking a change done. Triggers also on "безопасность", "уязвимость", "IDOR", "инъекция", "секреты", "actuator", "security review".
---

# Security Discipline

Security is not a milestone. It is the question you ask of every diff: what does this expose, what does it trust, what could it leak. Reviews catch what they catch; the reflex catches the rest.

## The Per-Change Audit

Before a change is done, answer four questions about the diff:

1. **What does this expose?** A new endpoint, a new field in a response DTO, a new Actuator endpoint, a new listener on a topic anyone can publish to.
2. **What does it trust?** Request bodies, path ids, JWT claims, headers, message payloads, webhook bodies, config values.
3. **What can leak through it?** Logs, `ProblemDetail` bodies, stack traces, `toString()` of entities, Actuator `/env` and `/heapdump`.
4. **Is the default closed?** The new endpoint is covered by `anyRequest().authenticated()`, the new field is not bindable, the new origin is not allowed.

## Deny By Default In Spring Security

- The `SecurityFilterChain` ends with `.anyRequest().authenticated()` (or `.denyAll()`). Public paths are an explicit allowlist. A trailing `.anyRequest().permitAll()` makes every future endpoint public.
- Use `@EnableMethodSecurity` with `@PreAuthorize` on service or controller methods for business permissions. The filter chain answers "is this a known user"; method security and the data layer answer "may this user touch this row".
- Prefer `permitAll()` over `web.ignoring()`. `ignoring` removes the path from the whole filter chain, including security headers.
- CSRF stays on for cookie or session auth. Disabling it is correct only for stateless bearer-token APIs.

## Common Failures In Spring Services

**IDOR / BOLA, the most common real vulnerability.**
```java
// Wrong: any authenticated user reads any order.
orderRepository.findById(id)
// Right: the scope comes from the principal, never from the request.
orderRepository.findByIdAndCustomerId(id, currentUser.customerId())
        .orElseThrow(() -> new NotFoundException("ORDER_NOT_FOUND"));   // 404, not 403
```
Every per-id lookup is scoped by owner or tenant in the query itself, or protected by `@PreAuthorize("@orderAccess.canRead(#id, authentication)")`. Row Level Security is the floor for multi-tenant data (see [[auth-and-authorization]]).

**Mass assignment.** An `@RequestBody User user` binds `role`, `tenantId`, `id`, `version`, `emailVerified`. Bind request records that contain only writable fields, and map them explicitly. Never `BeanUtils.copyProperties(request, entity)` without an allowlist.

**Response over-exposure.** Returning entities serializes every field, including password hashes and internal flags, plus lazy associations. Return response records.

**SSRF.** `restClient.get().uri(request.url())` lets a user make your server call `169.254.169.254` or internal admin APIs. Allowlist hosts, resolve and block private ranges, and do not follow redirects blindly.

**Open redirect.** `"redirect:" + returnUrl` needs a relative path or an allowlist.

**Consumers.** A `@KafkaListener` trusts whatever is on the topic. Validate the payload. Never derive the acting principal from the message without checking the producer. Never deserialize with type info taken from headers or the payload.

## Injection, Across Layers

- **JPQL/SQL:** bind parameters always: `:name` in `@Query`, `setParameter`, `JdbcClient.param()`. Concatenation in `createQuery`, `createNativeQuery`, `jdbcTemplate.query`, `String.format` or `"""...""".formatted()` is a defect, even with "trusted" values.
- **Dynamic sorting:** `Sort.by(userInput)` is validated against entity properties in derived queries, but `JpaSort.unsafe` and native `ORDER BY` are not. Map input onto an allowlist enum.
- **SpEL:** never `parser.parseExpression(userInput)`. `StandardEvaluationContext` on any external input is remote code execution.
- **Deserialization:** no `ObjectInputStream` on untrusted bytes. No Jackson default typing (`activateDefaultTyping`) and no `@JsonTypeInfo(use = Id.CLASS)`. Use `Id.NAME` with a closed set of subtypes. SnakeYAML: a safe constructor only.
- **XML:** disable DTDs and external entities on every parser factory (XXE).
- **Shell:** `ProcessBuilder` with an argument list and no `sh -c`. Never `Runtime.exec(String)` with input.
- **Logs:** CRLF in user input can forge log lines when not using JSON logging. Structured logging escapes it.

## Secrets And PII

- **Not in `application.yml`.** Use `${DB_PASSWORD}` placeholders resolved from the environment or a secret manager (Vault, the cloud secret store, Kubernetes secrets). Committed `application-prod.yml` files with real values are a breach.
- **Not in logs.** No `log.info("{}", request)`, no entity `toString()`, no `Authorization` header. Mask at the encoder.
- **Not in Actuator.** Expose `health,info,prometheus` only. `/heapdump` contains every secret and session in memory, `/env` returns config, and `/loggers` can be POSTed to. Run management on a separate port that is not routed publicly. Keep `show-values` at its masked default.
- **Not in errors.** `server.error.include-stacktrace=never`, `include-message=never`. `ProblemDetail` carries a stable code, not `e.getMessage()` from Hibernate.
- **Passwords:** `PasswordEncoderFactories.createDelegatingPasswordEncoder()` (bcrypt) or Argon2. Never `NoOpPasswordEncoder`, MD5 or SHA-1.
- **Tokens and randomness:** `SecureRandom`, never `java.util.Random` or `Math.random`.
- **PII deletion:** a GDPR delete has to delete from backups-to-be, caches, search indexes and the outbox payloads as well.

## Error Surfaces That Leak

- Return a generic message externally and the full context in logs with `traceId`.
- "User not found" and "wrong password" get the same response. A row that is not yours is 404, not 403.
- No stack traces, SQL, class names or hostnames in responses.

## Boring Security Headers

Spring Security sets `X-Content-Type-Options`, `X-Frame-Options`, `Cache-Control` and HSTS (over HTTPS) by default. Do not turn them off. Add:

- A `Content-Security-Policy` for anything that serves HTML.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- Cookies: `Secure`, `HttpOnly`, `SameSite=Lax` (`server.servlet.session.cookie.*`).
- CORS: an explicit `allowedOrigins` list. No `*`, and never `*` with credentials. `@CrossOrigin` without arguments allows every origin.

## Dependencies

Run dependency scanning (OWASP dependency-check, Trivy, Dependabot/Renovate) and keep Spring Boot on a supported line. Most Java CVEs that get exploited are in libraries (Jackson, SnakeYAML, Log4j, Tomcat), not in your code.

## Anti-Patterns

- **Auth at the route, none at the row.** `hasRole("USER")` passes, then `findById(bodyId)`.
- **Entities as request bodies.** Mass assignment by design.
- **`permitAll()` for `/actuator/**`** "for the health check". It exposes everything that is enabled.
- **`csrf().disable()` copied from a tutorial** into a session-cookie app.
- **Trusting JWT claims as current truth** (role, tenant) without re-checking state for sensitive actions.
- **TLS trust-all in a `RestTemplate`** "for the test environment" that ships to prod. Import the CA instead.
- **Custom crypto.** Use JCA with AES/GCM, or Tink.

## Quick Decision Guide

| Situation | Reflex |
|-----------|--------|
| New endpoint | Covered by `anyRequest().authenticated()`; public only via an explicit matcher |
| Per-id access | Scope in the query (`findByIdAndOwnerId`) or `@PreAuthorize` bean, plus RLS for tenants |
| Request body | Record DTO with writable fields, `@Valid` |
| Response | Record DTO, never the entity |
| Query with input | Bind parameters; sort via an allowlist |
| User-supplied URL | Host allowlist, block private ranges |
| Secret | Env/secret manager placeholder, never a literal |
| Actuator | `health,info,prometheus`, separate port |
| Error body | ProblemDetail + stable code, no stack, no exception message |
| Deserialization | Concrete DTO types; no default typing |

## See also

- [[auth-and-authorization]] for authn/authz, Spring Security and RLS
- [[error-handling-as-design]] for what leaks via errors
- [[observability-by-default]] for what not to log and Actuator exposure
- [[think-before-coding]] Steps 3 and 4

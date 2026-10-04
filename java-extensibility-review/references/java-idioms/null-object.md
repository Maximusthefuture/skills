# Null Object / a default implementation

Type: a classic pattern (not GoF), often a default strategy

## Essence
Instead of `null` or a "missing" handler, an implementation of the interface is used that deliberately does nothing (or does the default behavior). The `if (x != null)` checks at the call sites disappear, and "do nothing" becomes an explicit, named and testable behavior.

## Signs in Java/Spring code
- `if (notifier != null) notifier.send(…)` in several places.
- `Optional<Handler>` with `ifPresent` at every call site.
- `@Autowired(required = false)` followed by null checks.
- `default -> {}` (an empty branch) in every `switch`.
- A flag `if (props.isAuditEnabled()) audit.log(…)` in several places.

## When not to apply
- "Do nothing" masks an error: if a missing handler is a configuration bug, better fail at startup (see the completeness check in `../behavioral/strategy.md`).
- The caller needs to know the action did not happen (then an explicit result is needed).

## After
```java
public interface AuditLog { void record(AuditEvent e); }

@Configuration
class AuditConfig {
    @Bean
    @ConditionalOnProperty(name = "audit.enabled", havingValue = "true")
    AuditLog dbAuditLog(AuditRepository repo) { return new DbAuditLog(repo); }

    @Bean
    @ConditionalOnMissingBean(AuditLog.class)
    AuditLog noopAuditLog() {
        return e -> log.debug("Audit disabled, skipping {}", e.type());   // do nothing, but visible in debug
    }
}

// in services — no checks
audit.record(new AuditEvent("order.created", orderId));
```
In strategy registries this is the default handler for keys without their own implementation, but only if that behavior is a deliberate business decision.

## Pitfalls
- `@ConditionalOnMissingBean` works reliably in auto-configuration; in plain `@Configuration` classes the processing order can surprise. A safer pair is `@ConditionalOnProperty(havingValue = "true")` / `(havingValue = "false", matchIfMissing = true)`.
- A Null Object that returns values (e.g. an empty list) must honor the interface contract.
- Log at `debug` that the stub fired. Otherwise "why did the email not arrive" becomes a long investigation.

## Related patterns
Strategy (a default strategy) · Configuration over code (`@ConditionalOnProperty`) · Proxy (`@Lazy` / optional dependencies).

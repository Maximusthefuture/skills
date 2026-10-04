# Chain of Responsibility

Group: behavioral

## Essence
A request passes through a sequence of handlers. Each decides for itself: handle it, enrich it, reject it or pass it on. The calling code does not know how many links the chain has or which ones. In Spring a chain is a `List<Handler>` of beans ordered by `@Order`. A new rule is a new `@Component`.

Variants:
- **all in turn** — validators collect violations, steps enrich the context (a pipeline);
- **the first that fits** — `supports(ctx)` + `findFirst` (choosing a policy or handler by a complex condition);
- **any can stop** — filters, access checks.

## Structure (participants)
- **Handler** — the handler interface: handle the request and/or pass it on (`OrderRule.check`, `FeePolicy.supports/fee`).
- **ConcreteHandler** — a concrete rule or step. Decides whether to handle the request, stop the chain or pass it on.
- **Client** — sends the request to the start of the chain and does not know its composition.
- Classically every handler holds a `next` reference. In Spring the chain is usually a `List<Handler>` with `@Order` and a loop, without explicit references.

```
Client ──▶ Handler1 ──▶ Handler2 ──▶ Handler3 ──▶ (nobody handled it → default / error)
             │             │
          handled       stopped
```

## Signs in Java/Spring code
- A long `validate()` of a dozen `if (…) throw`, and rules are added regularly.
- An `if/else if` on a combination of conditions (country + amount + customer type) choosing a policy.
- A sequence of import or processing steps is copied and edited in different places.
- Some rules use beans (limits from the DB, anti-fraud), so they cannot be simple annotations.

## When not to apply
- Simple constraints on DTO fields — Bean Validation (`@NotNull`, `@Size`, a custom `@Constraint`).
- 2–3 rules that do not change.

## After — validators
```java
public interface OrderRule {
    Optional<Violation> check(Order order);
}

@Component @Order(10)
class MaxAmountRule implements OrderRule {
    public Optional<Violation> check(Order o) {
        return o.total().compareTo(LIMIT) > 0 ? Optional.of(new Violation("amount.limit")) : Optional.empty();
    }
}

@Component @Order(20)
@RequiredArgsConstructor
class BlockedCustomerRule implements OrderRule {
    private final CustomerRepository customers;
    public Optional<Violation> check(Order o) { /* … */ }
}

@Service
@RequiredArgsConstructor
class OrderValidator {
    private final List<OrderRule> rules; // Spring sorts them by @Order

    void validate(Order order) {
        var violations = rules.stream().map(r -> r.check(order)).flatMap(Optional::stream).toList();
        if (!violations.isEmpty()) throw new OrderValidationException(violations);
    }
}
```

## After — the first handler that fits
```java
public interface FeePolicy {
    boolean supports(FeeContext ctx);
    Money fee(FeeContext ctx);
}

@Component @Order(Ordered.LOWEST_PRECEDENCE)   // the default policy goes last
class DefaultFeePolicy implements FeePolicy {
    public boolean supports(FeeContext ctx) { return true; }
    public Money fee(FeeContext ctx) { /* … */ }
}

@Service
@RequiredArgsConstructor
class FeeCalculator {
    private final List<FeePolicy> policies;

    Money fee(FeeContext ctx) {
        return policies.stream().filter(p -> p.supports(ctx)).findFirst()
                .orElseThrow(() -> new IllegalStateException("No fee policy for " + ctx))
                .fee(ctx);
    }
}
```

## Spring's ready-made chains — check them first
Servlet `Filter` / `OncePerRequestFilter`, `SecurityFilterChain`, `HandlerInterceptor`, `ClientHttpRequestInterceptor` (RestClient/RestTemplate), `ExchangeFilterFunction` (WebClient). If the task is cross-cutting HTTP processing, you do not need your own chain.

## Refactoring steps
1. A test on the current set of checks, including the order if it matters (the first error message).
2. A rule interface; move the rules out one at a time with an explicit `@Order`.
3. Replace the monolithic method with a pass over the `List`.

## Pitfalls
- Without `@Order` the order is not guaranteed. If `supports` conditions overlap, the result depends on bean registration order.
- Expensive rules (that hit the DB): decide explicitly whether to collect all violations or exit on the first. Put cheap rules earlier.
- A chain must not silently let through a request nobody handled: a default handler or an exception is needed.

## Pros and cons
**Pros**
- The sender does not depend on concrete receivers.
- Rules are added, removed and reordered independently (Open/Closed).
- One rule — one class, easy to test separately.

**Cons**
- A request may pass the chain unhandled unless a default handler is provided.
- The order is an implicit contract (`@Order`), and order mistakes are hard to notice.
- Harder to debug: the code does not show which link fired (logging is needed).
- Long chains with expensive links hurt performance.

## Related patterns
Decorator (always delegates further) · Composite (AND/OR rules in a tree) · Command (a request as an object passing through the chain) · Strategy (choosing by key instead of a condition).

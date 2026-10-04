# Strategy

Group: behavioral

## Essence
Every variant of an algorithm lives in its own class behind a common interface. The calling code works with the interface and does not know which implementation is chosen. In Spring strategies are beans, and a registry chooses by key. A new variant is a new `@Component`; existing code does not change.

## Structure (participants)
- **Context** — the class that needs the algorithm. Holds a reference to the strategy through the interface and delegates the work to it (in Spring — a service or a `PaymentHandlerRegistry` registry).
- **Strategy** — the common interface of all algorithm variants (`PaymentHandler`).
- **ConcreteStrategy** — implementations (`CardPaymentHandler`, `SbpPaymentHandler`). They do not know about each other.
- **Client** — chooses which strategy to plug in. In Spring the container creates the objects and a registry chooses by key.

```
Client ──chooses──▶ Context ─────────▶ «interface» Strategy
                                          ▲               ▲
                                  ConcreteStrategyA  ConcreteStrategyB
```
The context calls the interface method and does not know the concrete class. Changing the algorithm means plugging in another object; the context's code does not change.

## Signs in Java/Spring code
- A `switch`/`if` on a type (`PaymentMethod`, `provider`, `channel`), the branches are different business logic with their own dependencies.
- The same `switch` on the same enum repeats in several services (payment, refund, fee).
- A service injects 5 clients and uses only one per call, depending on the type.
- Variants are added regularly (visible in `git log`).

## When not to apply
- The branches are pure calculations without dependencies → `java-idioms/map-lookup.md` or `java-idioms/enum-with-behavior.md`.
- 2–3 stable variants in one place.
- A closed set of types while operations are added → `java-idioms/sealed-switch.md`.

## Before
```java
@Service
@RequiredArgsConstructor
class PaymentService {
    private final AcquiringClient acquiring;
    private final SbpClient sbp;
    private final CashRegister cashRegister;

    PaymentResult pay(PaymentRequest r) {
        switch (r.method()) {
            case CARD: return acquiring.charge(r.cardToken(), r.amount());
            case SBP:  return sbp.createQr(r.amount());
            case CASH: return cashRegister.open(r.amount());
            default: throw new IllegalArgumentException("Unknown " + r.method());
        }
    }
}
// and the same switch in RefundService, FeeCalculator ...
```

## After — option A (recommended): the key is an interface method, the registry is built from `List<…>`
```java
public interface PaymentHandler {
    PaymentMethod method();                 // the key is an enum, not a bean name
    PaymentResult pay(PaymentRequest request);
    RefundResult refund(RefundRequest request);
}

@Component
@RequiredArgsConstructor
class CardPaymentHandler implements PaymentHandler {
    private final AcquiringClient acquiring;

    @Override public PaymentMethod method() { return PaymentMethod.CARD; }
    @Override public PaymentResult pay(PaymentRequest r) { return acquiring.charge(r.cardToken(), r.amount()); }
    @Override public RefundResult refund(RefundRequest r) { /* … */ }
}

@Component
class PaymentHandlerRegistry {
    private final Map<PaymentMethod, PaymentHandler> handlers;

    PaymentHandlerRegistry(List<PaymentHandler> all) {
        this.handlers = all.stream().collect(Collectors.toMap(
                PaymentHandler::method,
                Function.identity(),
                (a, b) -> { throw new IllegalStateException("Duplicate PaymentHandler for " + a.method()
                        + ": " + a.getClass().getSimpleName() + ", " + b.getClass().getSimpleName()); },
                () -> new EnumMap<>(PaymentMethod.class)));

        // fail-fast: the application does not start if a handler was forgotten for an enum value
        var missing = Arrays.stream(PaymentMethod.values()).filter(m -> !handlers.containsKey(m)).toList();
        if (!missing.isEmpty()) throw new IllegalStateException("No PaymentHandler for " + missing);
    }

    PaymentHandler get(PaymentMethod method) {
        return handlers.get(method); // completeness checked at startup
    }
}

// the switch became:
registry.get(request.method()).pay(request);
```
What it gives: a new variant is one `@Component`; a forgotten handler or a duplicate key shows up at startup, not in production. If completeness is not needed (the keys are external strings), drop the `missing` check and throw a domain exception from `get` that maps to a 4xx.

## After — option B: `Map<String, Bean>` with bean names
Spring itself collects all implementations into a `Map<String, PaymentHandler>`, where the key is the bean name:
```java
@Component("CARD") class CardPaymentHandler implements PaymentHandler { … }
@Component("SBP")  class SbpPaymentHandler  implements PaymentHandler { … }

@Service
@RequiredArgsConstructor
class PaymentService {
    private final Map<String, PaymentHandler> handlers;

    PaymentResult pay(PaymentRequest r) {
        var handler = handlers.get(r.method().name());
        if (handler == null) throw new UnsupportedPaymentMethodException(r.method());
        return handler.pay(r);
    }
}
```
Weak spots worth naming in a review:
- The key is the bean name, an implicit contract. Without an explicit `@Component("CARD")` the bean name is the class name with a lowercase first letter, and renaming the class silently breaks the routing.
- Bean names are global: `@Component("CARD")` in two different registries (payment and delivery) causes a conflict at startup.
- No completeness or duplicate check: the error shows up only on the first request.

Option B is acceptable for external string keys if the bean names are set explicitly and there is a routing test. Otherwise prefer A.

## After — option C: choosing by a `supports(...)` condition
When the key is not one value but a condition (country + amount + customer type), use `supports(ctx)` + a `List` with `@Order`. That is already Chain of Responsibility, see `chain-of-responsibility.md`.

## Refactoring steps
1. A characterization test on the current behavior of every branch, including an unknown key.
2. Introduce the interface and the registry; the first implementation delegates to the old code.
3. Move the branches into implementations one at a time, running the tests after each.
4. Replace the `switch` with a registry call at every place grep found, and delete the old code.
5. A test: the context starts and all enum values are covered (or a unit test of the registry without Spring).

## Pitfalls
- Do not make a base abstract class with shared fields just for code reuse. Shared code is better moved into an injected helper.
- `@Transactional` on strategy methods works: the call goes through the proxy from the registry.
- The registry is easy to test without Spring: `new PaymentHandlerRegistry(List.of(new CardPaymentHandler(mock), …))`.
- A generic registry by message class: an explicit `Class<C> type()` method is more reliable than reflection on the generic parameter. CGLIB proxies need `AopUtils.getTargetClass`.

## Pros and cons
**Pros**
- A new variant is added without editing the context or the other variants (Open/Closed).
- Every algorithm is isolated: its own dependencies, its own tests.
- Algorithm-selection conditionals disappear from business code.
- The algorithm can be replaced at runtime or by configuration.

**Cons**
- More classes and indirection: the logic has to be found across implementations.
- Someone must know which key to choose by (the registry), and that is a new point of failure.
- For one-line variants without dependencies a lambda, a `Map` or an enum is simpler.
- A common interface sometimes forces passing data only some strategies need.

## Related patterns
State (a strategy that changes from inside) · Command (what to do, not how) · Abstract Factory (a strategy from a consistent family of objects) · Adapter (a strategy at the boundary with an external system) · Template Method (an alternative via inheritance).

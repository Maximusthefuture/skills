# Singleton

Group: creational

## Essence
The classic Singleton guarantees one instance of a class and gives a global access point to it (`getInstance()`). In a Spring application the container already solves this: beans are singleton-scoped by default and injected through the constructor. So **a hand-written Singleton in Spring code is almost always a smell**, and in a review it usually needs to be removed, not added.

## Structure (participants)
The classic variant:
- **Singleton** — a class with a private constructor, a static instance field and a static access method `getInstance()`. It manages its own lifecycle.
- **Client** — gets the instance through the global access point.

```
Singleton
  - static instance: Singleton
  - private Singleton()
  + static getInstance(): Singleton
```

In Spring the container gives the same single-instance guarantee, without a global access point:
```
Spring Container ──(one instance, singleton scope)──▶ Bean ──injected──▶ ClientA, ClientB
```

## Signs in Java/Spring code (find and remove)
- `public static X getInstance()`, `private static final X INSTANCE = new X()`.
- Static fields with mutable state, clients, caches, configuration (`static RestTemplate`, `static Map cache`).
- Static access to the container: `SpringContext.getBean(…)`, `ApplicationContextHolder` (a Service Locator).
- Utility classes that read configuration or go to the network from static methods.
- Tests are forced to reset global state or cannot replace a dependency.

## Why it hurts extensibility
- The dependency is hidden: the constructor does not show that the class uses `PricingRules.getInstance()`.
- The implementation cannot be replaced (another strategy, a fake in a test, another config per profile).
- Global mutable state is a source of races and flaky tests.

## When to keep it
- Library code without a DI container.
- Constants and stateless utilities with static methods (`StringUtils`, `Money.round`) — that is fine.
- An enum singleton for a truly global and immutable thing outside Spring.

## Before
```java
public final class PricingRules {
    private static PricingRules instance;
    private final Map<String, BigDecimal> rates;
    private PricingRules() { rates = loadFromFile("rates.json"); }
    public static synchronized PricingRules getInstance() {
        if (instance == null) instance = new PricingRules();
        return instance;
    }
}
// somewhere in a service:
var rate = PricingRules.getInstance().rateFor(country);
```

## After
```java
@ConfigurationProperties(prefix = "pricing")
public record PricingProperties(Map<String, BigDecimal> rates) {}

@Component
@RequiredArgsConstructor
class PricingRules {
    private final PricingProperties props;
    BigDecimal rateFor(String country) { … }
}

@Service
@RequiredArgsConstructor
class PriceService {
    private final PricingRules rules;   // the dependency is visible and replaceable
}
```
Outside Spring: an enum singleton (`enum Registry { INSTANCE; … }`) or the holder idiom (`private static class Holder { static final X I = new X(); }`), but passing the dependency explicitly is still better.

## Refactoring steps
1. `grep -rn "getInstance()\|static .* INSTANCE\|getBean(" src/main/java`.
2. Turn the class into a bean; state from files and constants — into `@ConfigurationProperties`.
3. Replace `getInstance()` calls with constructor injection; remove the static access.

## Pitfalls
- A Spring singleton ≠ thread-safe. Mutable fields in a bean are shared by all requests. Request state must not live in bean fields.
- Static context access is sometimes kept for non-Spring objects (JPA entities, enums). Passing the dependency as a method parameter is better.

## Pros and cons
**Pros (of the classic variant)**
- Guaranteed single instance.
- Lazy initialization.
- Access from anywhere.

**Cons**
- Global state and hidden dependencies: the client's constructor does not show them.
- Hard to test and to replace the implementation.
- Thread-safety problems with lazy initialization.
- Breaks SRP: the class manages both logic and its own lifecycle.
- In Spring the container gives all the pros without these cons, so a hand-written Singleton is almost always redundant here.

## Related patterns
Factory Method and Abstract Factory (often implemented as singleton beans) · Flyweight (many shared instances) · Facade (a facade bean in a single instance).

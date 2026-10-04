# Decorator

Group: structural

## Essence
A decorator wraps an object, implements the same interface, delegates the call inside and adds behavior before or after. Wrappers stack in layers (metrics → cache → retries → HTTP), and each layer knows nothing about the others. Behavior is added without changing the original class and without a subclass per combination.

## Structure (participants)
- **Component** — the common interface (`RateProvider`).
- **ConcreteComponent** — the base implementation doing the main work (`HttpRateProvider`).
- **Decorator** — implements Component, holds a reference to the wrapped Component and delegates the call to it.
- **ConcreteDecorator** — adds behavior before or after delegating (`CachingRateProvider`, `MeteredRateProvider`).
- **Client** — works with Component. In Spring a `@Configuration` with `@Primary` assembles the wrapper chain.

```
Client ──▶ MeteredDecorator ──▶ CachingDecorator ──▶ ConcreteComponent
              (all implement the same Component interface)
```

## Signs in Java/Spring code
- A business method mixed with cache, retries, logging, metrics, rate limiting.
- Subclasses for combinations: `CachingRateClient extends RateClient`, `RetryingCachingRateClient extends CachingRateClient`.
- You need to add behavior to a bean from a library or another module that cannot be changed.
- Layers must be switched on and off by configuration.

## When not to apply — check the ready-made tools first
Spring already makes decorators via proxies: `@Cacheable`, `@Retryable` (Spring Retry), Resilience4j (`@CircuitBreaker`, `@RateLimiter`, `@Bulkhead`), `@Timed` / `@Observed`, `@Transactional`. For HTTP — `ClientHttpRequestInterceptor` (RestClient/RestTemplate), `ExchangeFilterFunction` (WebClient). A hand-written decorator is needed when annotations are not enough: self-invocation, logic depending on the result, a bean from a library, a non-standard layer order.

## Before
```java
@Service
class RateService {
    private final Map<String, BigDecimal> cache = new ConcurrentHashMap<>();
    BigDecimal rate(Currency from, Currency to) {
        var key = from + "/" + to;
        var cached = cache.get(key);
        if (cached != null) return cached;
        long start = System.nanoTime();
        for (int i = 0; i < 3; i++) {
            try {
                var r = http.fetchRate(from, to);
                cache.put(key, r);
                metrics.record(System.nanoTime() - start);
                return r;
            } catch (IOException e) { sleep(200L * (i + 1)); }
        }
        throw new RateUnavailableException();
    }
}
```

## After
```java
public interface RateProvider { BigDecimal rate(Currency from, Currency to); }

@Component("httpRateProvider")
class HttpRateProvider implements RateProvider { /* HTTP only */ }

@RequiredArgsConstructor
class CachingRateProvider implements RateProvider {
    private final RateProvider delegate;
    private final Cache<String, BigDecimal> cache;          // Caffeine with a TTL and a size
    public BigDecimal rate(Currency from, Currency to) {
        return cache.get(from + "/" + to, k -> delegate.rate(from, to));
    }
}

@RequiredArgsConstructor
class MeteredRateProvider implements RateProvider {
    private final RateProvider delegate;
    private final Timer timer;
    public BigDecimal rate(Currency from, Currency to) {
        return timer.record(() -> delegate.rate(from, to));
    }
}

@Configuration
class RateProviderConfig {
    @Bean @Primary
    RateProvider rateProvider(@Qualifier("httpRateProvider") RateProvider http, MeterRegistry meters) {
        var cached = new CachingRateProvider(http,
                Caffeine.newBuilder().expireAfterWrite(Duration.ofMinutes(5)).maximumSize(1_000).build());
        return new MeteredRateProvider(cached, meters.timer("rates.lookup"));
    }
}
```
Clients inject `RateProvider` and get the assembled chain. A new layer is a new class and one line in the configuration.

## Refactoring steps
1. A test on the behavior: a cache hit, a retry after an error, the final exception.
2. Extract the interface; the "bare" implementation does only the main work.
3. Move every cross-cutting aspect into its own decorator or replace it with a ready annotation.
4. Assemble the chain in a `@Configuration` with `@Primary`.

## Pitfalls
- **Layer order matters.** Metrics outside the cache measure cache hits too, metrics inside measure only real calls. Retries outside and inside a circuit breaker behave differently.
- **Self-invocation:** proxy annotations do not fire when called from the same class. A hand-written decorator does not have this problem.
- **Bean ambiguity:** without `@Primary` or `@Qualifier` you get `NoUniqueBeanDefinitionException`, and a decorator may accidentally get itself injected.
- A decorator must keep the contract: the same exceptions and `null` semantics.

## Pros and cons
**Pros**
- Behavior is added without changing the original class and without subclasses.
- Layer combinations are assembled by configuration.
- One cross-cutting responsibility — one class (SRP).

**Cons**
- Wrapper order matters and is not obvious.
- Many small objects; a longer call stack when debugging.
- Removing a specific layer from the middle of the chain is awkward.
- Object identity is lost: the wrapper is a different object.

## Related patterns
Proxy (the same interface, but about access control) · Chain of Responsibility (a link may stop the chain) · Adapter (changes the interface, not the behavior) · Composite.

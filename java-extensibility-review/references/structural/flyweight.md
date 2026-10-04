# Flyweight

Group: structural

## Essence
When memory holds many objects whose state is mostly the same, that shared immutable state (intrinsic) is stored in one instance and shared. The unique (extrinsic) state is stored separately or passed into methods. This is a memory optimization, not an extensibility one. In a review it fits only when the problem is confirmed.

## Structure (participants)
- **Flyweight** — an immutable object with intrinsic (shared) state, the same for many contexts (`Category`).
- **Extrinsic state** — the external, unique state. Stored in the context or passed into methods (a row id, an amount).
- **FlyweightFactory** — a cache or pool: returns the existing instance by key or creates a new one (`CategoryFlyweights`).
- **Context / Client** — holds the extrinsic state and a reference to the shared flyweight (`SaleLine`).

```
Client ──get(key)──▶ FlyweightFactory ──cache──▶ Flyweight (one per key, shared)
Context { extrinsic: id, amount;  flyweight ──▶ Flyweight }
```

## Signs in Java/Spring code
- A heap dump or profiler shows millions of instances of one class with repeating values (identical strings, reference objects, styles).
- Processing big files or streams in memory: each of a million rows holds its own copy of reference data (currency, type, a category with a description).
- Mass creation of identical value objects in a hot loop (`new Currency("RUB", …)` on every iteration).
- OOM or long GC pauses during batch processing.

## When not to apply
- There is no profiling data — it is a premature optimization. A typical CRUD backend almost never needs it.
- The objects are mutable — they cannot be shared.

## What Java already has
`Integer.valueOf` / `Boolean.valueOf` (a cache), enums (the ideal flyweight), `Currency.getInstance`, `String` literals and `String.intern()` (with care), string deduplication in G1 (`-XX:+UseStringDeduplication`). First check whether replacing with an enum or a reference by id solves the problem.

## After
```java
public record Category(String code, String title, String description) {}   // immutable

@Component
class CategoryFlyweights {
    private final Cache<String, Category> cache = Caffeine.newBuilder().maximumSize(10_000).build();
    private final CategoryRepository repo;

    CategoryFlyweights(CategoryRepository repo) { this.repo = repo; }

    Category get(String code) {
        return cache.get(code, repo::loadByCode);   // one instance per code
    }
}

// when parsing a file of 5 million rows — a reference to a shared object, not a copy
record SaleLine(long id, BigDecimal amount, Category category) {}
```

## Steps
1. Confirm the problem: a heap histogram (`jcmd <pid> GC.class_histogram`), JFR, VisualVM.
2. Extract the immutable shared part, make a factory with a cache.
3. Measure again. No gain — roll back.

## Pitfalls
- An unbounded flyweight cache is a memory leak. Use Caffeine with a limit, or an enum.
- A shared object must be immutable, otherwise changing "one" row changes them all.
- Concurrent access to the factory: `ConcurrentHashMap.computeIfAbsent` or Caffeine, no hand-written `synchronized`.

## Pros and cons
**Pros**
- Memory savings with a huge number of similar objects.

**Cons**
- More complex code: state is split into intrinsic and extrinsic.
- CPU spent on cache lookups and passing extrinsic state.
- A strict immutability requirement for shared objects.
- Makes sense only when profiling has proven the problem.

## Related patterns
Factory Method (the flyweight factory) · Composite (shared tree leaves) · Singleton (one instance, not many shared ones).

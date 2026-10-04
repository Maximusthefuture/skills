# Java: correctness and concurrency

A checklist, not a list of "what must be found". Every item is a reason to look closer; it becomes a finding only with a concrete failure scenario.

## Null and Optional
- A new call of a method that may return null (`Map.get`, `findXxx` without Optional, third-party APIs) without a check.
- `Optional.get()` without `isPresent`; `Optional` in fields, parameters or as a serialized DTO value.
- The nullability of a return value or parameter changed — check all callers.
- Auto-unboxing `Integer`/`Long`/`Boolean` from null (`if (dto.getEnabled())`).

## Equality and collections
- `==` for `String`, `Long`, `Integer` outside the [-128..127] cache, `BigDecimal.equals` instead of `compareTo` (2.0 ≠ 2.00).
- `equals` overridden without `hashCode`; mutable fields in the `hashCode` of an object stored in a `HashSet`/as a `HashMap` key.
- JPA entities with Lombok `@Data`/`@EqualsAndHashCode` over all fields (lazy associations, recursion, hashCode changing after persist).
- Modifying a collection while iterating; `Arrays.asList`/`List.of` + `add` → `UnsupportedOperationException`.
- `subList`, `Collectors.toMap` without a merge function when duplicate keys are possible.

## Exceptions and resources
- An empty `catch`, `catch (Exception e)` that swallows, a lost cause (`throw new X(e.getMessage())` instead of `new X(msg, e)`).
- A checked exception wrapped so that the transaction rollback behavior changes (see spring-jpa.md).
- Resources (`InputStream`, `Connection`, `HttpClient` response) without try-with-resources.
- `InterruptedException` swallowed without `Thread.currentThread().interrupt()`.

## Numbers, time, strings
- Money in `double`/`float`; `BigDecimal` from a `double` (`new BigDecimal(0.1)`), division without a `RoundingMode`.
- `int` overflow when multiplying/summing (sizes, milliseconds).
- `LocalDateTime` where an instant is needed (`Instant`/`OffsetDateTime`); `LocalDate.now()` without a `Clock` in testable logic; the JVM default time zone.
- `String.format`/`toLowerCase` without a `Locale` for machine-readable strings.

## Concurrency
- Mutable fields in singleton beans (`@Service`, `@Component`, `@RestController`) without synchronization — every bean is shared by all requests.
- `SimpleDateFormat`, `HashMap`, `ArrayList` as fields shared between threads.
- check-then-act (`if (!map.containsKey(k)) map.put(...)`) instead of `computeIfAbsent`/atomic operations; the same in the DB (a uniqueness check without a constraint).
- `@Async`/`CompletableFuture.supplyAsync` without its own executor (the shared `ForkJoinPool`), losing the `SecurityContext`/MDC/transaction in another thread.
- Blocking calls in reactive code (WebFlux) or inside `synchronized` with virtual threads (pinning, Java 21).
- Unbounded queues and pools, `Executors.newCachedThreadPool` under load.

## Streams and APIs
- Side effects in `map`/`filter`, `parallelStream` on the shared pool in a web request.
- `stream().toList()` (immutable, Java 16+) where it is modified afterwards.
- A breaking change of a library module's public method (signature, exceptions, semantics) without accounting for callers.

## Logging
- String concatenation in logs on a hot path instead of `{}` parameters; `log.error(e.getMessage())` without a stack trace.
- Logging whole entities/DTOs (PII, tokens, lazy loading in `toString`).

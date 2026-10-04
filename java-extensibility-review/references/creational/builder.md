# Builder

Group: creational

## Essence
A complex object is assembled step by step through named methods, and only the final `build()` creates it, often immutable and validated. Instead of a 9-parameter constructor where two `String`s are easy to mix up, you get a readable assembly. A new optional parameter does not change the signature or every call site.

## Structure (participants)
- **Builder** — an object with step methods that set parts (`recipient(…)`, `template(…)`) and a final `build()`.
- **Product** — the created, usually immutable object (`Notification`).
- **Director** (optional) — knows typical step sequences. In Java it is usually static preset factories or a Test Data Builder (`anOrder().paid()`).
- **Client** — calls the steps and gets the result.

```
Client ──▶ Builder.a(…).b(…).c(…).build() ──▶ Product (validated, immutable)
Director ──sets a typical step order──▶ Builder
```

## Signs in Java/Spring code
- Constructors and methods with 5+ parameters, especially consecutive ones of the same type (`String, String, String`).
- Telescoping constructors (`Order(a)`, `Order(a, b)`, `Order(a, b, c)`…).
- Boolean flags in calls: `export(report, true, false, true)` — without an IDE it is unclear what each one means.
- The object is assembled with setters and exists in an inconsistent state for a while.
- Bulky creation of test data, repeated in every test.

## When not to apply
- 2–4 required parameters — a plain constructor or a `record`.
- The flag chooses an algorithm — that is already a Strategy (`../behavioral/strategy.md`).

## Solution options
**1. Boolean flags → separate methods or an enum:**
```java
// was: export(report, true, false)
exportDraft(report);
exportFinal(report);
// or
export(report, ExportMode.DRAFT);
```

**2. A set of options → a `record` with default factories:**
```java
public record ExportOptions(boolean includeHeader, Locale locale, ZoneId zone, int maxRows) {
    public static ExportOptions defaults() { return new ExportOptions(true, Locale.ROOT, ZoneOffset.UTC, 10_000); }
    public ExportOptions withLocale(Locale l) { return new ExportOptions(includeHeader, l, zone, maxRows); }
}
```

**3. A builder (Lombok, if the project has it):**
```java
@Builder(toBuilder = true)
public record Notification(
        @NonNull String recipient,
        @NonNull String template,
        Map<String, Object> params,
        Priority priority,
        Instant sendAfter) {

    public Notification {
        params = params == null ? Map.of() : Map.copyOf(params);
        priority = priority == null ? Priority.NORMAL : priority;
    }
}

var n = Notification.builder()
        .recipient(email)
        .template("order-shipped")
        .params(Map.of("orderId", id))
        .build();
```

**4. A hand-written builder with required parameters in the builder's constructor** — when `build()` without required fields must be impossible:
```java
public static Builder builder(String recipient, String template) { return new Builder(recipient, template); }
```

## Spring's builders — use them, not your own
`RestClient.builder()`, `WebClient.Builder` (an injectable bean configured via `WebClientCustomizer`), `UriComponentsBuilder`, `ResponseEntity.status(…).header(…).body(…)`, `MockMvcRequestBuilders`.

## Refactoring steps
1. Find constructors and methods with long parameter lists (`get_symbols_overview` + `find_symbol` with the body, or Grep).
2. Decide: separate methods, `record` options or a builder.
3. Add the new way of creating, migrate the calls, remove the old overloads.

## Pitfalls
- Lombok `@Builder` on a JPA entity: Hibernate needs a no-args constructor (`@NoArgsConstructor(access = PROTECTED)` + `@AllArgsConstructor`). Fields with initializers without `@Builder.Default` become `null`.
- A builder that allows calling `build()` without required fields. Check in `build()` or in the `record`'s compact constructor.
- A mutable builder kept in a field and reused across threads.
- A Test Data Builder (`anOrder().withStatus(PAID).build()`) is an excellent technique for tests, and it is worth proposing if tests duplicate object assembly.

## Pros and cons
**Pros**
- Readable creation of objects with many parameters.
- An immutable result and validation in one point (`build()`).
- A new optional parameter does not change existing calls.
- Reusable presets, especially in tests.

**Cons**
- Duplicated fields in the builder (without Lombok).
- `build()` can be called without required fields if that is not checked.
- Extra code for simple objects.

## Related patterns
Factory Method (the whole object in one call) · Abstract Factory · Prototype (`toBuilder()` — a copy with changes) · Composite (a builder for a tree).

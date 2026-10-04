# sealed + switch with pattern matching

Type: a Java 17/21 idiom, a modern alternative to Visitor and `instanceof` chains

## Essence
A closed hierarchy (`sealed interface … permits A, B, C`) of `record`s and a `switch` on the type without `default` — the compiler checks that all subtypes are handled. When a new type is added to `permits`, **every** such `switch` stops compiling. This is extensibility guaranteed by the compiler.

## Signs in Java/Spring code
- `instanceof` chains: `if (n instanceof Email e) … else if (n instanceof Sms s) …`.
- The set of subtypes is closed (your module controls it), while **operations** on it are added often: rendering, validation, mapping to a DTO, calculation.
- A Visitor on Java 21+.
- A `switch` on a discriminator field (`type`) followed by casts.

## Choosing between sealed + switch and Strategy (the expression problem)

| What is added more often | Choose | Why |
|---|---|---|
| New **variants** (providers, payment methods), few stable operations | Strategy / polymorphism | a new variant is a new class, nothing else is touched |
| New **operations** over a closed set of variants | sealed + `switch` | a new operation is one method with a `switch`, the data classes are not touched |
| Variants are added by other modules or teams (plugins) | Strategy | sealed requires all subtypes to be in one module or package |

Do not advise replacing a working sealed + `switch` with a Strategy (or the reverse) without determining which axis really changes.

## After (Java 21)
```java
public sealed interface Notification permits EmailNotification, SmsNotification, PushNotification {}
public record EmailNotification(String to, String subject, String body) implements Notification {}
public record SmsNotification(String phone, String text) implements Notification {}
public record PushNotification(String deviceToken, String title) implements Notification {}

String preview(Notification n) {
    return switch (n) {                     // no default: the compiler demands all subtypes be covered
        case EmailNotification e -> e.subject();
        case SmsNotification s   -> s.text();
        case PushNotification p  -> p.title();
    };
}

// record patterns and guards
String route(Notification n) {
    return switch (n) {
        case EmailNotification(var to, var subject, var body) when to.endsWith("@corp.example") -> "internal-smtp";
        case EmailNotification e -> "external-smtp";
        case SmsNotification s   -> "sms-gateway";
        case PushNotification p  -> "fcm";
    };
}
```

## Refactoring steps
1. Make sure Java ≥ 21 (on 17 pattern matching in `switch` is a preview). On 17 you can introduce `sealed` and `instanceof` patterns, but the compiler does not check `switch` completeness over types.
2. Make the hierarchy `sealed`, the subtypes `record` or `final`.
3. Replace the `instanceof` chains with `switch` expressions without `default`.

## Pitfalls
- `default ->` in a `switch` over a sealed type disables the completeness check. Flag it as a remark: such places can be found by searching for `default\s*->` next to `case [A-Z]\w* \w+ ->`.
- All subtypes must live in one module (JPMS) or, without modules, in one package.
- JPA entities and sealed do not combine well (Hibernate proxies are subclasses). Apply it to DTOs, events, commands and value objects.
- Jackson: (de)serializing a sealed hierarchy needs `@JsonTypeInfo` (`polymorphic-json.md`).

## Related patterns
Visitor (the classic analog) · Strategy (the opposite axis) · Composite (a sealed tree) · Command (a sealed set of commands).

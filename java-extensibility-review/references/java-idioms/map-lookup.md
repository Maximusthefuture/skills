# Map-lookup instead of if/else over values

Type: a Java idiom (table-driven code), a relative of Strategy

## Essence
If the branches of an `if/switch` only map a key to a value or a simple action, the logic is a table. A table is better written as a `Map` and read by key: a new variant is a new row, not a new branch.

## Signs in Java/Spring code
- `if (type.equals("CARD")) code = "01"; else if (type.equals("SBP")) code = "02"; …`
- A `switch` where every branch is `return CONSTANT` or a one-liner call.
- Branches of the same shape that differ only in values.

## When not to apply
- 2–3 branches that do not change. A `switch` expression over an enum reads just as well and the compiler checks its completeness.
- The branches have conditions more complex than equality (`amount > 1000 && vip`) → `../behavioral/chain-of-responsibility.md`.
- The branches are different logic with dependencies → `../behavioral/strategy.md`.

## Before
```java
String code;
if (type.equals("CARD")) code = "01";
else if (type.equals("SBP")) code = "02";
else if (type.equals("CASH")) code = "03";
else throw new IllegalArgumentException(type);
```

## After — a string key from outside
```java
private static final Map<String, String> CODES = Map.of(
        "CARD", "01",
        "SBP", "02",
        "CASH", "03");

String code = Optional.ofNullable(CODES.get(type))
        .orElseThrow(() -> new IllegalArgumentException("Unknown type: " + type));
```

## After — an enum key (better if the variants are known at compile time)
```java
private static final Map<PaymentType, String> CODES = new EnumMap<>(Map.of(
        PaymentType.CARD, "01",
        PaymentType.SBP, "02",
        PaymentType.CASH, "03"));
```
If the value is a property of the variant itself, it is even better to keep it as an enum field (`enum-with-behavior.md`): then it cannot be forgotten.

## After — branches with an action
```java
private final Map<ReportFormat, Function<Report, byte[]>> renderers = new EnumMap<>(Map.of(
        ReportFormat.PDF,  this::renderPdf,
        ReportFormat.CSV,  this::renderCsv,
        ReportFormat.XLSX, this::renderXlsx));

byte[] render(Report r, ReportFormat f) {
    return Objects.requireNonNull(renderers.get(f), () -> "No renderer for " + f).apply(r);
}
```
Values the business changes (codes, rates) are better moved from code into config (`configuration-over-code.md`).

## Pitfalls
- `Map.of` forbids `null` and duplicates and takes at most 10 pairs; beyond that you need `Map.ofEntries(entry(…), …)`.
- Explicit behavior for a missing key is mandatory. A silent `null` is worse than the original `else throw`.
- Initializing a field with `this::method` in a field initializer works, but in a Spring bean with complex dependencies fill the map in the constructor.
- Case and whitespace in external string keys: normalize the key (`toUpperCase(Locale.ROOT)`, `strip()`) once at the entry point.

## Related patterns
Enum with behavior · Strategy (branches with dependencies) · Configuration over code.

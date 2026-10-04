# Enum with behavior

Type: a Java idiom (constant-specific methods), a light form of Strategy / State

## Essence
Knowledge of a variant lives in the enum constant itself: fields (codes, coefficients, symbols) and behavior (an abstract method overridden by every constant, or a lambda in the constructor). Repeated `switch (type)` blocks disappear from the code. When a new constant is added, the compiler demands the abstract method be implemented, and no place can be forgotten.

## Signs in Java/Spring code
- The same `switch` over an enum in 2+ places, branches are calculations without external dependencies (coefficients, formats, rounding rules, code mapping).
- Parallel `Map<MyEnum, X>` in different classes.
- A `MyEnumUtils` utility class with static methods that `switch` over the constants.

## When not to apply
- The behavior needs beans (repositories, clients). An enum is not a Spring component. Dragging dependencies into it through static setters or `ApplicationContext` is an anti-pattern. You need a Strategy (`../behavioral/strategy.md`) with the enum as the key.
- The behavior is specific to one place of use — then it is knowledge of that place, not of the variant.

## Before
```java
// in PriceService, CartService, InvoiceService:
switch (discount.type()) {
    case PERCENT -> price.multiply(ONE.subtract(discount.value().movePointLeft(2)));
    case FIXED   -> price.subtract(discount.value()).max(ZERO);
}
```

## After — an abstract method
```java
public enum DiscountType {
    PERCENT("%") {
        @Override public BigDecimal apply(BigDecimal price, BigDecimal value) {
            return price.multiply(BigDecimal.ONE.subtract(value.movePointLeft(2)));
        }
    },
    FIXED("₽") {
        @Override public BigDecimal apply(BigDecimal price, BigDecimal value) {
            return price.subtract(value).max(BigDecimal.ZERO);
        }
    };

    private final String symbol;
    DiscountType(String symbol) { this.symbol = symbol; }
    public String symbol() { return symbol; }

    public abstract BigDecimal apply(BigDecimal price, BigDecimal value);
}

// usage
var discounted = discount.type().apply(price, discount.value());
```

## After — shorter, with a lambda
```java
public enum DiscountType {
    PERCENT("%", (p, v) -> p.multiply(BigDecimal.ONE.subtract(v.movePointLeft(2)))),
    FIXED("₽",   (p, v) -> p.subtract(v).max(BigDecimal.ZERO));

    private final String symbol;
    private final BinaryOperator<BigDecimal> fn;

    DiscountType(String symbol, BinaryOperator<BigDecimal> fn) { this.symbol = symbol; this.fn = fn; }
    public BigDecimal apply(BigDecimal price, BigDecimal value) { return fn.apply(price, value); }
}
```

## Refactoring steps
1. Find all `switch` blocks over the enum: `grep -rn "switch (.*getType())\|case PERCENT" src/main/java`.
2. A parameterized test over all constants (`@EnumSource`).
3. Move the behavior into the enum, replace the `switch` with a method call.

## Pitfalls
- The enum is stored in the DB (`@Enumerated(STRING)`) or goes out through an API: adding behavior is safe, renaming constants is not. `@Enumerated(ORDINAL)` breaks even from reordering.
- Do not overload the enum: if a constant has 6 methods and 4 fields, it needs a separate class.

## Related patterns
Map-lookup · Strategy (behavior with dependencies) · State (enum states with transitions) · sealed-switch (if the "variants" are different data types).

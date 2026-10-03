# Enum с поведением

Тип: Java-идиома (constant-specific methods), лёгкая форма Strategy / State

## Суть
Знание о варианте живёт в самой константе enum: поля (коды, коэффициенты, символы) и поведение (абстрактный метод, переопределённый каждой константой, или лямбда в конструкторе). Повторяющиеся `switch (type)` по коду исчезают. При добавлении новой константы компилятор требует реализовать абстрактный метод, и ни одно место нельзя забыть.

## Признаки в Java/Spring коде
- Один и тот же `switch` по enum в 2+ местах, ветки — вычисления без внешних зависимостей (коэффициенты, форматы, правила округления, маппинг кодов).
- Параллельные `Map<MyEnum, X>` в разных классах.
- Утилитный класс `MyEnumUtils` со статическими методами `switch` по константам.

## Когда не применять
- Поведению нужны бины (репозитории, клиенты). Enum — не Spring-компонент. Тащить в него зависимости через статические сеттеры или `ApplicationContext` — антипаттерн. Нужна Strategy (`../behavioral/strategy.md`) с enum в роли ключа.
- Поведение специфично для одного места использования — тогда это знание того места, а не варианта.

## До
```java
// в PriceService, CartService, InvoiceService:
switch (discount.type()) {
    case PERCENT -> price.multiply(ONE.subtract(discount.value().movePointLeft(2)));
    case FIXED   -> price.subtract(discount.value()).max(ZERO);
}
```

## После — абстрактный метод
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

// использование
var discounted = discount.type().apply(price, discount.value());
```

## После — короче, через лямбду
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

## Шаги рефакторинга
1. Найти все `switch` по enum: `grep -rn "switch (.*getType())\|case PERCENT" src/main/java`.
2. Параметризованный тест по всем константам (`@EnumSource`).
3. Перенести поведение в enum, заменить `switch` вызовом метода.

## Подводные камни
- Enum хранится в БД (`@Enumerated(STRING)`) или уходит в API: добавлять поведение безопасно, переименовывать константы — нет. `@Enumerated(ORDINAL)` ломается даже от перестановки.
- Не перегружай enum: если у константы 6 методов и 4 поля, ей нужен отдельный класс.

## Связанные паттерны
Map-lookup · Strategy (поведение с зависимостями) · State (enum-состояния с переходами) · sealed-switch (если «варианты» — разные типы данных).

# Composite (Компоновщик)

Группа: структурный

## Суть
Объекты собираются в дерево, и лист и группа реализуют один интерфейс. Клиент вызывает `evaluate()` / `price()` / `render()` у корня и не различает, лист перед ним или группа: группа сама делегирует детям и агрегирует результат.

## Структура (участники)
- **Component** — общий интерфейс для листьев и групп (`Rule.matches`, `PriceItem.price`).
- **Leaf** — конечный элемент без детей (`MinAmount`, `Product`).
- **Composite** — группа: хранит детей типа Component, делегирует им операцию и агрегирует результат (`AllOf`, `Bundle`).
- **Client** — работает с любым узлом через Component и не различает лист и группу.

```
            «interface» Component
              operation()
             ▲            ▲
           Leaf        Composite ──children──▶ Component*
                        operation() = агрегировать(children.operation())
```

## Признаки в Java/Spring коде
- Рекурсия с `if (node instanceof Group g) … else if (node instanceof Item i)` в нескольких местах.
- Вложенные циклы под фиксированную глубину (`for category → for sub → for subsub`), ломающиеся на четвёртом уровне.
- Правила с комбинациями AND/OR/NOT, записанные кодом с `&&`/`||`, которые хочется хранить в конфиге или БД.
- Бандлы и комплекты товаров с составной ценой, оргструктура, группы прав, меню.

## Когда не применять
- Структура плоская, или глубина строго фиксирована и мала.
- Все элементы одного типа — хватит обычного списка.

## После — дерево правил
```java
public sealed interface Rule permits AllOf, AnyOf, Not, MinAmount, CustomerSegment {
    boolean matches(OrderContext ctx);
}
public record AllOf(List<Rule> rules) implements Rule {
    public boolean matches(OrderContext ctx) { return rules.stream().allMatch(r -> r.matches(ctx)); }
}
public record AnyOf(List<Rule> rules) implements Rule {
    public boolean matches(OrderContext ctx) { return rules.stream().anyMatch(r -> r.matches(ctx)); }
}
public record Not(Rule rule) implements Rule {
    public boolean matches(OrderContext ctx) { return !rule.matches(ctx); }
}
public record MinAmount(BigDecimal min) implements Rule {
    public boolean matches(OrderContext ctx) { return ctx.total().compareTo(min) >= 0; }
}
public record CustomerSegment(String segment) implements Rule {
    public boolean matches(OrderContext ctx) { return ctx.segment().equals(segment); }
}

// "сумма ≥ 5000 И (VIP ИЛИ НЕ новый клиент)"
Rule promo = new AllOf(List.of(
        new MinAmount(new BigDecimal("5000")),
        new AnyOf(List.of(new CustomerSegment("VIP"), new Not(new CustomerSegment("NEW"))))));
```
С `@JsonTypeInfo` (`../java-idioms/polymorphic-json.md`) такое дерево хранится в БД или конфиге как JSON, и новые акции заводятся без деплоя. Встроенные Composite в Java/Spring: `Predicate.and/or/negate`, `Specification.allOf/anyOf`, `CompositeMeterRegistry`.

## После — составная цена
```java
public sealed interface PriceItem permits Product, Bundle {
    Money price();
}
public record Product(String sku, Money price) implements PriceItem {}
public record Bundle(String name, List<PriceItem> items, Percent discount) implements PriceItem {
    public Money price() {
        return items.stream().map(PriceItem::price).reduce(Money.ZERO, Money::plus).discountBy(discount);
    }
}
```

## Шаги рефакторинга
1. Тесты на текущие расчёты по реальным примерам деревьев.
2. Ввести общий интерфейс; лист и группа его реализуют; группа делегирует детям.
3. Заменить рекурсию с `instanceof` вызовом метода корня.

## Подводные камни
- Хранение деревьев в JPA: adjacency list + рекурсивный CTE или materialized path. Ленивый обход дерева сущностей — гарантированный N+1.
- Циклы в графе (группа содержит саму себя) — бесконечная рекурсия. Валидируй при построении.
- Глубокие деревья и рекурсия — переполнение стека. Для больших деревьев нужен итеративный обход.

## Плюсы и минусы
**Плюсы**
- Единообразная работа с деревом любой глубины.
- Новые типы узлов добавляются без изменения клиента (Open/Closed).
- Рекурсивные структуры (правила, бандлы, категории) выражаются естественно.

**Минусы**
- Общий интерфейс может быть слишком общим: операции, бессмысленные для листа.
- Трудно ограничить, какие узлы где допустимы (проверки переносятся в рантайм).
- Глубокие деревья: рекурсия, производительность, хранение в БД.

## Связанные паттерны
Visitor и sealed-switch (операции над деревом) · Iterator (обход дерева) · Specification (Composite для запросов) · Chain of Responsibility.

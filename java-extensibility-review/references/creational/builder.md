# Builder (Строитель)

Группа: порождающий

## Суть
Сложный объект собирается пошагово через именованные методы, и только в конце `build()` создаёт его, часто неизменяемым и проверенным. Вместо конструктора на 9 параметров, в котором легко перепутать два `String`, получается читаемая сборка. Новый необязательный параметр не меняет сигнатуру и все места вызова.

## Структура (участники)
- **Builder** — объект с методами-шагами установки частей (`recipient(…)`, `template(…)`) и финальным `build()`.
- **Product** — создаваемый, обычно неизменяемый объект (`Notification`).
- **Director** (необязателен) — знает типовые последовательности шагов. В Java обычно это статические фабрики-пресеты или Test Data Builder (`anOrder().paid()`).
- **Client** — вызывает шаги и получает результат.

```
Client ──▶ Builder.a(…).b(…).c(…).build() ──▶ Product (проверенный, неизменяемый)
Director ──задаёт типовой порядок шагов──▶ Builder
```

## Признаки в Java/Spring коде
- Конструкторы и методы на 5+ параметров, особенно подряд идущие однотипные (`String, String, String`).
- Телескопические конструкторы (`Order(a)`, `Order(a, b)`, `Order(a, b, c)`…).
- Boolean-флаги в вызовах: `export(report, true, false, true)` — без IDE непонятно, что значит каждый.
- Объект собирают сеттерами, и он какое-то время существует в несогласованном состоянии.
- Громоздкое создание тестовых данных, повторяющееся в каждом тесте.

## Когда не применять
- 2–4 обязательных параметра — обычный конструктор или `record`.
- Флаг выбирает алгоритм — это уже Strategy (`../behavioral/strategy.md`).

## Варианты решения
**1. Boolean-флаги → отдельные методы или enum:**
```java
// было: export(report, true, false)
exportDraft(report);
exportFinal(report);
// или
export(report, ExportMode.DRAFT);
```

**2. Набор опций → `record` с фабриками по умолчанию:**
```java
public record ExportOptions(boolean includeHeader, Locale locale, ZoneId zone, int maxRows) {
    public static ExportOptions defaults() { return new ExportOptions(true, Locale.ROOT, ZoneOffset.UTC, 10_000); }
    public ExportOptions withLocale(Locale l) { return new ExportOptions(includeHeader, l, zone, maxRows); }
}
```

**3. Builder (Lombok, если он есть в проекте):**
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

**4. Ручной builder с обязательными параметрами в конструкторе builder-а** — когда нельзя допустить `build()` без обязательных полей:
```java
public static Builder builder(String recipient, String template) { return new Builder(recipient, template); }
```

## Builder-ы Spring — используй их, а не свои
`RestClient.builder()`, `WebClient.Builder` (внедряемый бин, который настраивается через `WebClientCustomizer`), `UriComponentsBuilder`, `ResponseEntity.status(…).header(…).body(…)`, `MockMvcRequestBuilders`.

## Шаги рефакторинга
1. Найти конструкторы и методы с длинными списками параметров (`get_symbols_overview` + `find_symbol` с телом, или Grep).
2. Решить: отдельные методы, `record`-опции или builder.
3. Добавить новый способ создания, перевести вызовы, удалить старые перегрузки.

## Подводные камни
- Lombok `@Builder` на JPA-сущности: Hibernate нужен конструктор без аргументов (`@NoArgsConstructor(access = PROTECTED)` + `@AllArgsConstructor`). Поля с инициализаторами без `@Builder.Default` становятся `null`.
- Builder, который позволяет вызвать `build()` без обязательных полей. Проверяй в `build()` или в компактном конструкторе `record`.
- Изменяемый builder, сохранённый в поле и переиспользуемый между потоками.
- Test Data Builder (`anOrder().withStatus(PAID).build()`) — отличный приём для тестов, и его стоит предлагать, если тесты дублируют сборку объектов.

## Плюсы и минусы
**Плюсы**
- Читаемое создание объектов с большим числом параметров.
- Неизменяемый результат и валидация в одной точке (`build()`).
- Новый необязательный параметр не меняет существующие вызовы.
- Переиспользуемые пресеты, особенно в тестах.

**Минусы**
- Дублирование полей в builder-е (если без Lombok).
- Можно вызвать `build()` без обязательных полей, если это не проверяется.
- Для простых объектов — лишний код.

## Связанные паттерны
Factory Method (объект целиком за один вызов) · Abstract Factory · Prototype (`toBuilder()` — копия с изменениями) · Composite (builder для дерева).

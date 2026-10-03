# Chain of Responsibility (Цепочка обязанностей)

Группа: поведенческий

## Суть
Запрос проходит через последовательность обработчиков. Каждый решает сам: обработать, дополнить, отказать или передать дальше. Вызывающий код не знает, сколько звеньев в цепочке и какие они. В Spring цепочка — это `List<Handler>` бинов, упорядоченный `@Order`. Новое правило — новый `@Component`.

Варианты:
- **все по очереди** — валидаторы собирают нарушения, шаги обогащают контекст (pipeline);
- **первый подходящий** — `supports(ctx)` + `findFirst` (выбор политики или обработчика по сложному условию);
- **любой может прервать** — фильтры, проверки доступа.

## Структура (участники)
- **Handler** — интерфейс обработчика: обработать запрос и/или передать дальше (`OrderRule.check`, `FeePolicy.supports/fee`).
- **ConcreteHandler** — конкретное правило или шаг. Решает, обработать ли запрос, прервать ли цепочку, передать ли дальше.
- **Client** — отправляет запрос в начало цепочки и не знает её состав.
- Классически каждый обработчик хранит ссылку `next`. В Spring цепочку обычно задаёт `List<Handler>` с `@Order` и цикл, без явных ссылок.

```
Client ──▶ Handler1 ──▶ Handler2 ──▶ Handler3 ──▶ (никто не обработал → default / ошибка)
             │             │
          обработал     прервал
```

## Признаки в Java/Spring коде
- Длинный `validate()` на десяток `if (…) throw`, и правила регулярно добавляются.
- `if/else if` по сочетанию условий (страна + сумма + тип клиента), выбирающий политику.
- Последовательность шагов импорта или обработки копируется и редактируется в разных местах.
- Часть правил использует бины (лимиты из БД, антифрод), поэтому их нельзя оформить простыми аннотациями.

## Когда не применять
- Простые ограничения на поля DTO — Bean Validation (`@NotNull`, `@Size`, кастомный `@Constraint`).
- Правил 2–3, и они не меняются.

## После — валидаторы
```java
public interface OrderRule {
    Optional<Violation> check(Order order);
}

@Component @Order(10)
class MaxAmountRule implements OrderRule {
    public Optional<Violation> check(Order o) {
        return o.total().compareTo(LIMIT) > 0 ? Optional.of(new Violation("amount.limit")) : Optional.empty();
    }
}

@Component @Order(20)
@RequiredArgsConstructor
class BlockedCustomerRule implements OrderRule {
    private final CustomerRepository customers;
    public Optional<Violation> check(Order o) { /* … */ }
}

@Service
@RequiredArgsConstructor
class OrderValidator {
    private final List<OrderRule> rules; // Spring отсортирует по @Order

    void validate(Order order) {
        var violations = rules.stream().map(r -> r.check(order)).flatMap(Optional::stream).toList();
        if (!violations.isEmpty()) throw new OrderValidationException(violations);
    }
}
```

## После — первый подходящий обработчик
```java
public interface FeePolicy {
    boolean supports(FeeContext ctx);
    Money fee(FeeContext ctx);
}

@Component @Order(Ordered.LOWEST_PRECEDENCE)   // политика по умолчанию — последней
class DefaultFeePolicy implements FeePolicy {
    public boolean supports(FeeContext ctx) { return true; }
    public Money fee(FeeContext ctx) { /* … */ }
}

@Service
@RequiredArgsConstructor
class FeeCalculator {
    private final List<FeePolicy> policies;

    Money fee(FeeContext ctx) {
        return policies.stream().filter(p -> p.supports(ctx)).findFirst()
                .orElseThrow(() -> new IllegalStateException("No fee policy for " + ctx))
                .fee(ctx);
    }
}
```

## Готовые цепочки Spring — сначала проверь их
Servlet `Filter` / `OncePerRequestFilter`, `SecurityFilterChain`, `HandlerInterceptor`, `ClientHttpRequestInterceptor` (RestClient/RestTemplate), `ExchangeFilterFunction` (WebClient). Если задача — сквозная обработка HTTP, своя цепочка не нужна.

## Шаги рефакторинга
1. Тест на текущий набор проверок, включая порядок, если он важен (первое сообщение об ошибке).
2. Интерфейс правила; вынести правила по одному с явным `@Order`.
3. Заменить монолитный метод проходом по `List`.

## Подводные камни
- Без `@Order` порядок не гарантирован. Если условия `supports` пересекаются, результат зависит от порядка регистрации бинов.
- Дорогие правила (ходят в БД): реши явно, собирать все нарушения или выходить на первом. Дешёвые правила ставь раньше.
- Цепочка не должна молча пропускать запрос, который никто не обработал: нужен обработчик по умолчанию или исключение.

## Плюсы и минусы
**Плюсы**
- Отправитель не зависит от конкретных получателей.
- Правила добавляются, удаляются и переставляются независимо (Open/Closed).
- Одно правило — один класс, легко тестировать отдельно.

**Минусы**
- Запрос может пройти цепочку необработанным, если не предусмотреть обработчик по умолчанию.
- Порядок — неявный контракт (`@Order`), и ошибки порядка трудно заметить.
- Сложнее отлаживать: по коду не видно, какое звено сработало (нужно логирование).
- Длинные цепочки с дорогими звеньями бьют по производительности.

## Связанные паттерны
Decorator (всегда делегирует дальше) · Composite (правила AND/OR в дереве) · Command (запрос как объект, идущий по цепочке) · Strategy (выбор по ключу вместо условия).

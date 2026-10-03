# Strategy (Стратегия)

Группа: поведенческий

## Суть
Каждый вариант алгоритма лежит в своём классе за общим интерфейсом. Вызывающий код работает с интерфейсом и не знает, какая реализация выбрана. В Spring стратегии — это бины, а выбор делает реестр по ключу. Новый вариант — новый `@Component`, существующий код не меняется.

## Структура (участники)
- **Context** — класс, которому нужен алгоритм. Хранит ссылку на стратегию через интерфейс и делегирует ей работу (в Spring — сервис или реестр `PaymentHandlerRegistry`).
- **Strategy** — общий интерфейс всех вариантов алгоритма (`PaymentHandler`).
- **ConcreteStrategy** — реализации (`CardPaymentHandler`, `SbpPaymentHandler`). Не знают друг о друге.
- **Client** — выбирает, какую стратегию подставить. В Spring объекты создаёт контейнер, а выбор по ключу делает реестр.

```
Client ──выбирает──▶ Context ─────────▶ «interface» Strategy
                                          ▲               ▲
                                  ConcreteStrategyA  ConcreteStrategyB
```
Контекст вызывает метод интерфейса и не знает конкретный класс. Смена алгоритма — подстановка другого объекта, код контекста не меняется.

## Признаки в Java/Spring коде
- `switch`/`if` по типу (`PaymentMethod`, `provider`, `channel`), ветки — разная бизнес-логика со своими зависимостями.
- Тот же `switch` по тому же enum повторяется в нескольких сервисах (оплата, возврат, комиссия).
- Сервис внедряет 5 клиентов, а в каждом вызове использует только один, в зависимости от типа.
- Варианты регулярно добавляются (видно по `git log`).

## Когда не применять
- Ветки — чистые вычисления без зависимостей → `java-idioms/map-lookup.md` или `java-idioms/enum-with-behavior.md`.
- 2–3 стабильных варианта в одном месте.
- Закрытый набор типов, а добавляются операции → `java-idioms/sealed-switch.md`.

## До
```java
@Service
@RequiredArgsConstructor
class PaymentService {
    private final AcquiringClient acquiring;
    private final SbpClient sbp;
    private final CashRegister cashRegister;

    PaymentResult pay(PaymentRequest r) {
        switch (r.method()) {
            case CARD: return acquiring.charge(r.cardToken(), r.amount());
            case SBP:  return sbp.createQr(r.amount());
            case CASH: return cashRegister.open(r.amount());
            default: throw new IllegalArgumentException("Unknown " + r.method());
        }
    }
}
// и такой же switch в RefundService, FeeCalculator ...
```

## После — вариант A (рекомендуемый): ключ — метод интерфейса, реестр из `List<…>`
```java
public interface PaymentHandler {
    PaymentMethod method();                 // ключ — enum, а не имя бина
    PaymentResult pay(PaymentRequest request);
    RefundResult refund(RefundRequest request);
}

@Component
@RequiredArgsConstructor
class CardPaymentHandler implements PaymentHandler {
    private final AcquiringClient acquiring;

    @Override public PaymentMethod method() { return PaymentMethod.CARD; }
    @Override public PaymentResult pay(PaymentRequest r) { return acquiring.charge(r.cardToken(), r.amount()); }
    @Override public RefundResult refund(RefundRequest r) { /* … */ }
}

@Component
class PaymentHandlerRegistry {
    private final Map<PaymentMethod, PaymentHandler> handlers;

    PaymentHandlerRegistry(List<PaymentHandler> all) {
        this.handlers = all.stream().collect(Collectors.toMap(
                PaymentHandler::method,
                Function.identity(),
                (a, b) -> { throw new IllegalStateException("Duplicate PaymentHandler for " + a.method()
                        + ": " + a.getClass().getSimpleName() + ", " + b.getClass().getSimpleName()); },
                () -> new EnumMap<>(PaymentMethod.class)));

        // fail-fast: приложение не стартует, если для значения enum забыли написать обработчик
        var missing = Arrays.stream(PaymentMethod.values()).filter(m -> !handlers.containsKey(m)).toList();
        if (!missing.isEmpty()) throw new IllegalStateException("No PaymentHandler for " + missing);
    }

    PaymentHandler get(PaymentMethod method) {
        return handlers.get(method); // полнота проверена при старте
    }
}

// было switch, стало:
registry.get(request.method()).pay(request);
```
Что это даёт: новый вариант — один `@Component`; забытый обработчик или дубликат ключа видны при старте, а не в проде. Если полнота не нужна (ключи — внешние строки), убери проверку `missing`, а в `get` бросай доменное исключение, которое мапится в 4xx.

## После — вариант B: `Map<String, Bean>` с именами бинов
Spring сам соберёт все реализации в `Map<String, PaymentHandler>`, где ключ — имя бина:
```java
@Component("CARD") class CardPaymentHandler implements PaymentHandler { … }
@Component("SBP")  class SbpPaymentHandler  implements PaymentHandler { … }

@Service
@RequiredArgsConstructor
class PaymentService {
    private final Map<String, PaymentHandler> handlers;

    PaymentResult pay(PaymentRequest r) {
        var handler = handlers.get(r.method().name());
        if (handler == null) throw new UnsupportedPaymentMethodException(r.method());
        return handler.pay(r);
    }
}
```
Слабые места, которые стоит назвать в ревью:
- Ключ — имя бина, это неявный контракт. Без явного `@Component("CARD")` имя бина — имя класса с маленькой буквы, и переименование класса тихо ломает маршрутизацию.
- Имена бинов глобальны: `@Component("CARD")` в двух разных реестрах (оплата и доставка) вызовет конфликт при старте.
- Нет проверки полноты и дубликатов: ошибка появится только на первом запросе.

Вариант B приемлем для внешних строковых ключей, если имена бинов заданы явно и есть тест на маршрутизацию. В остальных случаях предпочтителен A.

## После — вариант C: выбор по условию `supports(...)`
Когда ключ не один, а условие (страна + сумма + тип клиента), используй `supports(ctx)` + `List` с `@Order`. Это уже Chain of Responsibility, см. `chain-of-responsibility.md`.

## Шаги рефакторинга
1. Характеризационный тест на текущее поведение каждой ветки, включая неизвестный ключ.
2. Ввести интерфейс и реестр; первая реализация делегирует в старый код.
3. Переносить ветки в реализации по одной, после каждой прогоняя тесты.
4. Заменить `switch` вызовом реестра во всех местах, найденных grep-ом, и удалить старый код.
5. Тест: контекст поднимается и все значения enum покрыты (или unit-тест реестра без Spring).

## Подводные камни
- Не делай базовый абстрактный класс с общими полями только ради переиспользования кода. Общий код лучше вынести во внедряемый helper.
- `@Transactional` на методах стратегии работает: вызов идёт через прокси из реестра.
- Реестр легко тестировать без Spring: `new PaymentHandlerRegistry(List.of(new CardPaymentHandler(mock), …))`.
- Generic-реестр по классу сообщения: явный метод `Class<C> type()` надёжнее рефлексии по generic-параметру. Для CGLIB-прокси нужен `AopUtils.getTargetClass`.

## Плюсы и минусы
**Плюсы**
- Новый вариант добавляется без правки контекста и других вариантов (Open/Closed).
- Каждый алгоритм изолирован: свои зависимости, свои тесты.
- Условные операторы выбора алгоритма исчезают из бизнес-кода.
- Алгоритм можно заменить в рантайме или конфигурацией.

**Минусы**
- Больше классов и косвенности: логику приходится искать по реализациям.
- Кто-то должен знать, по какому ключу выбирать (реестр), и это новая точка отказа.
- Для однострочных вариантов без зависимостей лямбда, `Map` или enum проще.
- Общий интерфейс иногда заставляет передавать данные, нужные только части стратегий.

## Связанные паттерны
State (стратегия, которая меняется изнутри) · Command (что сделать, а не как) · Abstract Factory (стратегия из согласованного семейства объектов) · Adapter (стратегия на границе с внешней системой) · Template Method (альтернатива через наследование).

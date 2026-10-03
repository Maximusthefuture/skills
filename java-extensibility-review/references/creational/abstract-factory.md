# Abstract Factory (Абстрактная фабрика)

Группа: порождающий

## Суть
Абстрактная фабрика создаёт **семейство** связанных объектов, которые должны работать вместе. Клиент получает одну фабрику (например, «всё для провайдера X») и не может случайно смешать части разных семейств. Новое семейство — новая реализация фабрики.

## Структура (участники)
- **AbstractFactory** — интерфейс с методами получения каждого продукта семейства (`PaymentProviderKit`: `client()`, `mapper()`, `webhookVerifier()`).
- **ConcreteFactory** — одна реализация на семейство (`StripeKit`, `YooKassaKit`).
- **AbstractProduct** — интерфейсы видов продуктов (`PaymentClient`, `PaymentMapper`).
- **ConcreteProduct** — продукты конкретного семейства. Совместимы только между собой.
- **Client** — работает только с абстракциями и получает всё семейство из одной фабрики.

```
«interface» AbstractFactory: createA(), createB()
        ▲                         ▲
  StripeFactory             YooKassaFactory
   → StripeA, StripeB         → YooA, YooB
```

## Признаки в Java/Spring коде
- Несколько `switch (provider)` / `switch (country)` / `switch (tenant)` в разных местах выбирают объекты, которые должны совпадать: клиент API, маппер ответов, проверка подписи вебхука, формат номера документа.
- Возможна ошибка «клиент провайдера A + маппер провайдера B».
- Подключение нового провайдера или страны требует правок в 4–5 местах.
- Мультитенантность или мультирегиональность с наборами реализаций на регион.

## Когда не применять
- На один деплой активно ровно одно семейство → `@Profile` / `@ConditionalOnProperty` на `@Configuration`: контейнер Spring сам работает как абстрактная фабрика.
- «Семейство» из одного объекта → Strategy.
- Набор видов продуктов часто меняется: добавление нового вида меняет интерфейс фабрики и все реализации.

## До
```java
PaymentClient client = switch (provider) { case STRIPE -> stripeClient; case YOOKASSA -> yooClient; };
// … в другом сервисе
PaymentMapper mapper = switch (provider) { case STRIPE -> new StripeMapper(); case YOOKASSA -> new YooMapper(); };
// … в контроллере вебхуков
WebhookVerifier verifier = switch (provider) { … };
```

## После — семейство как один бин
```java
public interface PaymentProviderKit {
    Provider provider();
    PaymentClient client();
    PaymentMapper mapper();
    WebhookVerifier webhookVerifier();
}

@Component
@RequiredArgsConstructor
class StripeKit implements PaymentProviderKit {
    private final StripeClient client;
    private final StripeMapper mapper;
    private final StripeWebhookVerifier verifier;

    public Provider provider() { return Provider.STRIPE; }
    public PaymentClient client() { return client; }
    public PaymentMapper mapper() { return mapper; }
    public WebhookVerifier webhookVerifier() { return verifier; }
}

// реестр по Provider — как в ../behavioral/strategy.md (List → EnumMap + проверка полноты)
var kit = kits.get(order.provider());
var response = kit.client().charge(kit.mapper().toRequest(order));
```

## После — одно семейство на деплой
```java
@Configuration
@ConditionalOnProperty(name = "region", havingValue = "eu")
class EuConfig {
    @Bean TaxCalculator taxCalculator() { return new EuVatCalculator(); }
    @Bean AddressFormatter addressFormatter() { return new EuAddressFormatter(); }
    @Bean InvoiceNumbering invoiceNumbering() { return new EuInvoiceNumbering(); }
}
// RuConfig с havingValue = "ru" — то же семейство для другого региона
```

## Шаги рефакторинга
1. Найти все `switch` по одному признаку: `find_referencing_symbols` по enum провайдера, страны или тенанта (или Grep).
2. Определить, какие объекты всегда выбираются вместе — это и есть семейство.
3. Ввести интерфейс семейства и реализацию на каждый вариант; заменить `switch` получением семейства из реестра.

## Подводные камни
- Kit, превращающийся в Service Locator: если в нём 10 методов и клиенты используют по одному, лучше несколько отдельных стратегий.
- Части семейства часто разделяют конфигурацию (URL, ключи). Свяжи их через `@ConfigurationProperties` провайдера.

## Плюсы и минусы
**Плюсы**
- Продукты одного семейства гарантированно совместимы.
- Клиент отвязан от конкретных классов.
- Новое семейство (провайдер, регион) добавляется без изменения клиента.

**Минусы**
- Новый *вид* продукта меняет интерфейс фабрики и все её реализации.
- Много классов и интерфейсов.
- Без дисциплины фабрика превращается в Service Locator.

## Связанные паттерны
Factory Method (один продукт) · Strategy (семейство из одного) · Bridge · Facade (может скрывать семейство за простым API).

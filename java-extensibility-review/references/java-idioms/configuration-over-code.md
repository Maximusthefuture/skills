# Конфигурация вместо кода

Тип: Spring Boot-идиома (externalized configuration, conditional beans)

## Суть
Данные, которые меняются чаще кода (ставки, пороги, маппинги, списки стран), выносятся из `if/else` в типизированную конфигурацию. Выбор реализации по флагу делается один раз, при сборке контекста (`@ConditionalOnProperty`, `@Profile`), а не `if` в каждом вызове. Новое значение — строка в YAML, а не релиз.

## Признаки в Java/Spring коде
- `if (country.equals("DE")) vat = 0.19; else if (country.equals("FR")) vat = 0.20; …`
- Магические числа-пороги в бизнес-логике (`if (amount > 50000)`), которые бизнес просит менять.
- `if (props.isNewPricingEnabled()) newEngine.calc() else oldEngine.calc()` в нескольких местах.
- `@Value("${…}")` с одинаковыми ключами, разбросанные по многим классам.
- Разные `if (env.equals("prod"))` в коде.

## Когда не применять
- Флаг переключается в рантайме без рестарта (A/B, процент пользователей, kill switch) — нужен feature-flag сервис (Unleash, LaunchDarkly, Togglz) и Strategy, выбираемая на каждый запрос.
- Значения меняет бизнес-пользователь через админку (тарифы, акции) — это данные в БД, а не YAML.
- Значение — часть логики, а не настройка (не надо выносить в конфиг каждое число).

## После — таблицы
```java
@ConfigurationProperties(prefix = "tax")
@Validated
public record TaxProperties(@NotEmpty Map<String, @NotNull @PositiveOrZero BigDecimal> vatByCountry) {}
```
```yaml
tax:
  vat-by-country:
    DE: 0.19
    FR: 0.20
```
```java
@Component
@RequiredArgsConstructor
class VatCalculator {
    private final TaxProperties tax;
    BigDecimal rate(String country) {
        var r = tax.vatByCountry().get(country);
        if (r == null) throw new UnsupportedCountryException(country);
        return r;
    }
}
```
Не забудь `@EnableConfigurationProperties(TaxProperties.class)` или `@ConfigurationPropertiesScan`.

## После — выбор реализации при старте
```java
@Component
@ConditionalOnProperty(name = "pricing.engine", havingValue = "v2")
class PricingEngineV2 implements PricingEngine { … }

@Component
@ConditionalOnProperty(name = "pricing.engine", havingValue = "v1", matchIfMissing = true)
class PricingEngineV1 implements PricingEngine { … }
```
Вызывающий код просто внедряет `PricingEngine`.

## Шаги рефакторинга
1. Вынести значения в `@ConfigurationProperties` с валидацией, сохранив текущие значения по умолчанию.
2. Заменить хардкод и разрозненные `@Value` на внедрение properties.
3. Тест: контекст поднимается с реальным `application.yml`; невалидная конфигурация роняет старт.

## Подводные камни
- Без `@Validated` опечатка в YAML даёт `null` в проде, а не ошибку при старте.
- Ключи Map в YAML с точками или спецсимволами нужно экранировать (`"[a.b]": 1`).
- Секреты не кладутся в `application.yml` в репозитории.
- Изменение YAML — тоже изменение поведения. Ему нужны ревью и тест так же, как коду.

## Связанные паттерны
Map-lookup (таблица в коде) · Null Object (`@ConditionalOnMissingBean`) · Abstract Factory (семейство бинов по профилю) · Strategy.

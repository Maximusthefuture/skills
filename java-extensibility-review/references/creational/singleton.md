# Singleton (Одиночка)

Группа: порождающий

## Суть
Классический Singleton гарантирует один экземпляр класса и даёт глобальную точку доступа к нему (`getInstance()`). В Spring-приложении эту задачу уже решает контейнер: бины по умолчанию singleton-scope и внедряются через конструктор. Поэтому **рукописный Singleton в Spring-коде — почти всегда запах**, и в ревью его обычно нужно убрать, а не добавить.

## Структура (участники)
Классический вариант:
- **Singleton** — класс с приватным конструктором, статическим полем-экземпляром и статическим методом доступа `getInstance()`. Сам управляет своим жизненным циклом.
- **Client** — получает экземпляр через глобальную точку доступа.

```
Singleton
  - static instance: Singleton
  - private Singleton()
  + static getInstance(): Singleton
```

В Spring ту же гарантию единственного экземпляра даёт контейнер, без глобальной точки доступа:
```
Spring Container ──(один экземпляр, scope singleton)──▶ Bean ──внедряется──▶ ClientA, ClientB
```

## Признаки в Java/Spring коде (найти и убрать)
- `public static X getInstance()`, `private static final X INSTANCE = new X()`.
- Статические поля с изменяемым состоянием, клиентами, кэшами, конфигурацией (`static RestTemplate`, `static Map cache`).
- Статический доступ к контейнеру: `SpringContext.getBean(…)`, `ApplicationContextHolder` (Service Locator).
- Утилитные классы, которые читают конфигурацию или ходят в сеть статическими методами.
- Тесты вынуждены сбрасывать глобальное состояние или не могут подменить зависимость.

## Почему это мешает расширяемости
- Зависимость скрыта: по конструктору не видно, что класс использует `PricingRules.getInstance()`.
- Нельзя подменить реализацию (другая стратегия, фейк в тесте, другой конфиг на профиль).
- Глобальное изменяемое состояние — источник гонок и флапающих тестов.

## Когда оставить
- Код библиотеки без DI-контейнера.
- Константы и stateless-утилиты со статическими методами (`StringUtils`, `Money.round`) — это нормально.
- Enum-синглтон для действительно глобальной и неизменяемой вещи вне Spring.

## До
```java
public final class PricingRules {
    private static PricingRules instance;
    private final Map<String, BigDecimal> rates;
    private PricingRules() { rates = loadFromFile("rates.json"); }
    public static synchronized PricingRules getInstance() {
        if (instance == null) instance = new PricingRules();
        return instance;
    }
}
// где-то в сервисе:
var rate = PricingRules.getInstance().rateFor(country);
```

## После
```java
@ConfigurationProperties(prefix = "pricing")
public record PricingProperties(Map<String, BigDecimal> rates) {}

@Component
@RequiredArgsConstructor
class PricingRules {
    private final PricingProperties props;
    BigDecimal rateFor(String country) { … }
}

@Service
@RequiredArgsConstructor
class PriceService {
    private final PricingRules rules;   // зависимость видна и подменяема
}
```
Вне Spring: enum-синглтон (`enum Registry { INSTANCE; … }`) или holder-idiom (`private static class Holder { static final X I = new X(); }`), но лучше всё равно передавать зависимость явно.

## Шаги рефакторинга
1. `grep -rn "getInstance()\|static .* INSTANCE\|getBean(" src/main/java`.
2. Превратить класс в бин; состояние из файлов и констант — в `@ConfigurationProperties`.
3. Заменить вызовы `getInstance()` внедрением через конструктор; удалить статический доступ.

## Подводные камни
- Spring-singleton ≠ потокобезопасный. Изменяемые поля в бине разделяются всеми запросами. Состояние запроса не должно храниться в полях бина.
- Статический доступ к контексту иногда оставляют для не-Spring объектов (сущности JPA, enum). Лучше передавать зависимость параметром метода.

## Плюсы и минусы
**Плюсы (классического варианта)**
- Гарантированно один экземпляр.
- Ленивая инициализация.
- Доступ из любого места.

**Минусы**
- Глобальное состояние и скрытые зависимости: по конструктору клиента их не видно.
- Трудно тестировать и подменять реализацию.
- Проблемы потокобезопасности при ленивой инициализации.
- Нарушает SRP: класс управляет и логикой, и своим жизненным циклом.
- В Spring все плюсы даёт контейнер без этих минусов, поэтому рукописный Singleton здесь почти всегда лишний.

## Связанные паттерны
Factory Method и Abstract Factory (часто реализуются как бины-синглтоны) · Flyweight (много разделяемых экземпляров) · Facade (фасад-бин в единственном экземпляре).

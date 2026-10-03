# Decorator (Декоратор)

Группа: структурный

## Суть
Декоратор оборачивает объект, реализует тот же интерфейс, делегирует вызов внутрь и добавляет поведение до или после. Обёртки складываются в слои (метрики → кэш → ретраи → HTTP), и каждый слой ничего не знает о других. Поведение добавляется без изменения исходного класса и без подклассов на каждую комбинацию.

## Структура (участники)
- **Component** — общий интерфейс (`RateProvider`).
- **ConcreteComponent** — базовая реализация с основной работой (`HttpRateProvider`).
- **Decorator** — реализует Component, хранит ссылку на обёрнутый Component и делегирует ему вызов.
- **ConcreteDecorator** — добавляет поведение до или после делегирования (`CachingRateProvider`, `MeteredRateProvider`).
- **Client** — работает с Component. В Spring цепочку обёрток собирает `@Configuration` с `@Primary`.

```
Client ──▶ MeteredDecorator ──▶ CachingDecorator ──▶ ConcreteComponent
              (все реализуют один интерфейс Component)
```

## Признаки в Java/Spring коде
- Бизнес-метод перемешан с кэшем, ретраями, логированием, метриками, rate limiting.
- Подклассы под комбинации: `CachingRateClient extends RateClient`, `RetryingCachingRateClient extends CachingRateClient`.
- Нужно добавить поведение бину из библиотеки или чужого модуля, который нельзя менять.
- Слои надо включать и выключать конфигурацией.

## Когда не применять — сначала проверь готовые инструменты
Spring уже делает декораторы через прокси: `@Cacheable`, `@Retryable` (Spring Retry), Resilience4j (`@CircuitBreaker`, `@RateLimiter`, `@Bulkhead`), `@Timed` / `@Observed`, `@Transactional`. Для HTTP — `ClientHttpRequestInterceptor` (RestClient/RestTemplate), `ExchangeFilterFunction` (WebClient). Ручной декоратор нужен, когда аннотаций не хватает: self-invocation, логика, зависящая от результата, бин из библиотеки, нестандартный порядок слоёв.

## До
```java
@Service
class RateService {
    private final Map<String, BigDecimal> cache = new ConcurrentHashMap<>();
    BigDecimal rate(Currency from, Currency to) {
        var key = from + "/" + to;
        var cached = cache.get(key);
        if (cached != null) return cached;
        long start = System.nanoTime();
        for (int i = 0; i < 3; i++) {
            try {
                var r = http.fetchRate(from, to);
                cache.put(key, r);
                metrics.record(System.nanoTime() - start);
                return r;
            } catch (IOException e) { sleep(200L * (i + 1)); }
        }
        throw new RateUnavailableException();
    }
}
```

## После
```java
public interface RateProvider { BigDecimal rate(Currency from, Currency to); }

@Component("httpRateProvider")
class HttpRateProvider implements RateProvider { /* только HTTP */ }

@RequiredArgsConstructor
class CachingRateProvider implements RateProvider {
    private final RateProvider delegate;
    private final Cache<String, BigDecimal> cache;          // Caffeine с TTL и размером
    public BigDecimal rate(Currency from, Currency to) {
        return cache.get(from + "/" + to, k -> delegate.rate(from, to));
    }
}

@RequiredArgsConstructor
class MeteredRateProvider implements RateProvider {
    private final RateProvider delegate;
    private final Timer timer;
    public BigDecimal rate(Currency from, Currency to) {
        return timer.record(() -> delegate.rate(from, to));
    }
}

@Configuration
class RateProviderConfig {
    @Bean @Primary
    RateProvider rateProvider(@Qualifier("httpRateProvider") RateProvider http, MeterRegistry meters) {
        var cached = new CachingRateProvider(http,
                Caffeine.newBuilder().expireAfterWrite(Duration.ofMinutes(5)).maximumSize(1_000).build());
        return new MeteredRateProvider(cached, meters.timer("rates.lookup"));
    }
}
```
Клиенты внедряют `RateProvider` и получают собранную цепочку. Новый слой — новый класс и одна строка в конфигурации.

## Шаги рефакторинга
1. Тест на поведение: попадание в кэш, повтор после ошибки, итоговое исключение.
2. Выделить интерфейс; «голая» реализация — только основная работа.
3. Вынести каждый сквозной аспект в свой декоратор или заменить готовой аннотацией.
4. Собрать цепочку в `@Configuration` с `@Primary`.

## Подводные камни
- **Порядок слоёв важен.** Метрики снаружи кэша меряют и попадания в кэш, метрики внутри — только реальные вызовы. Ретраи снаружи circuit breaker и внутри него ведут себя по-разному.
- **Self-invocation:** аннотации на прокси не срабатывают при вызове из того же класса. У ручного декоратора этой проблемы нет.
- **Неоднозначность бинов:** без `@Primary` или `@Qualifier` будет `NoUniqueBeanDefinitionException`, а декоратор может случайно получить сам себя.
- Декоратор должен сохранять контракт: те же исключения и семантику `null`.

## Плюсы и минусы
**Плюсы**
- Поведение добавляется без изменения исходного класса и без подклассов.
- Комбинации слоёв собираются конфигурацией.
- Одна сквозная ответственность — один класс (SRP).

**Минусы**
- Порядок обёрток важен и неочевиден.
- Много мелких объектов; стек вызовов при отладке длиннее.
- Убрать конкретный слой из середины цепочки неудобно.
- Идентичность объекта теряется: обёртка — это другой объект.

## Связанные паттерны
Proxy (тот же интерфейс, но про контроль доступа) · Chain of Responsibility (звено может прервать цепочку) · Adapter (меняет интерфейс, а не поведение) · Composite.

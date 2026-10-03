# Java: корректность и конкурентность

Чек-лист, а не список «что обязательно найти». Каждый пункт — повод присмотреться, находкой он становится только при конкретном сценарии отказа.

## Null и Optional
- Новый вызов метода, который может вернуть null (`Map.get`, `findXxx` без Optional, сторонние API), без проверки.
- `Optional.get()` без `isPresent`; `Optional` в полях, параметрах или как результат сериализации DTO.
- Изменилась nullability возвращаемого значения или параметра — проверь всех вызывающих.
- Автораспаковка `Integer`/`Long`/`Boolean` из null (`if (dto.getEnabled())`).

## Равенство и коллекции
- `==` для `String`, `Long`, `Integer` вне кэша [-128..127], `BigDecimal.equals` вместо `compareTo` (2.0 ≠ 2.00).
- Переопределён `equals` без `hashCode`; изменяемые поля в `hashCode` объекта, лежащего в `HashSet`/ключе `HashMap`.
- JPA-сущности с Lombok `@Data`/`@EqualsAndHashCode` по всем полям (lazy-связи, рекурсия, смена hashCode после persist).
- Модификация коллекции во время итерации; `Arrays.asList`/`List.of` + `add` → `UnsupportedOperationException`.
- `subList`, `Collectors.toMap` без merge-функции при возможных дублях ключей.

## Исключения и ресурсы
- Пустой `catch`, `catch (Exception e)` с проглатыванием, потеря причины (`throw new X(e.getMessage())` вместо `new X(msg, e)`).
- Checked-исключение обёрнуто так, что меняется поведение отката транзакции (см. spring-jpa.md).
- Ресурсы (`InputStream`, `Connection`, `HttpClient` response) без try-with-resources.
- `InterruptedException` проглочено без `Thread.currentThread().interrupt()`.

## Числа, время, строки
- Деньги в `double`/`float`; `BigDecimal` из `double` (`new BigDecimal(0.1)`), деление без `RoundingMode`.
- Переполнение `int` при умножении/суммировании (размеры, миллисекунды).
- `LocalDateTime` там, где нужен момент времени (`Instant`/`OffsetDateTime`); `LocalDate.now()` без `Clock` в тестируемой логике; часовые пояса по умолчанию JVM.
- `String.format`/`toLowerCase` без `Locale` для машинно-читаемых строк.

## Конкурентность
- Изменяемые поля в singleton-бинах (`@Service`, `@Component`, `@RestController`) без синхронизации — каждый бин общий для всех запросов.
- `SimpleDateFormat`, `HashMap`, `ArrayList` как общие поля между потоками.
- check-then-act (`if (!map.containsKey(k)) map.put(...)`) вместо `computeIfAbsent`/атомарных операций; то же в БД (проверка уникальности без constraint).
- `@Async`/`CompletableFuture.supplyAsync` без своего executor (общий `ForkJoinPool`), потеря `SecurityContext`/MDC/транзакции в другом потоке.
- Блокирующие вызовы в реактивном коде (WebFlux) или внутри `synchronized` при virtual threads (pinning, Java 21).
- Неограниченные очереди и пулы, `Executors.newCachedThreadPool` под нагрузкой.

## Стримы и API
- Побочные эффекты в `map`/`filter`, `parallelStream` на общем пуле в веб-запросе.
- `stream().toList()` (неизменяемый, Java 16+) там, где дальше идёт модификация.
- Ломающее изменение публичного метода библиотечного модуля (сигнатура, исключения, семантика) без учёта вызывающих.

## Логирование
- Конкатенация в логах на горячем пути вместо параметров `{}`; `log.error(e.getMessage())` без stacktrace.
- Логирование целых сущностей/DTO (PII, токены, lazy-загрузка в `toString`).

# Примеры циклов TDD на Java / Spring

Открывай пример под нужный уровень, не читай все подряд.

1. [Бизнес-правило — чистый JUnit](#1-бизнес-правило--чистый-junit)
2. [Багфикс в запросе — `@DataJpaTest` + Testcontainers](#2-багфикс-в-запросе--datajpatest--testcontainers)
3. [Новый endpoint — `@WebMvcTest`](#3-новый-endpoint--webmvctest)
4. [Код уже написан — доказательство падения через stash](#4-код-уже-написан--доказательство-падения-через-stash)
5. [Новый `@KafkaListener` — Testcontainers или `@EmbeddedKafka`](#5-новый-kafkalistener--testcontainers-или-embeddedkafka)

Примеры рассчитаны на Spring Boot 3.4+ (`@MockitoBean`, `@ServiceConnection`), JUnit 5, AssertJ.

---

## 1. Бизнес-правило — чистый JUnit

**Задача:** скидка 5% на заказ от 1000, до 1000 — без скидки. Сумма скидки округляется до копеек вниз.

### RED — первое поведение: до порога скидки нет

```java
class DiscountPolicyTest {

    private final DiscountPolicy policy = new DiscountPolicy();

    @Test
    void noDiscountBelowThreshold() {
        assertThat(policy.discountFor(new BigDecimal("999.99")))
            .isEqualByComparingTo("0.00");
    }
}
```

Поломка, которую ловит тест: скидка применяется ниже порога (`>=` превратился в `>` не в ту сторону, порог 100 вместо 1000).

### VERIFY RED

```
$ ./mvnw -q test -Dtest=DiscountPolicyTest -Dsurefire.failIfNoSpecifiedTests=false
[ERROR] cannot find symbol: class DiscountPolicy
```

Это не RED — тест не запускался. Создаём заглушку, которая возвращает заведомо неверное значение, чтобы упал именно assertion:

```java
public class DiscountPolicy {
    public BigDecimal discountFor(BigDecimal total) {
        return null;
    }
}
```

```
$ ./mvnw -q test -Dtest=DiscountPolicyTest -Dsurefire.failIfNoSpecifiedTests=false
[ERROR] DiscountPolicyTest.noDiscountBelowThreshold:9
Expecting actual not to be null
```

Падение на assertion, причина понятна — это RED.

### GREEN

```java
public BigDecimal discountFor(BigDecimal total) {
    return BigDecimal.ZERO;
}
```

Да, это «обман». Так и задумано: правило «от 1000 — 5%» ещё не требует ни один тест. Следующий тест заставит написать настоящую логику.

### Следующее поведение — RED

```java
@ParameterizedTest
@CsvSource({
    "999.99,  0.00",
    "1000,    50.00",
    "1234.57, 61.72",   // 61.7285 → вниз до 61.72
})
void discountIsFivePercentFromThresholdRoundedDown(BigDecimal total, BigDecimal expected) {
    assertThat(policy.discountFor(total)).isEqualByComparingTo(expected);
}
```

```
[ERROR] discountIsFivePercentFromThresholdRoundedDown [2] total=1000, expected=50.00
expected: 50.00  but was: 0
```

Строка `999.99` прошла сразу — это нормально внутри параметризованного теста, где новое поведение покрывают остальные строки. Первый тест `noDiscountBelowThreshold` теперь дублирует строку таблицы — удалим его на REFACTOR.

### GREEN

```java
public class DiscountPolicy {

    private static final BigDecimal THRESHOLD = new BigDecimal("1000");
    private static final BigDecimal RATE = new BigDecimal("0.05");

    public BigDecimal discountFor(BigDecimal total) {
        if (total.compareTo(THRESHOLD) < 0) {
            return BigDecimal.ZERO;
        }
        return total.multiply(RATE).setScale(2, RoundingMode.DOWN);
    }
}
```

### VERIFY GREEN → REFACTOR

Удаляем дублирующий `noDiscountBelowThreshold`. Mutation check: `< 0` → `<= 0` роняет строку `1000`; `RoundingMode.DOWN` → `HALF_UP` роняет строку `1234.57`; `RATE` 0.05 → 0.5 роняет все строки выше порога. Защищено.

**Чего нет и не нужно:** теста на `THRESHOLD == 1000` (детектор изменений), `@SpringBootTest` (это чистая функция), моков.

---

## 2. Багфикс в запросе — `@DataJpaTest` + Testcontainers

**Баг:** в списке активных заказов клиента показываются отменённые.

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {

    @Query("select o from Order o where o.customerId = :customerId and o.status <> com.example.order.OrderStatus.DELIVERED")
    List<Order> findActiveByCustomer(UUID customerId);
}
```

### RED — воспроизвести баг на настоящем Postgres

Мок репозитория тут бесполезен: баг — в JPQL. H2 тоже нельзя: прод на Postgres.

```java
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Testcontainers
class OrderRepositoryTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired OrderRepository orders;

    private final UUID customerId = UUID.randomUUID();

    @Test
    void activeOrdersExcludeCancelledAndDelivered() {
        Order paid      = orders.save(anOrder(customerId, OrderStatus.PAID));
        orders.save(anOrder(customerId, OrderStatus.CANCELLED));
        orders.save(anOrder(customerId, OrderStatus.DELIVERED));
        orders.save(anOrder(UUID.randomUUID(), OrderStatus.PAID));   // чужой клиент

        assertThat(orders.findActiveByCustomer(customerId))
            .extracting(Order::getId)
            .containsExactly(paid.getId());
    }
}
```

`anOrder(...)` — test data builder в `src/test`, а не конструктор, добавленный в entity ради теста.

### VERIFY RED

```
$ ./mvnw -q test -Dtest=OrderRepositoryTest -Dsurefire.failIfNoSpecifiedTests=false
[ERROR] OrderRepositoryTest.activeOrdersExcludeCancelledAndDelivered
Expecting actual:
  [3f1c..., 9a20...]
to contain exactly (and in same order):
  [3f1c...]
but some elements were not expected:
  [9a20...]
```

Лишний элемент — отменённый заказ. Сообщение описывает именно этот баг, значит, воспроизвели правильно.

Если бы увидели `Could not find a valid Docker environment` — это не RED. Сказать пользователю, что Docker недоступен, и не подменять Postgres на H2.

### GREEN

```java
@Query("""
    select o from Order o
    where o.customerId = :customerId
      and o.status not in (com.example.order.OrderStatus.DELIVERED,
                           com.example.order.OrderStatus.CANCELLED)
    """)
List<Order> findActiveByCustomer(UUID customerId);
```

### VERIFY GREEN → весь набор

```
$ ./mvnw -q test -Dtest=OrderRepositoryTest -Dsurefire.failIfNoSpecifiedTests=false
$ ./mvnw verify
```

Один регрессионный тест — на уровне репозитория, который владеет запросом. Сервис и контроллер этот же сценарий не повторяют.

---

## 3. Новый endpoint — `@WebMvcTest`

**Задача:** `POST /accounts`. Если email занят — `409` с ProblemDetail и `code = EMAIL_TAKEN`. Анонимный запрос — `401`.

Предполагается stateless API (JWT или Basic): анонимный запрос получает `401`, а не редирект на форму логина.

Разделение ответственности:
- **HTTP-контракт** (статус, ProblemDetail, валидация, security) — `@WebMvcTest`, сервис замокан: он внешний по отношению к контракту контроллера.
- **Уникальность email** — constraint в БД, проверяется `@DataJpaTest` (по образцу примера 2). Не здесь.

### RED — первое поведение: занятый email → 409

```java
@WebMvcTest(AccountController.class)
@Import(SecurityConfig.class)
class AccountControllerTest {

    @Autowired MockMvc mvc;
    @MockitoBean AccountService accounts;

    @Test
    @WithMockUser
    void duplicateEmailReturns409WithStableCode() throws Exception {
        when(accounts.register(any())).thenThrow(new EmailTakenException("a@b.io"));

        mvc.perform(post("/accounts")
                .with(csrf())
                .contentType(APPLICATION_JSON)
                .content("""
                    {"email": "a@b.io", "name": "Ann"}
                    """))
            .andExpect(status().isConflict())
            .andExpect(content().contentType(APPLICATION_PROBLEM_JSON))
            .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }
}
```

Здесь `thenThrow` — не «мок, реализующий проверяемое поведение»: проверяется маппинг исключения в HTTP-ответ, это работа контроллера/`@RestControllerAdvice`, а не сервиса.

`.with(csrf())` и `@WithMockUser` нужны, чтобы запрос дошёл до проверяемой логики. Без них тест упал бы с `403`/`401` от security-цепочки — это ложный RED.

### VERIFY RED

Создаём `AccountController` с методом, который вызывает `accounts.register(...)` и возвращает `201`; `EmailTakenException` пока никто не обрабатывает.

```
[ERROR] AccountControllerTest.duplicateEmailReturns409WithStableCode
jakarta.servlet.ServletException: Request processing failed:
  com.example.account.EmailTakenException: a@b.io
```

MockMvc не превращает необработанное исключение в 500, а пробрасывает его из `perform()`. Формально это не падение assertion'а, но причина ровно та, ради которой пишется тест: исключение никто не маппит в HTTP-ответ. Это допустимый RED. Недопустимым он был бы, если бы вылетело другое исключение — например, `HttpMessageNotReadableException` из-за кривого JSON в запросе.

### GREEN

```java
@RestControllerAdvice
class ApiExceptionHandler {

    @ExceptionHandler(EmailTakenException.class)
    ProblemDetail emailTaken(EmailTakenException e) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "Email is already registered");
        pd.setProperty("code", "EMAIL_TAKEN");
        return pd;
    }
}
```

### Следующие поведения — по циклу каждое

```java
@Test
void anonymousRequestIsRejected() throws Exception {
    mvc.perform(post("/accounts").with(csrf())
            .contentType(APPLICATION_JSON)
            .content("""
                {"email": "a@b.io", "name": "Ann"}
                """))
        .andExpect(status().isUnauthorized());
    verifyNoInteractions(accounts);
}

@Test
@WithMockUser
void invalidEmailReturns400WithFieldError() throws Exception {
    mvc.perform(post("/accounts").with(csrf())
            .contentType(APPLICATION_JSON)
            .content("""
                {"email": "not-an-email", "name": "Ann"}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors[0].field").value("email"));
}
```

`verifyNoInteractions(accounts)` в тесте на 401 уместен: «сервис не вызван» и есть наблюдаемое поведение security-правила, другого способа его увидеть на этом уровне нет.

Для `anonymousRequestIsRejected` сначала проверь, что тест падает, если временно открыть endpoint (`permitAll()`), — иначе неизвестно, проверяет ли он правило или просто отсутствие CSRF.

---

## 4. Код уже написан — доказательство падения через stash

Ты (агент) в этой сессии сначала написал метод `Order.cancel()`, а тест — нет. Удалять код не нужно, нужно доказать, что тест умеет падать без него.

```java
@Test
void cancellingShippedOrderIsRejected() {
    Order order = anOrder().status(OrderStatus.SHIPPED).build();

    assertThatThrownBy(order::cancel)
        .isInstanceOf(IllegalOrderTransitionException.class);
    assertThat(order.getStatus()).isEqualTo(OrderStatus.SHIPPED);
}
```

Тест написан по требованию «отгруженный заказ нельзя отменить», а не по тому, как устроен `cancel()`.

```
$ git stash push -- src/main/java/com/example/order/Order.java
$ ./mvnw -q test -Dtest=OrderTest -Dsurefire.failIfNoSpecifiedTests=false
```

Если без изменения метода `cancel` вообще нет — будет ошибка компиляции. Тогда вместо stash временно замени тело метода на `status = OrderStatus.CANCELLED;` (наивная версия без проверки) и убедись, что тест падает на assertion:

```
Expecting code to raise a throwable.
```

```
$ git stash pop
$ ./mvnw -q test -Dtest=OrderTest -Dsurefire.failIfNoSpecifiedTests=false
```

Зелёный. Тест доказал, что ловит отсутствие проверки перехода.

Stash'ить можно только свои изменения из этой сессии. Если в файле есть чужие незакоммиченные правки — не трогай его, используй временную замену тела метода и верни её руками.

---

## 5. Новый `@KafkaListener` — Testcontainers или `@EmbeddedKafka`

**Задача:** событие `PaymentCaptured` из топика `payments.captured` переводит заказ из `AWAITING_PAYMENT` в `PAID`.

### Выбор инфраструктуры

```
$ grep -rnE 'org\.testcontainers|spring-boot-testcontainers|spring-kafka-test' --include=pom.xml .
./pom.xml:55:            <groupId>org.testcontainers</groupId>
```

Testcontainers в проекте есть — значит, Kafka тоже на Testcontainers. Модуля `org.testcontainers:kafka` в `pom.xml` нет: добавляем той же версии, что `postgresql`, и называем это в отчёте. Если бы grep не нашёл Testcontainers, тест был бы на `@EmbeddedKafka` (вариант ниже).

### Заглушка до RED

Без listener'а тест упадёт по таймауту, но такой таймаут ничего не говорит о причине: запись могла не дойти, топика могло не быть. Поэтому сначала заглушка, которая получает запись и ничего не делает:

```java
@Component
public class PaymentEventsListener {

    private static final Logger log = LoggerFactory.getLogger(PaymentEventsListener.class);

    @KafkaListener(topics = "payments.captured", groupId = "orders")
    public void on(PaymentCaptured event) {
        log.info("received payment {} for order {}", event.paymentId(), event.orderId());
    }
}
```

### RED — проект на Testcontainers

```java
@SpringBootTest(properties = "spring.kafka.consumer.auto-offset-reset=earliest")
@Testcontainers
class PaymentEventsListenerTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Container
    @ServiceConnection
    static KafkaContainer kafka = new KafkaContainer(DockerImageName.parse("apache/kafka-native:3.8.0"));

    @Autowired KafkaTemplate<String, Object> kafkaTemplate;
    @Autowired OrderRepository orders;

    @Test
    void capturedPaymentMarksOrderPaid() {
        Order order = orders.save(anOrder().status(OrderStatus.AWAITING_PAYMENT).build());

        kafkaTemplate.send("payments.captured", order.getId().toString(),
            new PaymentCaptured(UUID.randomUUID(), order.getId(), new BigDecimal("125.50")));

        await().atMost(Duration.ofSeconds(10)).untilAsserted(() ->
            assertThat(orders.findById(order.getId()))
                .get()
                .returns(OrderStatus.PAID, Order::getStatus));
    }
}
```

- `KafkaContainer` — класс из той версии Testcontainers, что в проекте: в 1.20+ это `org.testcontainers.kafka.KafkaContainer` (образы `apache/kafka`, `apache/kafka-native`), раньше — `org.testcontainers.containers.KafkaContainer` с образом `confluentinc/cp-kafka`.
- Сериализаторы и `groupId` берутся из конфигурации приложения, так что тест проверяет и их.
- Таких классов несколько — вынеси контейнеры в общий базовый класс или `@TestConfiguration` с `@ServiceConnection`-бинами: один контейнер на прогон.
- Суффикс имени выбирай по конвенции проекта: `*IT` запускается, только если настроен Failsafe или отдельный source set.

### RED — проект без Testcontainers: `@EmbeddedKafka`

Меняется только заголовок класса, тело теста то же:

```java
@SpringBootTest(properties = "spring.kafka.consumer.auto-offset-reset=earliest")
@EmbeddedKafka(partitions = 1, topics = "payments.captured",
               bootstrapServersProperty = "spring.kafka.bootstrap-servers")
class PaymentEventsListenerTest {
    // БД поднимается тем способом, который уже есть в проекте для тестов. Не H2.
    // ... тот же тест capturedPaymentMarksOrderPaid
}
```

- `spring-kafka-test` — в test scope, без версии: её задаёт BOM Spring Boot.
- Если Kafka-тестов несколько, вынеси `@SpringBootTest` + `@EmbeddedKafka` в мета-аннотацию или базовый класс. Каждый новый набор атрибутов `@EmbeddedKafka` — это новый контекст и новый брокер. `@DirtiesContext` из примеров в интернете не копируй.

### VERIFY RED

```
$ ./mvnw -q test -Dtest=PaymentEventsListenerTest -Dsurefire.failIfNoSpecifiedTests=false
INFO  c.a.o.PaymentEventsListener : received payment 5b0e... for order 3f1c...
[ERROR] PaymentEventsListenerTest.capturedPaymentMarksOrderPaid
org.awaitility.core.ConditionTimeoutException: Assertion condition defined as a lambda expression in ...
expected: PAID
 but was: AWAITING_PAYMENT within 10 seconds.
```

Строка `received payment` в логе означает, что запись дошла до listener'а, а статус не поменялся. Это RED: не хватает именно проверяемого поведения.

Если строки в логе нет, это не RED. Проверь `auto-offset-reset`, имя топика и ошибки десериализации в логе (`DeserializationException`, `ListenerExecutionFailedException`).

### GREEN

```java
@KafkaListener(topics = "payments.captured", groupId = "orders")
@Transactional
public void on(PaymentCaptured event) {
    orders.findById(event.orderId())
        .orElseThrow(() -> new OrderNotFoundException(event.orderId()))
        .markPaid(event.paymentId());
}
```

### Следующие поведения — по циклу каждое

- То же событие дважды (повторная доставка после rebalance) даёт один эффект: заказ `PAID`, платёж учтён один раз. См. `idempotency-and-side-effects`.
- Событие для несуществующего заказа или poison message попадает в DLT и не блокирует partition. DLT читаем тестовым consumer'ом на том же брокере.

Мок `KafkaTemplate` или прямой вызов `listener.on(event)` вместо этого теста не проверили бы ни сериализацию, ни конфигурацию listener'а, ни error handler.

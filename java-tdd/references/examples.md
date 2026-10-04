# TDD cycle examples in Java / Spring

Open the example for the level you need; do not read them all.

1. [Business rule — plain JUnit](#1-business-rule--plain-junit)
2. [Query bugfix — `@DataJpaTest` + Testcontainers](#2-query-bugfix--datajpatest--testcontainers)
3. [New endpoint — `@WebMvcTest`](#3-new-endpoint--webmvctest)
4. [Code already written — proving the failure via stash](#4-code-already-written--proving-the-failure-via-stash)
5. [New `@KafkaListener` — Testcontainers or `@EmbeddedKafka`](#5-new-kafkalistener--testcontainers-or-embeddedkafka)

The examples assume Spring Boot 3.4+ (`@MockitoBean`, `@ServiceConnection`), JUnit 5, AssertJ.

---

## 1. Business rule — plain JUnit

**Task:** a 5% discount on orders from 1000; below 1000 — no discount. The discount amount is rounded down to cents.

### RED — the first behavior: no discount below the threshold

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

The breakage the test catches: the discount applies below the threshold (`>=` turned into `>` the wrong way, a threshold of 100 instead of 1000).

### VERIFY RED

```
$ ./mvnw -q test -Dtest=DiscountPolicyTest -Dsurefire.failIfNoSpecifiedTests=false
[ERROR] cannot find symbol: class DiscountPolicy
```

This is not RED — the test did not run. Create a stub that returns a clearly wrong value so that exactly the assertion fails:

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

An assertion failure with a clear reason — this is RED.

### GREEN

```java
public BigDecimal discountFor(BigDecimal total) {
    return BigDecimal.ZERO;
}
```

Yes, this is "cheating". That is the point: no test requires the "5% from 1000" rule yet. The next test forces the real logic.

### The next behavior — RED

```java
@ParameterizedTest
@CsvSource({
    "999.99,  0.00",
    "1000,    50.00",
    "1234.57, 61.72",   // 61.7285 → down to 61.72
})
void discountIsFivePercentFromThresholdRoundedDown(BigDecimal total, BigDecimal expected) {
    assertThat(policy.discountFor(total)).isEqualByComparingTo(expected);
}
```

```
[ERROR] discountIsFivePercentFromThresholdRoundedDown [2] total=1000, expected=50.00
expected: 50.00  but was: 0
```

The `999.99` row passed right away — that is fine inside a parameterized test where the other rows cover the new behavior. The first test `noDiscountBelowThreshold` now duplicates a table row — we delete it in REFACTOR.

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

Delete the duplicating `noDiscountBelowThreshold`. Mutation check: `< 0` → `<= 0` breaks the `1000` row; `RoundingMode.DOWN` → `HALF_UP` breaks the `1234.57` row; `RATE` 0.05 → 0.5 breaks every row above the threshold. Protected.

**What is absent and not needed:** a test for `THRESHOLD == 1000` (a change detector), `@SpringBootTest` (it is a pure function), mocks.

---

## 2. Query bugfix — `@DataJpaTest` + Testcontainers

**Bug:** the customer's active orders list shows cancelled ones.

```java
public interface OrderRepository extends JpaRepository<Order, UUID> {

    @Query("select o from Order o where o.customerId = :customerId and o.status <> com.example.order.OrderStatus.DELIVERED")
    List<Order> findActiveByCustomer(UUID customerId);
}
```

### RED — reproduce the bug on real Postgres

A repository mock is useless here: the bug is in the JPQL. H2 is not allowed either: production runs on Postgres.

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
        orders.save(anOrder(UUID.randomUUID(), OrderStatus.PAID));   // another customer

        assertThat(orders.findActiveByCustomer(customerId))
            .extracting(Order::getId)
            .containsExactly(paid.getId());
    }
}
```

`anOrder(...)` is a test data builder in `src/test`, not a constructor added to the entity for the test.

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

The extra element is the cancelled order. The message describes exactly this bug, so the reproduction is right.

Had we seen `Could not find a valid Docker environment` — that is not RED. Tell the user Docker is unavailable and do not replace Postgres with H2.

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

### VERIFY GREEN → the full suite

```
$ ./mvnw -q test -Dtest=OrderRepositoryTest -Dsurefire.failIfNoSpecifiedTests=false
$ ./mvnw verify
```

One regression test — at the level of the repository that owns the query. The service and controller do not repeat this scenario.

---

## 3. New endpoint — `@WebMvcTest`

**Task:** `POST /accounts`. If the email is taken — `409` with a ProblemDetail and `code = EMAIL_TAKEN`. An anonymous request — `401`.

A stateless API (JWT or Basic) is assumed: an anonymous request gets `401`, not a redirect to a login form.

Separation of concerns:
- **The HTTP contract** (status, ProblemDetail, validation, security) — `@WebMvcTest`, the service is mocked: it is external to the controller's contract.
- **Email uniqueness** — a DB constraint, checked with `@DataJpaTest` (like example 2). Not here.

### RED — the first behavior: a taken email → 409

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

Here `thenThrow` is not "a mock implementing the behavior under test": what is checked is mapping the exception to an HTTP response, which is the job of the controller/`@RestControllerAdvice`, not the service.

`.with(csrf())` and `@WithMockUser` are needed for the request to reach the logic under test. Without them the test would fail with `403`/`401` from the security chain — a false RED.

### VERIFY RED

Create an `AccountController` with a method that calls `accounts.register(...)` and returns `201`; nobody handles `EmailTakenException` yet.

```
[ERROR] AccountControllerTest.duplicateEmailReturns409WithStableCode
jakarta.servlet.ServletException: Request processing failed:
  com.example.account.EmailTakenException: a@b.io
```

MockMvc does not turn an unhandled exception into a 500; it rethrows it from `perform()`. Formally this is not an assertion failure, but the reason is exactly the one the test is written for: nobody maps the exception to an HTTP response. This is an acceptable RED. It would be unacceptable if a different exception came out — e.g. `HttpMessageNotReadableException` because of broken JSON in the request.

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

### The next behaviors — each through the cycle

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

`verifyNoInteractions(accounts)` in the 401 test fits: "the service was not called" is the observable behavior of the security rule, and there is no other way to see it at this level.

For `anonymousRequestIsRejected` first check that the test fails if you temporarily open the endpoint (`permitAll()`) — otherwise you do not know whether it checks the rule or just the missing CSRF.

---

## 4. Code already written — proving the failure via stash

You (the agent) wrote the `Order.cancel()` method first in this session, and no test. There is no need to delete the code; you need to prove the test can fail without it.

```java
@Test
void cancellingShippedOrderIsRejected() {
    Order order = anOrder().status(OrderStatus.SHIPPED).build();

    assertThatThrownBy(order::cancel)
        .isInstanceOf(IllegalOrderTransitionException.class);
    assertThat(order.getStatus()).isEqualTo(OrderStatus.SHIPPED);
}
```

The test is written from the requirement "a shipped order cannot be cancelled", not from how `cancel()` works.

```
$ git stash push -- src/main/java/com/example/order/Order.java
$ ./mvnw -q test -Dtest=OrderTest -Dsurefire.failIfNoSpecifiedTests=false
```

If without the change there is no `cancel` method at all, you get a compilation error. Then instead of stash temporarily replace the method body with `status = OrderStatus.CANCELLED;` (a naive version without the check) and make sure the test fails on the assertion:

```
Expecting code to raise a throwable.
```

```
$ git stash pop
$ ./mvnw -q test -Dtest=OrderTest -Dsurefire.failIfNoSpecifiedTests=false
```

Green. The test proved it catches the missing transition check.

Stash only your own changes from this session. If the file has someone else's uncommitted edits — do not touch it; use the temporary body replacement and restore it by hand.

---

## 5. New `@KafkaListener` — Testcontainers or `@EmbeddedKafka`

**Task:** a `PaymentCaptured` event from the `payments.captured` topic moves an order from `AWAITING_PAYMENT` to `PAID`.

### Choosing the infrastructure

```
$ grep -rnE 'org\.testcontainers|spring-boot-testcontainers|spring-kafka-test' --include=pom.xml .
./pom.xml:55:            <groupId>org.testcontainers</groupId>
```

The project has Testcontainers — so Kafka runs on Testcontainers too. There is no `org.testcontainers:kafka` module in `pom.xml`: add it with the same version as `postgresql` and name it in the report. Had grep found no Testcontainers, the test would use `@EmbeddedKafka` (the variant below).

### A stub before RED

Without a listener the test fails on a timeout, but such a timeout says nothing about the cause: the record may not have arrived, the topic may not exist. So first a stub that receives the record and does nothing:

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

### RED — a project on Testcontainers

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

- `KafkaContainer` is the class from the project's Testcontainers version: in 1.20+ it is `org.testcontainers.kafka.KafkaContainer` (images `apache/kafka`, `apache/kafka-native`), before that — `org.testcontainers.containers.KafkaContainer` with the `confluentinc/cp-kafka` image.
- Serializers and `groupId` come from the application configuration, so the test checks them too.
- Several such classes — move the containers into a shared base class or a `@TestConfiguration` with `@ServiceConnection` beans: one container per run.
- Pick the name suffix by the project's convention: `*IT` runs only if Failsafe or a separate source set is configured.

### RED — a project without Testcontainers: `@EmbeddedKafka`

Only the class header changes, the test body is the same:

```java
@SpringBootTest(properties = "spring.kafka.consumer.auto-offset-reset=earliest")
@EmbeddedKafka(partitions = 1, topics = "payments.captured",
               bootstrapServersProperty = "spring.kafka.bootstrap-servers")
class PaymentEventsListenerTest {
    // The DB is started the way the project already does it for tests. Not H2.
    // ... the same capturedPaymentMarksOrderPaid test
}
```

- `spring-kafka-test` — in test scope, no version: the Spring Boot BOM sets it.
- If there are several Kafka tests, move `@SpringBootTest` + `@EmbeddedKafka` into a meta-annotation or a base class. Every new set of `@EmbeddedKafka` attributes is a new context and a new broker. Do not copy `@DirtiesContext` from examples on the internet.

### VERIFY RED

```
$ ./mvnw -q test -Dtest=PaymentEventsListenerTest -Dsurefire.failIfNoSpecifiedTests=false
INFO  c.a.o.PaymentEventsListener : received payment 5b0e... for order 3f1c...
[ERROR] PaymentEventsListenerTest.capturedPaymentMarksOrderPaid
org.awaitility.core.ConditionTimeoutException: Assertion condition defined as a lambda expression in ...
expected: PAID
 but was: AWAITING_PAYMENT within 10 seconds.
```

The `received payment` line in the log means the record reached the listener and the status did not change. This is RED: exactly the behavior under test is missing.

If the log has no such line, it is not RED. Check `auto-offset-reset`, the topic name and deserialization errors in the log (`DeserializationException`, `ListenerExecutionFailedException`).

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

### The next behaviors — each through the cycle

- The same event twice (redelivery after a rebalance) gives one effect: the order is `PAID`, the payment is counted once. See `idempotency-and-side-effects`.
- An event for a non-existent order or a poison message goes to the DLT and does not block the partition. Read the DLT with a test consumer on the same broker.

A `KafkaTemplate` mock or a direct `listener.on(event)` call instead of this test would check neither serialization, nor the listener configuration, nor the error handler.

# How to write honest tests (Java / Spring)

**Open when:** you write or change a test, add a mock, a test double, a fixture or a test helper.

An adaptation of `writing-good-tests.md` from [obra/superpowers](https://github.com/obra/superpowers) (MIT) for JUnit 5 / AssertJ / Mockito / Spring. The catalog of junk patterns and auditing existing tests is in the `test-audit` skill; here are the rules to keep in mind while writing.

A test exists to catch a specific breakage. Two principles:

```
1. Every test knows which breakage it catches
2. Every test works with real code
```

TDD gives both almost for free: a test written first and seen red on real code has already proven it can fail, and a mock appears in it only when the real dependency turned out to be slow or external.

## Principle 1. Name the breakage

Before the test body, answer: **which change in production code should make this test fail — and is that a bug or a deliberate decision?** A test is justified if it catches a wrong branch, a missing side effect, a wrong argument, an edge case or a broken contract.

### The expected value is derived independently

Literals and hand-checked fixtures. For variants of one rule — `@ParameterizedTest` with literal expected values. An expectation computed by the code under test or its helpers passes whatever the code does.

```java
// ❌ Mirror: the expected JSON is serialized by the same ObjectMapper from the same DTO
String expected = objectMapper.writeValueAsString(new OrderResponse(id, "PAID", amount));
mvc.perform(get("/orders/{id}", id))
   .andExpect(content().json(expected));

// ✅ Literal: catches a renamed field, a changed amount format, a lost status
mvc.perform(get("/orders/{id}", id))
   .andExpect(content().json("""
       {"id": "%s", "status": "PAID", "amount": "125.50"}
       """.formatted(id)));
```

```java
// ❌ The expectation is computed by the same mapper
assertThat(mapper.toDto(order)).isEqualTo(mapper.toDto(order));

// ✅ The expectation is written out by hand
assertThat(mapper.toDto(order))
    .returns("PAID", OrderDto::status)
    .returns(new BigDecimal("125.50"), OrderDto::amount);
```

```java
// ✅ Rule variants — a table of literals
@ParameterizedTest
@CsvSource({
    "0,      0.00",
    "999.99, 0.00",
    "1000,   50.00",
    "2500,   125.00",
})
void discountIsFivePercentFromThreshold(BigDecimal total, BigDecimal expectedDiscount) {
    assertThat(policy.discountFor(total)).isEqualByComparingTo(expectedDiscount);
}
```

### Do not write change detectors

If only a deliberate decision can break a test — a constant's value, the exact wording of a message, a private structure — it fires on redesign and sleeps through bugs. Check the behavior that depends on the decision.

```java
// ❌ Change detector
assertThat(RetryPolicy.MAX_ATTEMPTS).isEqualTo(5);

// ✅ Behavior: 5 attempts, no sixth
wireMock.stubFor(post("/payments").willReturn(serverError()));
assertThatThrownBy(() -> client.charge(request)).isInstanceOf(PaymentUnavailableException.class);
wireMock.verify(5, postRequestedFor(urlEqualTo("/payments")));
```

Check the exact message text only if it is part of the contract (e.g. the `code` in a ProblemDetail the frontend relies on). The human-readable `detail` usually is not.

### Behavior, not text

A test that checks that a file, an SQL string, `application.yml` or a log contains a string proves only that the source is the source. Run the code on a controlled input and check the result, the side effect or the exit code. The exception is ArchUnit rules and contract key checks when they are the cheapest independent guard (see the retention bar in `test-audit`).

### Your code, not the framework

Check your code's contract at its boundaries: the registered route, the generated query, the returned payload. The behavior of Spring, Hibernate and Jackson is their maintainers' concern:

- a derived query `findByEmail` without `@Query` — do not test it by itself; test the business scenario that relies on it, or the constraint it must respect;
- `@Value` injection, the presence of Bean Validation annotations, Jackson defaults — do not test them; test that an invalid request gets a 400 with the right field code;
- constructors, getters, constants and trivial pass-throughs get tests only if they validate, normalize, default, compute or cause a side effect. Otherwise check the first consumer-visible result that depends on them.

If framework behavior really surprised you — one narrow characterization test whose name states the assumption (`hibernateFlushesBeforeNativeQuery`).

### Gate

```
BEFORE the test body:
  Name the code change that makes the test fail.

  Cannot name it                 → rebuild the test around observable behavior
  "The source text changes"      → run the code and check the effect
  Only deliberate decisions      → a change detector; check the behavior
                                   that depends on the decision

  Make sure the expected value was obtained without the code under test.
  If it uses the logic or helpers of the code under test:
    replace it with a literal or a hand-checked fixture
```

## Principle 2. Work with real code

### A mock does not deserve assertions

An assertion on a mock passes when the mock is there and fails when it is not — it says nothing about the component.

```java
// ❌ The mock implements the behavior under test, the test checks the mock
when(orderRepository.save(any())).thenReturn(order);
Order saved = service.place(command);
assertThat(saved).isEqualTo(order);
verify(orderRepository).save(any());

// ✅ A real repository on Testcontainers Postgres, we check the result in the DB
Order saved = service.place(command);
assertThat(orderRepository.findById(saved.getId()))
    .get()
    .returns(OrderStatus.NEW, Order::getStatus)
    .returns(command.customerId(), Order::getCustomerId);
```

`verify` fits only when **the call itself is the observable behavior** and there is no cheaper observable proof: an email was sent, an event was published to Kafka, an external API was called exactly once.

### Mock at the right level

Before replacing a method, learn all its side effects. Mock the slow or external level *below* them, and keep what the test depends on real. Not sure — first run the test on the real implementation and see what actually has to happen.

```java
// ❌ Mocking the RestClient fluent chain: checks that you called methods in the right order,
//    not that the request went out with the right body and the response was parsed right
when(restClient.post()).thenReturn(requestSpec);
when(requestSpec.uri(anyString())).thenReturn(requestSpec);
// ...

// ✅ WireMock at the HTTP boundary: a real client, real serialization, real retries
wireMock.stubFor(post("/v1/charges")
    .withRequestBody(matchingJsonPath("$.amount", equalTo("125.50")))
    .willReturn(okJson("""
        {"id": "ch_1", "status": "succeeded", "amount": "125.50", "currency": "EUR"}
        """)));
```

```java
// ❌ @MockitoBean replaces the very bean whose behavior is under test
@MockitoBean DiscountPolicy discountPolicy;   // and the test is called discountIsApplied...

// ✅ Mock only the external part; the bean under test is real
@MockitoBean PaymentGateway paymentGateway;
```

### Make doubles specific

If the arguments, the number of calls or the order are part of the contract, check them. A double that accepts anything (`any()` everywhere) checks nothing. Every branch (success, error, malformed response) gets its own fixture or stub, so the wrong branch cannot satisfy the expectation.

```java
// ✅ Idempotency is part of the contract: the retry goes with the same key
wireMock.verify(2, postRequestedFor(urlEqualTo("/v1/charges"))
    .withHeader("Idempotency-Key", equalTo(command.idempotencyKey())));
```

### Mirror real data in full

A response stub repeats the full real structure — all documented fields, not only those the test reads. A partial stub silently passes when the code underneath reads a missing field: the test is green, the integration is broken. The best source is a real response example from the API docs or one recorded by WireMock.

### Production classes contain only production methods

Cleanup, reset and access to internals needed only by tests live in test utilities, not in `src/main`:

- no `reset()`/`clear()`/`destroy()` on a production bean "for tests" — truncate tables between tests, use a fresh instance, `@DirtiesContext` as a last resort;
- no `@VisibleForTesting`, widened visibility or setters for a test — check through public behavior;
- no `@Profile("test")` beans in `src/main` — a `@TestConfiguration` in `src/test`;
- no `ReflectionTestUtils.setField` — inject the dependency through the constructor.

Ask yourself: is this method called only from tests? Does this class own the resource's lifecycle? A wrong answer → a test utility.

### Prefer real components to complex mocks

When the mock setup is bigger than the test logic, mocks do not know methods the real components have, or tests break when a mock changes — move to a slice or integration test with real components. The question to ask yourself: "Do I need a mock here at all?"

### Gate

```
BEFORE adding a mock or a helper:
  List the real method's side effects; keep those the test depends on
  real — mock the slow/external level below them.

  Stub responses repeat the full real structure.

  A method called only by tests lives in src/test.

  About to assert on the mock itself?
    Remove the mock or delete the assertion.
```

## Tests come with the implementation

The cycle — a failing test, a minimal implementation, refactoring — is the definition of "done". Write the tests the behavior needs, and only those: trivial code gets zero tests, and a test written for the process or for coverage costs maintenance forever.

## Mutation check

Before finishing, mutate the production code in your head. For every realistic mutation at least one test must fail:

- a wrong constant or argument (`>` instead of `>=`, `5` instead of `3`);
- calling the wrong branch handler;
- a missing state change or side effect (not saved, event not published);
- an empty result or a default value (`return null`, `List.of()`, `Optional.empty()`);
- a missing check for `null`, empty, zero, someone else's id, no permission, invalid input.

A mutation nothing catches is unprotected behavior or a tautological test. For a critical class you can run PIT (`pitest-maven` / `info.solidsoft.pitest`) and look at the surviving mutants.

## Quick reference

| When you... | Do |
|---|---|
| Write any test | Name the breakage it catches — a bug, not a decision |
| Build an expected value | A literal or a hand-made fixture; not through the code under test |
| Check a JSON response | Literal JSON in a text block, not a serialization of the same DTO |
| Want to test a derived query / an annotation | Test your scenario, not Spring's mechanics |
| Want to `verify` | First look for an observable effect: DB, response, event |
| Are about to mock a method | Learn its side effects; mock the external level |
| Mock an HTTP client | WireMock at the boundary, not the fluent chain |
| Write a response stub | The full real structure |
| Need cleanup only for tests | `src/test`: truncate, a fixture, `@TestConfiguration` |
| The mock setup keeps growing | A slice or integration test with real components |
| Finish a test class | Mutation check |

## Warning signs

- setup and assertion use the same object — equality is guaranteed;
- the test can fail only from an NPE, a failed context or a missing selector;
- the test fails on every deliberate change and never on an accidental breakage;
- expected values are hidden in loops, builders or helpers of the code under test;
- the test greps the source, an SQL string or a log;
- the test would stay meaningful even if only the framework were left of your code;
- the test exists for coverage and checks neither a result nor a side effect;
- the only assertion is `isNotNull()` / `assertDoesNotThrow` on something that cannot be null or throw;
- a method in `src/main` is called only from tests;
- the mock setup is more than half the test, or you cannot explain why the mock is there;
- a mock "just in case";
- `@Transactional` on a test class in a scenario where the commit matters (AFTER_COMMIT listeners, outbox, deferred constraints).

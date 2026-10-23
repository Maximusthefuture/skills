# Project structure in detail

**Open when:** a class does not fit the tree in SKILL.md at first glance, you are about to create a new package, or you are naming a class.

## Where a class goes

| Class | Package | Note |
|---|---|---|
| `@RestController` | `controller` | one controller per generated `*Api` interface |
| `@RestControllerAdvice`, `ProblemDetail` builder | `exception` | next to the exceptions it handles |
| business exception (`OrderNotFoundException`) | `exception` | |
| `@Service` with business logic, `@Transactional` | `service` | |
| a second bean split out of a service for a transaction boundary (`PaymentDispatchTx`) | `service` | it is still business logic |
| interface of a service | `service` | only if there are two implementations now; one implementation — no interface |
| `JpaRepository`, custom repository fragment and its `Impl` | `repository` | |
| `@Entity`, `@Embeddable`, an enum stored in a column | `entity` | |
| enum used only in the API | — | it is generated from the spec |
| MapStruct `@Mapper` or a hand-written mapper | `mapper` | `OrderMapper`: entity ↔ generated DTO |
| `@Configuration`, `@ConfigurationProperties`, `SecurityFilterChain` bean | `config` | |
| outbound HTTP / gRPC client, its DTOs | `client` | client DTOs go to `client`, not `dto`, if only the client uses them |
| `@KafkaListener`, `@RabbitListener`, `@EventListener` | `listener` | the listener only converts and calls a service |
| `KafkaTemplate` / `RabbitTemplate` sender, outbox relay that publishes stored events | `producer` | `OrderEventsProducer`; the service decides what to send, the producer only serializes and sends |
| `@Scheduled` | `scheduler` | the job only calls a service |
| event payload, internal command object | `dto` | only what is not in the OpenAPI spec |
| pure static function (dates, strings, money rounding) | `util` | see limits below |

Still unclear — the class probably does two jobs. Split it rather than invent a package. If the class really needs a new package (`validation`, `security`), create it at the same level as the others and mention it in the report.

## Limits

- **One level.** No sub-packages inside a layer (`service/order/…`) unless the project already has them — then follow the project.
- **`util`** — a `final` class with a private constructor and static methods only. No Spring beans, no state, no business rules: "orders over 1000 get a discount" is a service, not a util. Named by what it works with: `MoneyUtils`, `DateUtils`; not `Helper`, `CommonUtils`.
- **`config`** — wiring and properties only. A `@Bean` method that contains business logic is a service in disguise.
- **`listener`, `producer` and `scheduler`** — transport only. A listener and a job parse and call a service; a producer is called by a service and only serializes and sends. Transactions and logic live in the service, so the same logic can be tested without Kafka or a clock. An outbox relay may read the outbox table through a repository — it is still only transport.
- **`controller`** — no business logic and no `@Transactional`: take the request, call one service method, return the response.

## Naming

| Kind | Name |
|---|---|
| controller | by the generated interface: `OrdersApi` → `OrdersController` |
| service | `OrderService`; implementation of an interface — `DefaultOrderService` or by what differs (`StripePaymentGateway`), not `OrderServiceImpl` unless the project already uses `Impl` |
| repository | `OrderRepository` |
| entity | `Order`; if the generated model is also called `Order`, see [openapi-workflow.md](openapi-workflow.md#name-clash-between-a-model-and-an-entity) |
| mapper | `OrderMapper` |
| config | `KafkaConfig`, `PaymentProperties` for `@ConfigurationProperties` |
| listener / producer | `PaymentCompletedListener`, `OrderEventsProducer` |
| exception | `OrderNotFoundException`, ends with `Exception` |

## What never goes into `src/main/java`

- generated code: it lives in `target/generated-sources` / `build/generate-resources` and is rebuilt every time;
- copies of generated models "to tweak a field" — change the spec instead;
- test doubles (`FakePaymentGateway`) — they belong in `src/test`, unless the project runs them in a dev profile on purpose; then they go to the package of what they replace and carry `@Profile`.

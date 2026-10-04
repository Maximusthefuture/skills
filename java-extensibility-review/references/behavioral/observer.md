# Observer

Group: behavioral

## Essence
An object publishes an event "something happened" and does not know who reacts to it. Subscribers are added without touching the publisher. In Spring this is `ApplicationEventPublisher` + `@EventListener` / `@TransactionalEventListener` inside the application, and a broker (Kafka, RabbitMQ) between services.

## Structure (participants)
- **Publisher (Subject)** — the object where the event happens. Publishes it and does not know the subscribers (`OrderService` + `ApplicationEventPublisher`).
- **Event** — an immutable message about what happened (`OrderCreated`).
- **Subscriber (Listener)** — the reaction interface or method (`@EventListener`, `@TransactionalEventListener`).
- **ConcreteSubscribers** — the reactions: an email, audit, analytics. The Spring container registers them, not the publisher by hand.

```
Publisher ──publish(event)──▶ ApplicationEventMulticaster ──▶ ListenerA
                                                         ├──▶ ListenerB
                                                         └──▶ ListenerC
```

## Signs in Java/Spring code
- The main action is followed by a tail of side effects:
  ```java
  orderRepository.save(order);
  emailService.sendConfirmation(order);
  auditService.log(order);
  analyticsClient.track(order);
  loyaltyService.addPoints(order);
  ```
- Every new reaction to "order created" requires editing `OrderService`.
- The service constructor takes many dependencies unrelated to its job.
- Modules know about each other only for notifications.

## When not to apply
- The effect is part of a business invariant (deducting stock when an order is created). It must be an explicit call in the same transaction, not a reaction that is easy to lose.
- The reaction's result is needed (to answer the client) — that is a plain call.

## After
```java
public record OrderCreated(UUID orderId, UUID customerId, BigDecimal total) {}

@Service
@RequiredArgsConstructor
class OrderService {
    private final OrderRepository orders;
    private final ApplicationEventPublisher events;

    @Transactional
    public Order create(CreateOrder cmd) {
        var order = orders.save(Order.from(cmd));
        events.publishEvent(new OrderCreated(order.getId(), order.getCustomerId(), order.getTotal()));
        return order;
    }
}

@Component
@RequiredArgsConstructor
class OrderConfirmationEmail {
    private final EmailService email;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(OrderCreated e) { email.sendConfirmation(e.orderId()); }
}
```
A new reaction is a new class with a listener. `OrderService` does not change.

## Reliability — always mention it in the recommendation
- `@EventListener` is synchronous and runs inside the publisher's transaction. An exception in the listener rolls back the order creation.
- `@TransactionalEventListener(AFTER_COMMIT)` fires after the commit, but the event lives only in memory: if the process dies, the reaction is lost. Money and external systems need an outbox (an event table in the same transaction) or the Spring Modulith Event Publication Registry.
- Inside `AFTER_COMMIT` there is no transaction anymore. If the listener must write to the DB, use `@Transactional(propagation = REQUIRES_NEW)`.
- `@Async` on a listener removes the latency from the request but needs its own thread pool and a decision about losing events on restart.
- An event is an immutable `record` with identifiers, not a JPA entity: an entity may be detached or lazy.

## Refactoring steps
1. Decide which effects are invariants (they stay explicit) and which are reactions.
2. Introduce an event `record`, publish it next to the current calls.
3. Move the reactions into listeners one at a time, choosing the phase and synchronicity.
4. Tests: event publication (`@RecordApplicationEvents` in Spring Test) and a separate test per listener.

## Pitfalls
- Implicit control flow: `OrderService` no longer shows that an email is sent. Name events in the past tense and listeners after the reaction.
- Event chains (a listener publishes the next event) quickly become unreadable. Once a process appears, you need `mediator.md`.

## Pros and cons
**Pros**
- The publisher does not depend on subscribers; a new reaction does not require editing it (Open/Closed).
- Reactions can be added from other modules.
- Links are established at runtime and by configuration.

**Cons**
- Implicit control flow: the publisher does not show what will happen.
- The notification order is not obvious (`@Order` is needed).
- Errors and transactions: a synchronous listener can roll back the publisher's transaction, an asynchronous one can lose the event.
- Event chains quickly become unreadable.

## Related patterns
Mediator (a coordinator that knows the participants) · Command (event vs command: "happened" vs "do it") · State (events on a status change).

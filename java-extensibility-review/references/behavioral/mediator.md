# Mediator

Group: behavioral

## Essence
Components do not call each other directly. They communicate through a mediator that knows the participants and coordinates the process. A network of "everyone with everyone" links turns into a star. In a backend the mediator is an orchestrator service (a process manager, a saga orchestrator) or, in a weaker form, an event bus.

## Structure (participants)
- **Mediator** — the mediator interface or class through which components communicate.
- **ConcreteMediator** — knows all participants and coordinates them: step order, compensations (`CheckoutProcess`).
- **Components** — the participants (`InventoryService`, `PaymentService`). They know only their own work and, if needed, the mediator, but not each other.

```
   CompA ──┐                 ┌──▶ CompA
   CompB ──┼──▶ Mediator ────┼──▶ CompB
   CompC ──┘                 └──▶ CompC
 (a star instead of "everyone with everyone" links)
```

## Signs in Java/Spring code
- Services call each other in a circle: `OrderService → PaymentService → OrderService`. The cycles are broken with `@Lazy`, setter injection or `spring.main.allow-circular-references=true`.
- Every service knows about many others: 6–10 "neighbor" services in the constructor.
- A multi-step process (order → reservation → payment → shipping) is smeared across services, and there is no single place where the whole flow and its compensations are visible.
- Changing the step order requires edits in several classes.

## When not to apply
- 2–3 participants with simple links.
- The participants need no coordination, notifying subscribers is enough → `observer.md`.

## After — a process orchestrator
```java
@Service
@RequiredArgsConstructor
class CheckoutProcess {                       // the mediator: the only one who knows the step order
    private final InventoryService inventory;
    private final PaymentService payments;
    private final ShippingService shipping;
    private final OrderRepository orders;

    public void run(UUID orderId) {
        var order = orders.getRequired(orderId);
        var reservation = inventory.reserve(order);
        try {
            payments.charge(order);
        } catch (PaymentDeclinedException e) {
            inventory.release(reservation);   // the compensation is visible next to the step
            throw e;
        }
        shipping.schedule(order);
    }
}
```
`InventoryService`, `PaymentService` and `ShippingService` no longer know about each other. A new step or a changed order is an edit in one place.

For asynchronous processes the mediator stores the process state in the DB (a process manager) and reacts to step events. That is already a saga orchestrator.

## Mediator vs events
- An orchestrator (Mediator): the flow is explicit and readable in one class, but the orchestrator knows all participants.
- Events (Observer): participants are fully decoupled, but the flow is implicit and has to be pieced together from the listeners.
For processes with compensations and an important order an orchestrator is usually better. For independent reactions — events.

## Refactoring steps
1. Draw the current call graph between services (from the constructors).
2. Extract the process into an orchestrator class, leave the participants only their local operations.
3. Remove the reverse dependencies and `@Lazy`.

## Pitfalls
- An orchestrator growing into a God class: make one mediator per process, not one for the whole system.
- Transaction boundaries: steps with external calls must not hold one long DB transaction.

## Pros and cons
**Pros**
- Many-to-many links become one-to-many.
- Components are easier to reuse and test: they do not know about each other.
- The whole process is visible in one class; the step order changes in one place.

**Cons**
- The mediator risks becoming a God object.
- The complexity does not disappear; it concentrates in one place.
- If everything goes through the mediator, simple links get needless indirection.

## Related patterns
Observer (decoupling through events) · Facade (simplifies access to subsystems but does not coordinate them with each other) · Command (process steps as commands).

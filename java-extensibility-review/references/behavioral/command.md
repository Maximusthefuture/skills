# Command

Group: behavioral

## Essence
A request for an action becomes an object: it holds everything needed to perform the action. Such an object can be passed to a handler, queued, stored, logged, retried or undone. In a backend this is usually a pair "a command `record` + a handler bean" and a dispatcher between them.

## Structure (participants)
- **Command** — a request object with all the data for execution (`CancelOrder(orderId, reason)`). Classically it has an `execute()` method (and `undo()`).
- **Receiver** — the one doing the real work (services, repositories).
- **Invoker** — runs commands without knowing their contents (a dispatcher, a job queue, a scheduler, a consumer).
- **Client** — creates the command and passes it to the invoker (a controller, a Kafka listener).
- In a backend a command is usually split into data (a `record`) and a handler (`CommandHandler`). The handler combines the `execute` and Receiver roles.

```
Client ──creates──▶ Command(data)
Invoker ──dispatch(cmd)──▶ CommandHandler<Cmd> ──▶ Receiver (services, repositories)
```

## Signs in Java/Spring code
- One endpoint or consumer with a big `switch (action)` / `switch (message.getType())`, where every branch is a separate use case.
- A 1500+ line service collecting all operations on an entity, each pulling its own dependencies.
- Operations must run deferred or on a schedule, be retried on failure, written to a log, undone.
- The same operation is called from REST, Kafka and a scheduler, and its parameters are assembled differently each time.

## When not to apply
- 3–4 operations in a small service. A CQRS framework (Axon etc.) for that is overkill.
- There are no queues, no log, no undo, and dispatching by key is already solved by a Strategy.

## After
```java
public sealed interface OrderCommand permits CreateOrder, CancelOrder, ChangeAddress {}
public record CreateOrder(UUID customerId, List<Line> lines) implements OrderCommand {}
public record CancelOrder(UUID orderId, String reason) implements OrderCommand {}
public record ChangeAddress(UUID orderId, Address address) implements OrderCommand {}

public interface CommandHandler<C extends OrderCommand> {
    Class<C> commandType();
    void handle(C command);
}

@Component
@RequiredArgsConstructor
class CancelOrderHandler implements CommandHandler<CancelOrder> {
    private final OrderRepository orders;
    public Class<CancelOrder> commandType() { return CancelOrder.class; }
    @Transactional public void handle(CancelOrder c) { /* … */ }
}

@Component
class CommandDispatcher {
    private final Map<Class<?>, CommandHandler<?>> handlers;

    CommandDispatcher(List<CommandHandler<?>> all) {
        this.handlers = all.stream().collect(Collectors.toMap(CommandHandler::commandType, Function.identity()));
    }

    @SuppressWarnings("unchecked")
    public <C extends OrderCommand> void dispatch(C command) {
        var handler = (CommandHandler<C>) handlers.get(command.getClass());
        if (handler == null) throw new IllegalArgumentException("No handler for " + command.getClass().getSimpleName());
        handler.handle(command);
    }
}
```
The controller, consumer and scheduler only assemble the command and call `dispatch`. The logic of every operation lives in its own handler.

An explicit `commandType()` is simpler and more reliable than extracting the generic parameter by reflection (a CGLIB proxy loses the generic).

## Deferred execution, retry, log
A command is a `record`, so it is easy to serialize to JSON and put into a job table or an outbox. A worker reads it, calls `dispatch`, marks it done. A retry after a failure is another `dispatch` of the same object, so the handler must be idempotent (an idempotency key in the command).

## Undo
If undo is needed, the command or the handler gets an `undo(...)`, or the handler returns a compensating command. For complex state see `memento.md`.

## Ready-made routing — check it first
Kafka: several `@KafkaHandler`s by payload type in one `@KafkaListener` (a class annotated with `@KafkaListener`). Spring Integration / Spring Cloud Stream routing. In REST separate endpoints are often enough instead of an `action` in the request body.

## Refactoring steps
1. Tests on every branch of the `switch (action)`.
2. Extract a command `record` and a handler for one branch; the branch calls the handler.
3. Repeat for the rest; introduce the dispatcher; remove the `switch`.

## Pitfalls
- Do not wrap every method call in a command: there must be a reason (dispatching, a queue, a log).
- Put `@Transactional` on `handle`, not on the dispatcher, otherwise all commands end up in one transaction.

## Pros and cons
**Pros**
- The sender is separated from the executor.
- Operations can be queued, deferred, logged, retried and undone.
- A new operation is a new "command + handler" pair; the invoker does not change.
- Composite commands (macros) are assembled from simple ones.

**Cons**
- Many small classes.
- Indirection: the call site does not show which code runs.
- Serializable commands (queues, outbox) are a contract with a schema and versions.

## Related patterns
Strategy (how to do it, not what) · Chain of Responsibility (a command passes a middleware chain) · Memento (undo via a snapshot) · Observer (an event "happened" vs a command "do it").

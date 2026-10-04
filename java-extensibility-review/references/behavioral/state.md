# State

Group: behavioral

## Essence
An object's behavior depends on its current state. Instead of `if (status == …)` in every method, the rules (which transitions are allowed, how an operation behaves in this state) are gathered in a state object. In Java this is usually an enum: at the simple level — a transition table, at the full level — abstract methods on every constant.

## Structure (participants)
- **Context** — the object with changing behavior (`Order`). Holds the current state and delegates state-dependent operations to it.
- **State** — an interface (or enum) with operations whose behavior depends on the state (`cancel`, `pay`, `ship`).
- **ConcreteState** — the behavior in a concrete state (`NEW`, `PAID`, `SHIPPED`). Decides whether the operation is allowed and which state comes next.

```
Context ──current──▶ «interface» State ◀── NewState, PaidState, ShippedState
   ▲                                              │
   └────────── transition: context.state = next ──┘
```
The difference from Strategy: the state changes from inside, over the object's life, and states know about the transitions between them.

## Signs in Java/Spring code
- `if (order.getStatus() == NEW && target == PAID) … else if (…)` in several services.
- The `cancel()`, `ship()`, `refund()` methods start with the same status checks.
- The status is changed with a setter from different places (`order.setStatus(…)`), there is no single point of change.
- Bugs like "the order was cancelled after shipping".

## When not to apply
- The status is just a label without rules.
- Long processes with timers, nested states and process persistence. First estimate whether a table in an enum is enough; Spring Statemachine or Camunda — only if their complexity is really needed.

## Before
```java
void cancel(Order o) {
    if (o.getStatus() == SHIPPED || o.getStatus() == DELIVERED) throw new IllegalStateException();
    if (o.getStatus() == PAID) refundService.refund(o);
    o.setStatus(CANCELLED);
}
void ship(Order o) {
    if (o.getStatus() != PAID) throw new IllegalStateException();
    o.setStatus(SHIPPED);
}
```

## After — level 1: a transition table in the enum
```java
public enum OrderStatus {
    NEW, PAID, SHIPPED, DELIVERED, CANCELLED;

    private static final Map<OrderStatus, Set<OrderStatus>> TRANSITIONS = new EnumMap<>(Map.of(
            NEW,       EnumSet.of(PAID, CANCELLED),
            PAID,      EnumSet.of(SHIPPED, CANCELLED),
            SHIPPED,   EnumSet.of(DELIVERED),
            DELIVERED, EnumSet.noneOf(OrderStatus.class),
            CANCELLED, EnumSet.noneOf(OrderStatus.class)));

    public boolean canTransitionTo(OrderStatus next) {
        return TRANSITIONS.get(this).contains(next);
    }
}

// in the entity — the single point of status change, no public setStatus
public void transitionTo(OrderStatus next) {
    if (!status.canTransitionTo(next)) throw new IllegalStatusTransitionException(status, next);
    this.status = next;
}
```

## After — level 2: behavior per state
When operations behave differently in different states:
```java
public enum OrderState {
    NEW {
        @Override OrderState cancel(Order o, OrderEffects fx) { return CANCELLED; }
        @Override OrderState pay(Order o, OrderEffects fx)    { return PAID; }
    },
    PAID {
        @Override OrderState cancel(Order o, OrderEffects fx) { fx.refund(o); return CANCELLED; }
        @Override OrderState ship(Order o, OrderEffects fx)   { fx.ship(o);   return SHIPPED; }
    },
    SHIPPED, DELIVERED, CANCELLED;

    // by default the operation is forbidden
    OrderState cancel(Order o, OrderEffects fx) { throw illegal("cancel"); }
    OrderState pay(Order o, OrderEffects fx)    { throw illegal("pay"); }
    OrderState ship(Order o, OrderEffects fx)   { throw illegal("ship"); }

    private IllegalStatusTransitionException illegal(String op) {
        return new IllegalStatusTransitionException(this, op);
    }
}
```
`OrderEffects` is an interface implemented by a Spring bean. The states call side effects through it, and the enum holds no dependencies. If the effects are heavy, it is better to publish an `OrderStatusChanged` event (see `observer.md`).

## Refactoring steps
1. Collect all places that change the status: `grep -rn "setStatus\|getStatus() ==" src/main/java`.
2. A parameterized test over all (from, to) pairs with the current behavior.
3. Introduce the transition table and `transitionTo`; replace `setStatus` in the services.
4. If needed, move the per-state behavior into the enum or into state classes.

## Pitfalls
- A full parameterized test of the table (all pairs) is cheap and valuable. Propose it together with the refactoring.
- A concurrent status change needs `@Version` (optimistic locking) or a conditional `UPDATE … WHERE status = :expected`.
- The enum is stored in the DB (`@Enumerated(STRING)`): constants can be added, but not renamed.

## Pros and cons
**Pros**
- The rules of each state are gathered in one place, not smeared as `if (status == …)` across services.
- Allowed transitions are explicit and easily covered by a table test.
- The context's methods get simpler: no branching on the status.

**Cons**
- Overkill for 2–3 states without their own logic.
- States know about each other (who is next), and that is coupling.
- Beans cannot be injected into an enum implementation. Side effects have to go through a parameter or events.
- With dozens of states and operations the logic splinters into many small methods.

## Related patterns
Strategy (a similar structure, but chosen from outside) · Observer (reactions to a status change) · Memento (rolling back the state).

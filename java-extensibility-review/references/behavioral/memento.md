# Memento

Group: behavioral

## Essence
An object makes an immutable snapshot of its state itself and can restore itself from it. External code stores the snapshots but neither sees nor changes their contents. Encapsulation is kept: undo does not require opening setters for every field.

## Structure (participants)
- **Originator** — the object whose state is saved (`PricingDraft`). It creates the snapshot (`snapshot()`) and restores itself from it (`restore()`).
- **Memento** — an immutable snapshot of the state. The rest of the code must not read or change its contents.
- **Caretaker** — stores the snapshots (an undo stack, a version history) but does not look inside (`DraftHistory`).

```
Caretaker ──stores──▶ [Memento, Memento, …]
Originator ──snapshot()──▶ Memento
Originator ◀──restore(m)── Caretaker
```

## Signs in Java/Spring code
- Before a complex operation fields are copied into temporary variables and restored by hand on an error, and a new field gets forgotten.
- "Undo", "restore the previous version", "compare with the draft" features in document editors, tariff builders, settings.
- An entity has public setters needed only so that someone outside can roll back its state.
- A multi-step in-memory operation (a calculation, a simulation) with a rollback to a checkpoint.

## When not to apply
- A DB transaction already gives the rollback — throwing an exception is enough.
- History is needed only for audit — Hibernate Envers (`@Audited`) or an event log.
- The full change history as the source of truth is already event sourcing, a separate architectural decision.

## After
```java
public class PricingDraft {
    private BigDecimal basePrice;
    private List<Discount> discounts = new ArrayList<>();
    private Currency currency;

    /** An immutable snapshot; only PricingDraft sees its contents. */
    public record Snapshot(BigDecimal basePrice, List<Discount> discounts, Currency currency) {
        public Snapshot { discounts = List.copyOf(discounts); }  // a defensive copy
    }

    public Snapshot snapshot() {
        return new Snapshot(basePrice, discounts, currency);
    }

    public void restore(Snapshot s) {
        this.basePrice = s.basePrice();
        this.discounts = new ArrayList<>(s.discounts());
        this.currency = s.currency();
    }
}

// the history keeper (caretaker)
public class DraftHistory {
    private final Deque<PricingDraft.Snapshot> undo = new ArrayDeque<>();
    public void save(PricingDraft d) { undo.push(d.snapshot()); }
    public void undo(PricingDraft d) { if (!undo.isEmpty()) d.restore(undo.pop()); }
}
```
The strict variant: the `record`'s fields are not public to other packages (a private nested class + an opaque marker interface). In practice an immutable `record` is usually enough.

## Storing snapshots in the DB
A snapshot can be serialized to JSON (`jsonb`) for document versions. Then the snapshot has a schema: add a `version` field and plan how old snapshots are read after the class changes.

## Refactoring steps
1. A test: change → roll back → the state equals the original (`usingRecursiveComparison()` in AssertJ).
2. Introduce `snapshot()`/`restore()` in the object itself and replace the manual copying.
3. Remove the setters that were needed only for the rollback.

## Pitfalls
- A shallow copy of mutable fields (lists, `java.util.Date`): the snapshot changes together with the object.
- Memory: a snapshot of a big object per action. Limit the history depth or store a diff.
- A JPA entity: `restore` on a managed entity is written to the DB at the next flush. That may be wanted or may be a surprise.

## Pros and cons
**Pros**
- Saving and rolling back state without breaking encapsulation: no public setters for the rollback.
- A simpler Originator: the caretaker manages the history.
- Undo/redo, versions and checkpoints come naturally.

**Cons**
- Memory: snapshots of big objects per action.
- The caretaker must manage the snapshots' lifecycle (how many to keep, when to delete).
- In Java it is hard to strictly forbid reading a snapshot's contents; usually you rely on an immutable `record`.
- Snapshots stored in the DB get a schema that must be versioned.

## Related patterns
Command (undo via a reverse operation instead of a snapshot) · Prototype (copying the whole object) · State (rolling back a status).

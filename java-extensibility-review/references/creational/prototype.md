# Prototype

Group: creational

## Essence
A new object is created by copying an existing one (the prototype), not by assembling from scratch. The object itself knows how to copy itself correctly, so the client does not need to know its concrete class and internal fields. In Java `clone()` is considered a failed API. Use copy methods, copy constructors, `with` methods on a `record` or `toBuilder()`.

## Structure (participants)
- **Prototype** — an interface or convention with a copy method (`copy…()`).
- **ConcretePrototype** — implements copying itself: knows its fields and what to copy deeply (`Tariff.copyAsDraft`).
- **Client** — creates new objects by copying, without knowing the concrete class.
- **Prototype Registry** (optional) — stores preconfigured prototypes by key (tariff or document templates).

```
Client ──copy()──▶ «Prototype» ◀── ConcretePrototype
Registry { "basic" → prototype, "premium" → prototype } ──copy()──▶ a new object
```

## Signs in Java/Spring code
- Features like "duplicate a tariff", "create a document from a template", "copy project settings".
- Manual field copying `copy.setX(orig.getX())` in several places, and a new field gets forgotten.
- `Cloneable` / `clone()` is implemented, especially with mutable fields.
- An expensive object assembly (loading from several sources) repeats for small variations.

## When not to apply
- The objects are immutable (`record`, value objects) — they can simply be shared. `withX(...)` is enough for a variation.
- A simple object with 2–3 fields.
- Do not confuse it with Spring's `@Scope("prototype")` — that is "a new bean per request to the container", not copying.

## After
```java
@Entity
public class Tariff {
    @Id @GeneratedValue private Long id;
    @Version private long version;
    private String name;
    private BigDecimal basePrice;
    @OneToMany(mappedBy = "tariff", cascade = ALL, orphanRemoval = true)
    private List<TariffOption> options = new ArrayList<>();

    protected Tariff() {}

    /** A copy for "duplicate tariff": without id/version, with a deep copy of the options. */
    public Tariff copyAsDraft(String newName) {
        var copy = new Tariff();
        copy.name = newName;
        copy.basePrice = this.basePrice;
        this.options.forEach(o -> copy.addOption(o.copy()));
        return copy;
    }

    public void addOption(TariffOption o) { options.add(o); o.attachTo(this); }
}
```
For a `record`: `withName(...)`, `toBuilder()` (Lombok) or a MapStruct mapper `Tariff copy(Tariff source)` with `@Mapping(target = "id", ignore = true)`.

## A test that catches forgotten fields
```java
assertThat(copy).usingRecursiveComparison()
        .ignoringFields("id", "version", "name", "options.id", "options.tariff")
        .isEqualTo(original);
```
When a field is added to the class and not copied, the test fails.

## Refactoring steps
1. Collect all manual copying sites; write a recursive comparison test.
2. Move the copying into the class itself (`copy…`), replace the calls.
3. Remove `Cloneable`/`clone()`.

## Pitfalls
- A shallow copy of mutable collections and objects: changes to the copy are visible in the original.
- JPA: the copy must be a new entity — without `id` and `@Version`, with bidirectional associations properly rebound. Copying lazy collections outside a transaction gives `LazyInitializationException`.
- What to copy and what to share (a reference to a shared dictionary or a copy) is a business decision. Pin it in the method name and in the test.

## Pros and cons
**Pros**
- Copying without knowing the concrete class and internal fields.
- No repeated expensive initialization.
- Handy preconfigured templates instead of a subclass per configuration.

**Cons**
- Deep copying of object graphs (cycles, associations, resources) is hard.
- Every class of the hierarchy must support copying correctly.
- For JPA entities you must decide explicitly what to do with the id, version and associations.

## Related patterns
Builder (`toBuilder()` — a copy with changes) · Memento (a snapshot for restoring, not for a new object) · Factory Method · Flyweight (share instead of copy).

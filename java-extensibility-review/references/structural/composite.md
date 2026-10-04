# Composite

Group: structural

## Essence
Objects are assembled into a tree, and the leaf and the group implement one interface. The client calls `evaluate()` / `price()` / `render()` on the root and does not distinguish a leaf from a group: the group delegates to its children and aggregates the result itself.

## Structure (participants)
- **Component** — the common interface for leaves and groups (`Rule.matches`, `PriceItem.price`).
- **Leaf** — a terminal element without children (`MinAmount`, `Product`).
- **Composite** — a group: holds children of type Component, delegates the operation to them and aggregates the result (`AllOf`, `Bundle`).
- **Client** — works with any node through Component and does not distinguish a leaf from a group.

```
            «interface» Component
              operation()
             ▲            ▲
           Leaf        Composite ──children──▶ Component*
                        operation() = aggregate(children.operation())
```

## Signs in Java/Spring code
- Recursion with `if (node instanceof Group g) … else if (node instanceof Item i)` in several places.
- Nested loops for a fixed depth (`for category → for sub → for subsub`) that break at the fourth level.
- Rules with AND/OR/NOT combinations written in code with `&&`/`||`, which you would like to store in config or the DB.
- Product bundles and kits with a composite price, an org structure, permission groups, menus.

## When not to apply
- The structure is flat, or the depth is strictly fixed and small.
- All elements are of one type — a plain list is enough.

## After — a rule tree
```java
public sealed interface Rule permits AllOf, AnyOf, Not, MinAmount, CustomerSegment {
    boolean matches(OrderContext ctx);
}
public record AllOf(List<Rule> rules) implements Rule {
    public boolean matches(OrderContext ctx) { return rules.stream().allMatch(r -> r.matches(ctx)); }
}
public record AnyOf(List<Rule> rules) implements Rule {
    public boolean matches(OrderContext ctx) { return rules.stream().anyMatch(r -> r.matches(ctx)); }
}
public record Not(Rule rule) implements Rule {
    public boolean matches(OrderContext ctx) { return !rule.matches(ctx); }
}
public record MinAmount(BigDecimal min) implements Rule {
    public boolean matches(OrderContext ctx) { return ctx.total().compareTo(min) >= 0; }
}
public record CustomerSegment(String segment) implements Rule {
    public boolean matches(OrderContext ctx) { return ctx.segment().equals(segment); }
}

// "total ≥ 5000 AND (VIP OR NOT a new customer)"
Rule promo = new AllOf(List.of(
        new MinAmount(new BigDecimal("5000")),
        new AnyOf(List.of(new CustomerSegment("VIP"), new Not(new CustomerSegment("NEW"))))));
```
With `@JsonTypeInfo` (`../java-idioms/polymorphic-json.md`) such a tree is stored in the DB or config as JSON, and new promotions are set up without a deploy. Built-in Composites in Java/Spring: `Predicate.and/or/negate`, `Specification.allOf/anyOf`, `CompositeMeterRegistry`.

## After — a composite price
```java
public sealed interface PriceItem permits Product, Bundle {
    Money price();
}
public record Product(String sku, Money price) implements PriceItem {}
public record Bundle(String name, List<PriceItem> items, Percent discount) implements PriceItem {
    public Money price() {
        return items.stream().map(PriceItem::price).reduce(Money.ZERO, Money::plus).discountBy(discount);
    }
}
```

## Refactoring steps
1. Tests on the current calculations with real example trees.
2. Introduce the common interface; the leaf and the group implement it; the group delegates to its children.
3. Replace the recursion with `instanceof` by a call on the root.

## Pitfalls
- Storing trees in JPA: an adjacency list + a recursive CTE, or a materialized path. Lazily traversing an entity tree is a guaranteed N+1.
- Cycles in the graph (a group containing itself) — infinite recursion. Validate at construction.
- Deep trees and recursion — a stack overflow. Big trees need an iterative traversal.

## Pros and cons
**Pros**
- Uniform handling of a tree of any depth.
- New node types are added without changing the client (Open/Closed).
- Recursive structures (rules, bundles, categories) are expressed naturally.

**Cons**
- The common interface may be too general: operations meaningless for a leaf.
- It is hard to restrict which nodes are allowed where (checks move to runtime).
- Deep trees: recursion, performance, storage in the DB.

## Related patterns
Visitor and sealed-switch (operations over the tree) · Iterator (tree traversal) · Specification (Composite for queries) · Chain of Responsibility.

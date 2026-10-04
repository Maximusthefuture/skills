# Visitor

Group: behavioral

## Essence
Operations over a structure of elements of different types move out of the elements into separate visitor classes. An element "accepts" a visitor and calls its method for the element's own type (double dispatch). A new operation is a new visitor; the element classes are not touched.

In Java 21 the same task is usually solved more simply by a sealed hierarchy + a `switch` with pattern matching (`../java-idioms/sealed-switch.md`): the compiler checks completeness just the same, with less ceremony.

## Structure (participants)
- **Visitor** — an interface with a method per element type (`visitText`, `visitTable`).
- **ConcreteVisitor** — one operation over the whole structure (`HtmlRenderer`, `MarkdownRenderer`).
- **Element** — an interface with an `accept(visitor)` method.
- **ConcreteElement** — in `accept` calls the visitor's method for its own type: `v.visitTable(this)` (double dispatch).
- **ObjectStructure** — a collection or tree of elements the visitor traverses.

```
Client ──▶ element.accept(visitor)
                 │
                 └──▶ visitor.visitTable(this)   // the method is chosen by the element type and the visitor type
```

## Signs in Java/Spring code
- There is a stable hierarchy of elements (an expression AST, a document or report tree, a rule tree, price list elements), and operations are regularly added over it: rendering to HTML/PDF, validation, calculation, export.
- The operations' code is `if (node instanceof X) … else if (node instanceof Y)` chains scattered across services; something gets forgotten when an operation is added.
- The element classes grow `toHtml()`, `toPdf()`, `validate()`, `calculate()` methods unrelated to their essence.

## When not to apply
- Java 21+ → sealed + `switch`.
- The set of element types grows often: every new type breaks all visitors. That axis of change needs a Strategy or polymorphism.
- There is one operation.

## After — the classic Visitor (Java < 21)
```java
public interface ReportElement {
    <R> R accept(ReportVisitor<R> v);
}

public final class TextBlock implements ReportElement {
    final String text;
    public TextBlock(String text) { this.text = text; }
    public <R> R accept(ReportVisitor<R> v) { return v.visitText(this); }
}

public final class Table implements ReportElement {
    final List<List<String>> rows;
    public Table(List<List<String>> rows) { this.rows = rows; }
    public <R> R accept(ReportVisitor<R> v) { return v.visitTable(this); }
}

public interface ReportVisitor<R> {
    R visitText(TextBlock t);
    R visitTable(Table t);
}

class HtmlRenderer implements ReportVisitor<String> {
    public String visitText(TextBlock t) { return "<p>" + escape(t.text) + "</p>"; }
    public String visitTable(Table t)    { /* … */ }
}
// a new operation (export to Markdown) is a new MarkdownRenderer class, the elements do not change
```

## After — Java 21
```java
public sealed interface ReportElement permits TextBlock, Table {}
public record TextBlock(String text) implements ReportElement {}
public record Table(List<List<String>> rows) implements ReportElement {}

String toHtml(ReportElement e) {
    return switch (e) {
        case TextBlock t -> "<p>" + escape(t.text()) + "</p>";
        case Table t     -> renderTable(t.rows());
    };
}
```

## Refactoring steps
1. Tests on every existing operation across all element types.
2. Java 21: move the hierarchy to `sealed` and replace the `instanceof` chains with a `switch` without `default`. Java < 21: introduce `accept`/`Visitor`, move the operations one at a time.

## Pitfalls
- A `default` in the `switch` or a base visitor with empty default methods disables the completeness check. A new type silently slips by.
- The visitor needs access to the elements' internals, which weakens encapsulation. For a `record` that is natural.
- Libraries already built on it (JavaParser `VoidVisitorAdapter`, jOOQ, ASM): use their visitors, do not invent your own.

## Pros and cons
**Pros**
- A new operation is added without changing the element classes.
- The logic of one operation is gathered in one class, not smeared across elements.
- A visitor can accumulate state during the traversal (counters, an output buffer).

**Cons**
- A new element type requires editing every visitor.
- The visitor needs access to the elements' data, which weakens encapsulation.
- Lots of ceremony (`accept` in every class). In Java 21 sealed + `switch` gives the same, shorter.

## Related patterns
Composite (the visitor traverses a tree) · Iterator (the traversal the visitor is applied to) · Strategy (the opposite axis of extension).

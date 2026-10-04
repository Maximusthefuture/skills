# Template Method

Group: behavioral

## Essence
A base class pins the skeleton of an algorithm in a `final` method and leaves individual steps to subclasses: abstract steps are mandatory, hook methods with default behavior are overridden if desired. The common order is set in one place, the differences — in the subclasses.

## Structure (participants)
- **AbstractClass** — sets the algorithm skeleton in a `final` template method and declares the steps: abstract (mandatory) and hook methods (with default behavior).
- **ConcreteClass** — overrides steps but does not change their order.

```
AbstractClass
  final templateMethod() { step1(); step2(); hook(); step3(); }
  abstract step1(); abstract step2(); hook() { /* default */ }
        ▲                         ▲
  ConcreteClassA            ConcreteClassB
  (step1, step2)            (step1, step2, hook)
```

## Signs in Java/Spring code
- `CsvImporter`, `XlsxImporter`, `XmlImporter` copy one skeleton "read → parse → validate → save → report", and the copies have started to drift (one got logging, another did not).
- A bug fix in a common step has to be repeated in several classes.
- Several jobs with the same harness: locking, metrics, error handling, a report.

## When not to apply (composition is often better)
- The steps combine in different ways (CSV + saving to S3, XLSX + saving to the DB). Inheritance gives a class explosion; a composition of step strategies is better.
- Subclasses need `if`s like "but I do not need this step".
- The hierarchy is already deeper than two levels.

## After — Template Method
```java
public abstract class Importer<R> {

    public final ImportReport importFile(InputStream in) {   // final: the skeleton is not overridden
        List<R> rows = parse(in);
        List<R> valid = validate(rows);
        save(valid);
        return ImportReport.of(rows.size(), valid.size());
    }

    protected abstract List<R> parse(InputStream in);
    protected abstract void save(List<R> rows);

    protected List<R> validate(List<R> rows) {                // a hook with default behavior
        return rows;
    }
}

@Component
@RequiredArgsConstructor
class ProductCsvImporter extends Importer<ProductRow> {
    private final ProductRepository products;
    @Override protected List<ProductRow> parse(InputStream in) { /* … */ }
    @Override protected void save(List<ProductRow> rows) { /* … */ }
}
```

## After — composing steps (often preferable)
```java
public record ImportPipeline<R>(Parser<R> parser, List<RowValidator<R>> validators, Sink<R> sink) {
    public ImportReport run(InputStream in) {
        List<R> rows = parser.parse(in);
        List<R> valid = rows.stream().filter(r -> validators.stream().allMatch(v -> v.isValid(r))).toList();
        sink.write(valid);
        return ImportReport.of(rows.size(), valid.size());
    }
}

@Configuration
class ImportConfig {
    @Bean ImportPipeline<ProductRow> productImport(CsvParser<ProductRow> parser,
                                                   List<RowValidator<ProductRow>> validators,
                                                   JpaSink<ProductRow> sink) {
        return new ImportPipeline<>(parser, validators, sink);
    }
}
```
How to choose: one stable skeleton and few subclasses — Template Method. Steps combine, or the steps need independent tests — composition.

## Refactoring steps
1. Tests on every existing importer (input → report and saved data).
2. Extract the common skeleton; express the differences as steps.
3. Migrate the classes one at a time and compare the behavior.

## Pitfalls
- An abstract class with `@Autowired` fields that only some subclasses need. Pass dependencies through the subclasses' constructors.
- `@Transactional` on a base class's `final` method does not work through a CGLIB proxy (final is not overridden). Put the transaction on the calling service or on a step.
- Hook methods overridden "just in case" make the skeleton unpredictable.

## Pros and cons
**Pros**
- Removes duplication of the common skeleton.
- The step order is guaranteed: a subclass cannot break it.
- Subclasses override only what really differs.

**Cons**
- The rigidity of inheritance: one base class, step combinations cannot be assembled.
- A subclass that "switches off" a step breaks the substitution principle (LSP).
- The skeleton is hard to change when there are many subclasses.
- Steps are harder to test separately than strategies in a composition.

## Related patterns
Strategy (the variant via composition) · Factory Method (often a step of a template method) · Chain of Responsibility (a pipeline of steps).

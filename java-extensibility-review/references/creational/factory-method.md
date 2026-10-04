# Factory Method

Group: creational

## Essence
The decision about which concrete class to create moves into a separate method or factory object. The client gets the object through a common interface and does not call `new ConcreteX`. In modern Java and Spring this is most often:
- named static factories (`Money.of`, `Order.draft`, `Range.closed`) instead of unclear constructors;
- a factory bean that creates objects with runtime parameters and Spring dependencies (`ObjectProvider`, prototype beans);
- one `switch` in a factory instead of a `switch` with `new` at every call site.

## Structure (participants)
- **Product** — the common interface of the created objects (`Exporter`).
- **ConcreteProduct** — concrete implementations (`PdfExporter`, `CsvExporter`).
- **Creator** — declares the factory method that returns a Product. Often also holds the logic that uses this product.
- **ConcreteCreator** — overrides the factory method and decides which class to create (`PdfExporterFactory`).
- In the Spring variant the Creator is a factory bean, and the ConcreteCreator is chosen by a registry by key.

```
Creator                                  «interface» Product
  createProduct(): Product                    ▲          ▲
     ▲               ▲                    ProductA    ProductB
ConcreteCreatorA  ConcreteCreatorB
  └─creates─▶ ProductA   └─creates─▶ ProductB
```

## Signs in Java/Spring code
- `switch`/`if` branches create different implementations and return a common interface: `case PDF -> new PdfExporter(templateRepo, fonts)`.
- Such creation repeats in several places, and one gets forgotten when a variant is added.
- Spring beans are passed into `new` by hand (`new ReportJob(repo, mailer, params)`): the object is not managed by the container, `@Transactional` and other proxies do not work.
- Constructors that differ only in parameter order, or a constructor with a flag that changes its meaning.

## When not to apply
- The created objects are stateless and one instance per variant is enough → they are just beans and a registry (`../behavioral/strategy.md`).
- There is one implementation and the constructor is clear.

## After — a factory bean for objects with request state
```java
public interface Exporter { void write(Report report, OutputStream out); }

public interface ExporterFactory {
    ExportFormat format();
    Exporter create(ExportOptions options);       // an object with state, a new one per call
}

@Component
@RequiredArgsConstructor
class PdfExporterFactory implements ExporterFactory {
    private final TemplateRepository templates;
    private final FontRegistry fonts;

    public ExportFormat format() { return ExportFormat.PDF; }
    public Exporter create(ExportOptions o) { return new PdfExporter(templates, fonts, o.pageSize(), o.locale()); }
}
// a registry of factories by ExportFormat — as in strategy.md (List → EnumMap + a completeness check)
```

## After — a prototype bean via `ObjectProvider`
```java
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
class ReportJob {
    ReportJob(ReportRepository repo, Mailer mailer, ReportParams params) { … }  // params are passed at creation
}

@Service
@RequiredArgsConstructor
class ReportScheduler {
    private final ObjectProvider<ReportJob> jobs;

    void schedule(ReportParams params) {
        ReportJob job = jobs.getObject(params);   // Spring creates a new bean, passing params to the constructor
        executor.submit(job::run);
    }
}
```

## After — named static factories
```java
public record Money(BigDecimal amount, Currency currency) {
    public static Money of(String amount, String currency) {
        return new Money(new BigDecimal(amount), Currency.getInstance(currency));
    }
    public static Money zero(Currency c) { return new Money(BigDecimal.ZERO, c); }
}
```
Naming conventions: `of`, `from`, `valueOf`, `parse`, `create`/`newX` (always a new object), `getInstance` (may return a cached one).

## One `switch` in a factory is fine
If there are few variants, a `switch` inside a single factory is an acceptable compromise: the knowledge of the variants is gathered in one place. The problem is when such `switch` blocks with `new` multiply across the code.

## Refactoring steps
1. Find all creation sites: `grep -rn "new PdfExporter\|new CsvExporter" src/main/java`.
2. Introduce a factory (a method or a bean) and replace the creation at every site.
3. When the `switch` in the factory starts growing — a registry of factories.

## Pitfalls
- A prototype bean injected into a singleton through the constructor is created once. A new instance needs `ObjectProvider` or `@Lookup`.
- Spring does not manage the destruction of prototype beans: `@PreDestroy` is not called on them.
- Do not confuse it with `FactoryBean<T>`: that is a low-level mechanism for integrating libraries, application code almost never needs it.

## Pros and cons
**Pros**
- The client is not tied to concrete product classes.
- The creation code is in one place (SRP).
- New products are added without changing the client (Open/Closed).

**Cons**
- A parallel hierarchy of creators increases the number of classes.
- Extra indirection if there is one product and it does not change.

## Related patterns
Abstract Factory (a family of objects) · Builder (step-by-step assembly of one complex object) · Template Method (a factory method is often a step of a template) · Strategy (if the objects are stateless).

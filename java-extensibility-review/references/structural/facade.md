# Facade

Group: structural

## Essence
A facade gives a simple interface to a complex subsystem or a set of subsystems. The client needs one call "do X", and inside the facade knows the call order, library details and error handling. The subsystems remain directly accessible; the facade just removes repetition.

## Structure (participants)
- **Facade** — a simple interface to a complex subsystem. Knows which classes to delegate to and in what order (`SpreadsheetExporter`, `CheckoutService`).
- **Subsystem classes** — classes of the subsystem or library. They do not know about the facade and remain directly accessible.
- **Additional Facade** — separate facades when one grows too big.
- **Client** — uses the facade instead of working with the subsystem directly.

```
Client ──▶ Facade ──┬──▶ SubsystemA
                    ├──▶ SubsystemB
                    └──▶ SubsystemC
```

## Signs in Java/Spring code
- The same sequence of calls to several components (client A → repository B → cache C → audit) is copied across controllers and services.
- A complex library is used directly in many places: Apache POI (sheets, styles, cells), the low-level Elasticsearch client, Kafka `AdminClient`, JasperReports, JSch.
- Controllers know infrastructure details.
- A library upgrade requires edits across the whole project.

## When not to apply
- The facade forwards subsystem methods one to one — an empty layer.
- A facade that grew into a God class "everything about orders" is better split by use case.
- A single place of use.

## Before
```java
// in three controllers and one job:
var wb = new XSSFWorkbook();
var sheet = wb.createSheet("Orders");
var header = sheet.createRow(0);
var style = wb.createCellStyle();
var font = wb.createFont(); font.setBold(true); style.setFont(font);
// … 40 lines about cells, column widths, date formats
wb.write(out);
```

## After
```java
public interface SpreadsheetExporter {
    <T> void export(OutputStream out, String sheet, List<Column<T>> columns, List<T> rows);
}
public record Column<T>(String title, Function<T, Object> value) {}

@Component
class PoiSpreadsheetExporter implements SpreadsheetExporter {
    public <T> void export(OutputStream out, String sheet, List<Column<T>> columns, List<T> rows) {
        try (var wb = new SXSSFWorkbook(100)) {     // streaming: does not keep the whole file in memory
            // styles, header, formats, autosize — once and here
            wb.write(out);
        } catch (IOException e) {
            throw new ExportFailedException(e);
        }
    }
}

// usage
exporter.export(out, "Orders", List.of(
        new Column<>("Number", Order::number),
        new Column<>("Total", Order::total)), orders);
```
For orchestrating subsystems the facade is usually an application service per use case (`CheckoutService.checkout(cmd)`), to which the controller delegates entirely.

## Refactoring steps
1. Find the copies of the sequence (grep for the library's key calls).
2. Describe the facade interface by what clients need, not by the library's API.
3. Move the implementation, replace the copies, add a facade test.

## Pitfalls
- A leaking facade: it returns library types (`XSSFWorkbook`). Then clients still depend on the library.
- Transaction boundaries: a facade orchestrating several services is a natural place for `@Transactional`, but not for external HTTP calls inside the transaction.

## Pros and cons
**Pros**
- Clients are isolated from the subsystem's complexity and details.
- Less coupling: replacing or upgrading a library touches only the facade.
- Repeated orchestration lives in one place.

**Cons**
- The risk of a God object tied to every class of the system.
- A facade may hide subsystem capabilities individual clients need.
- A forwarding facade (one to one) is an empty layer.

## Related patterns
Adapter (one interface is turned into another) · Mediator (coordinates participants that know about the mediator) · Abstract Factory (can hide behind a facade).

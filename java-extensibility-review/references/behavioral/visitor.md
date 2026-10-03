# Visitor (Посетитель)

Группа: поведенческий

## Суть
Операции над структурой элементов разных типов выносятся из самих элементов в отдельные классы-посетители. Элемент «принимает» посетителя и вызывает у него метод для своего типа (двойная диспетчеризация). Новая операция — новый посетитель, классы элементов не трогаются.

В Java 21 ту же задачу обычно проще решает sealed-иерархия + `switch` с pattern matching (`../java-idioms/sealed-switch.md`): компилятор так же проверяет полноту, а церемоний меньше.

## Структура (участники)
- **Visitor** — интерфейс с методом на каждый тип элемента (`visitText`, `visitTable`).
- **ConcreteVisitor** — одна операция над всей структурой (`HtmlRenderer`, `MarkdownRenderer`).
- **Element** — интерфейс с методом `accept(visitor)`.
- **ConcreteElement** — в `accept` вызывает метод посетителя для своего типа: `v.visitTable(this)` (двойная диспетчеризация).
- **ObjectStructure** — коллекция или дерево элементов, которые обходит посетитель.

```
Client ──▶ element.accept(visitor)
                 │
                 └──▶ visitor.visitTable(this)   // выбор метода по типу элемента и типу посетителя
```

## Признаки в Java/Spring коде
- Есть стабильная иерархия элементов (AST выражений, дерево документа или отчёта, дерево правил, элементы прайса), и над ней регулярно добавляются операции: рендер в HTML/PDF, валидация, расчёт, экспорт.
- Код операций — цепочки `if (node instanceof X) … else if (node instanceof Y)`, разбросанные по сервисам; при добавлении операции что-то забывают.
- Классы элементов обрастают методами `toHtml()`, `toPdf()`, `validate()`, `calculate()`, не относящимися к их сути.

## Когда не применять
- Java 21+ → sealed + `switch`.
- Набор типов элементов часто пополняется: каждый новый тип ломает всех посетителей. Для такой оси изменений нужна Strategy или полиморфизм.
- Операция одна.

## После — классический Visitor (Java < 21)
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
// новая операция (экспорт в Markdown) — новый класс MarkdownRenderer, элементы не меняются
```

## После — Java 21
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

## Шаги рефакторинга
1. Тесты на каждую существующую операцию по всем типам элементов.
2. Java 21: перевести иерархию на `sealed` и заменить `instanceof`-цепочки на `switch` без `default`. Java < 21: ввести `accept`/`Visitor`, перенести операции по одной.

## Подводные камни
- `default` в `switch` или базовый посетитель с пустыми методами по умолчанию отключают проверку полноты. Новый тип молча пройдёт мимо.
- Посетителю нужен доступ к внутренностям элементов, и это ослабляет инкапсуляцию. Для `record` это естественно.
- Библиотеки, которые уже на нём построены (JavaParser `VoidVisitorAdapter`, jOOQ, ASM): используй их посетителей, не изобретай свои.

## Плюсы и минусы
**Плюсы**
- Новая операция добавляется без изменения классов элементов.
- Логика одной операции собрана в одном классе, а не размазана по элементам.
- Посетитель может накапливать состояние во время обхода (счётчики, буфер вывода).

**Минусы**
- Новый тип элемента требует правки всех посетителей.
- Посетителю нужен доступ к данным элементов, и это ослабляет инкапсуляцию.
- Много церемоний (`accept` в каждом классе). В Java 21 sealed + `switch` даёт то же короче.

## Связанные паттерны
Composite (посетитель обходит дерево) · Iterator (обход, к которому применяется посетитель) · Strategy (противоположная ось расширения).

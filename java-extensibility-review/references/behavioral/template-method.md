# Template Method (Шаблонный метод)

Группа: поведенческий

## Суть
Базовый класс фиксирует скелет алгоритма в `final`-методе, а отдельные шаги отдаёт наследникам: абстрактные шаги обязательны, hook-методы с поведением по умолчанию переопределяются при желании. Общий порядок задаётся в одном месте, различия — в наследниках.

## Структура (участники)
- **AbstractClass** — задаёт скелет алгоритма в `final` шаблонном методе и объявляет шаги: абстрактные (обязательные) и hook-методы (с поведением по умолчанию).
- **ConcreteClass** — переопределяет шаги, но не меняет их порядок.

```
AbstractClass
  final templateMethod() { step1(); step2(); hook(); step3(); }
  abstract step1(); abstract step2(); hook() { /* по умолчанию */ }
        ▲                         ▲
  ConcreteClassA            ConcreteClassB
  (step1, step2)            (step1, step2, hook)
```

## Признаки в Java/Spring коде
- `CsvImporter`, `XlsxImporter`, `XmlImporter` копируют один скелет «прочитать → распарсить → провалидировать → сохранить → отчёт», и копии уже начали расходиться (в одной добавили логирование, в другой нет).
- Исправление бага в общем шаге приходится повторять в нескольких классах.
- Несколько джобов с одинаковой обвязкой: блокировка, метрики, обработка ошибок, отчёт.

## Когда не применять (часто лучше композиция)
- Шаги комбинируются по-разному (CSV + сохранение в S3, XLSX + сохранение в БД). Наследование даст взрыв классов; лучше композиция стратегий шагов.
- Наследникам нужны `if` вида «а у меня этот шаг не нужен».
- Иерархия уже глубже двух уровней.

## После — Template Method
```java
public abstract class Importer<R> {

    public final ImportReport importFile(InputStream in) {   // final: скелет не переопределяют
        List<R> rows = parse(in);
        List<R> valid = validate(rows);
        save(valid);
        return ImportReport.of(rows.size(), valid.size());
    }

    protected abstract List<R> parse(InputStream in);
    protected abstract void save(List<R> rows);

    protected List<R> validate(List<R> rows) {                // hook с поведением по умолчанию
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

## После — композиция шагов (часто предпочтительнее)
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
Как выбрать: скелет один и стабилен, наследников немного — Template Method. Шаги комбинируются или нужны независимые тесты шагов — композиция.

## Шаги рефакторинга
1. Тесты на каждый существующий импортёр (вход → отчёт и сохранённые данные).
2. Выделить общий скелет; различия оформить как шаги.
3. Перевести классы по одному и сравнить поведение.

## Подводные камни
- Абстрактный класс с `@Autowired`-полями, которые нужны только части наследников. Зависимости передавай через конструкторы наследников.
- `@Transactional` на `final`-методе базового класса не работает через CGLIB-прокси (final не переопределяется). Ставь транзакцию на вызывающий сервис или на шаг.
- Hook-методы, которые переопределяют «на всякий случай», делают скелет непредсказуемым.

## Плюсы и минусы
**Плюсы**
- Убирает дублирование общего скелета.
- Порядок шагов гарантирован: наследник не может его сломать.
- Наследники переопределяют только то, что действительно отличается.

**Минусы**
- Жёсткость наследования: один базовый класс, комбинации шагов не собрать.
- Наследник, который «выключает» шаг, нарушает принцип подстановки (LSP).
- Скелет трудно менять, когда наследников много.
- Шаги сложнее тестировать отдельно, чем стратегии в композиции.

## Связанные паттерны
Strategy (вариант через композицию) · Factory Method (часто — шаг шаблонного метода) · Chain of Responsibility (pipeline шагов).

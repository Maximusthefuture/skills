# Factory Method (Фабричный метод)

Группа: порождающий

## Суть
Решение о том, какой конкретный класс создать, выносится в отдельный метод или объект-фабрику. Клиент получает объект через общий интерфейс и не делает `new ConcreteX`. В современной Java и Spring это чаще всего:
- именованные статические фабрики (`Money.of`, `Order.draft`, `Range.closed`) вместо неясных конструкторов;
- фабрика-бин, создающая объекты с параметрами рантайма и зависимостями из Spring (`ObjectProvider`, prototype-бины);
- один `switch` в фабрике вместо `switch` с `new` в каждом месте вызова.

## Структура (участники)
- **Product** — общий интерфейс создаваемых объектов (`Exporter`).
- **ConcreteProduct** — конкретные реализации (`PdfExporter`, `CsvExporter`).
- **Creator** — объявляет фабричный метод, возвращающий Product. Часто содержит и логику, которая этот продукт использует.
- **ConcreteCreator** — переопределяет фабричный метод и решает, какой класс создать (`PdfExporterFactory`).
- В Spring-варианте Creator — это фабрика-бин, а ConcreteCreator выбирается реестром по ключу.

```
Creator                                  «interface» Product
  createProduct(): Product                    ▲          ▲
     ▲               ▲                    ProductA    ProductB
ConcreteCreatorA  ConcreteCreatorB
  └─creates─▶ ProductA   └─creates─▶ ProductB
```

## Признаки в Java/Spring коде
- Ветки `switch`/`if` создают разные реализации и возвращают общий интерфейс: `case PDF -> new PdfExporter(templateRepo, fonts)`.
- Такое создание повторяется в нескольких местах, и при добавлении варианта одно забывают.
- В `new` вручную передаются Spring-бины (`new ReportJob(repo, mailer, params)`): объект не управляется контейнером, не работают `@Transactional` и прочие прокси.
- Конструкторы, которые различаются только порядком параметров, или конструктор с флагом, меняющим смысл.

## Когда не применять
- Создаваемые объекты stateless, и хватает одного экземпляра на вариант → это просто бины и реестр (`../behavioral/strategy.md`).
- Реализация одна, и конструктор понятен.

## После — фабрика-бин для объектов с состоянием запроса
```java
public interface Exporter { void write(Report report, OutputStream out); }

public interface ExporterFactory {
    ExportFormat format();
    Exporter create(ExportOptions options);       // объект с состоянием, на каждый вызов — новый
}

@Component
@RequiredArgsConstructor
class PdfExporterFactory implements ExporterFactory {
    private final TemplateRepository templates;
    private final FontRegistry fonts;

    public ExportFormat format() { return ExportFormat.PDF; }
    public Exporter create(ExportOptions o) { return new PdfExporter(templates, fonts, o.pageSize(), o.locale()); }
}
// реестр фабрик по ExportFormat — как в strategy.md (List → EnumMap + проверка полноты)
```

## После — prototype-бин через `ObjectProvider`
```java
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
class ReportJob {
    ReportJob(ReportRepository repo, Mailer mailer, ReportParams params) { … }  // params передаются при создании
}

@Service
@RequiredArgsConstructor
class ReportScheduler {
    private final ObjectProvider<ReportJob> jobs;

    void schedule(ReportParams params) {
        ReportJob job = jobs.getObject(params);   // Spring создаст новый бин, подставив params в конструктор
        executor.submit(job::run);
    }
}
```

## После — именованные статические фабрики
```java
public record Money(BigDecimal amount, Currency currency) {
    public static Money of(String amount, String currency) {
        return new Money(new BigDecimal(amount), Currency.getInstance(currency));
    }
    public static Money zero(Currency c) { return new Money(BigDecimal.ZERO, c); }
}
```
Конвенции имён: `of`, `from`, `valueOf`, `parse`, `create`/`newX` (всегда новый объект), `getInstance` (может вернуть кэшированный).

## Один `switch` в фабрике — это нормально
Если вариантов мало, `switch` внутри единственной фабрики — допустимый компромисс: знание о вариантах собрано в одном месте. Проблема — когда такие `switch` с `new` размножаются по коду.

## Шаги рефакторинга
1. Найти все места создания: `grep -rn "new PdfExporter\|new CsvExporter" src/main/java`.
2. Ввести фабрику (метод или бин) и заменить создание в каждом месте.
3. Когда `switch` в фабрике начнёт расти — реестр фабрик.

## Подводные камни
- Prototype-бин, внедрённый в singleton через конструктор, создаётся один раз. Для нового экземпляра нужен `ObjectProvider` или `@Lookup`.
- Spring не управляет уничтожением prototype-бинов: `@PreDestroy` на них не вызывается.
- Не путай с `FactoryBean<T>`: это низкоуровневый механизм интеграции библиотек, в прикладном коде он почти не нужен.

## Плюсы и минусы
**Плюсы**
- Клиент не привязан к конкретным классам продуктов.
- Код создания в одном месте (SRP).
- Новые продукты добавляются без изменения клиента (Open/Closed).

**Минусы**
- Параллельная иерархия создателей увеличивает число классов.
- Лишняя косвенность, если продукт один и не меняется.

## Связанные паттерны
Abstract Factory (семейство объектов) · Builder (пошаговая сборка одного сложного объекта) · Template Method (фабричный метод часто — шаг шаблона) · Strategy (если объекты stateless).

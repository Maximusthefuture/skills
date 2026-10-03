# Map-lookup вместо if/else на значения

Тип: Java-идиома (table-driven code), родственник Strategy

## Суть
Если ветки `if/switch` только сопоставляют ключ значению или простому действию, логика — это таблица. Таблицу лучше записать как `Map` и читать по ключу: новый вариант — новая строка, а не новая ветка.

## Признаки в Java/Spring коде
- `if (type.equals("CARD")) code = "01"; else if (type.equals("SBP")) code = "02"; …`
- `switch`, где каждая ветка — `return CONSTANT` или вызов однострочника.
- Одинаковые по форме ветки, которые отличаются только значениями.

## Когда не применять
- 2–3 ветки, которые не меняются. `switch`-выражение по enum читается не хуже и проверяется компилятором на полноту.
- В ветках условия сложнее равенства (`amount > 1000 && vip`) → `../behavioral/chain-of-responsibility.md`.
- Ветки — разная логика с зависимостями → `../behavioral/strategy.md`.

## До
```java
String code;
if (type.equals("CARD")) code = "01";
else if (type.equals("SBP")) code = "02";
else if (type.equals("CASH")) code = "03";
else throw new IllegalArgumentException(type);
```

## После — строковый ключ снаружи
```java
private static final Map<String, String> CODES = Map.of(
        "CARD", "01",
        "SBP", "02",
        "CASH", "03");

String code = Optional.ofNullable(CODES.get(type))
        .orElseThrow(() -> new IllegalArgumentException("Unknown type: " + type));
```

## После — enum-ключ (лучше, если варианты известны при компиляции)
```java
private static final Map<PaymentType, String> CODES = new EnumMap<>(Map.of(
        PaymentType.CARD, "01",
        PaymentType.SBP, "02",
        PaymentType.CASH, "03"));
```
Если значение — свойство самого варианта, ещё лучше хранить его полем enum (`enum-with-behavior.md`): тогда забыть его невозможно.

## После — ветки с действием
```java
private final Map<ReportFormat, Function<Report, byte[]>> renderers = new EnumMap<>(Map.of(
        ReportFormat.PDF,  this::renderPdf,
        ReportFormat.CSV,  this::renderCsv,
        ReportFormat.XLSX, this::renderXlsx));

byte[] render(Report r, ReportFormat f) {
    return Objects.requireNonNull(renderers.get(f), () -> "No renderer for " + f).apply(r);
}
```
Значения, которые меняет бизнес (коды, ставки), лучше вынести из кода в конфиг (`configuration-over-code.md`).

## Подводные камни
- `Map.of` запрещает `null` и дубликаты и принимает максимум 10 пар; дальше нужен `Map.ofEntries(entry(…), …)`.
- Обязательно явное поведение на отсутствующий ключ. Молчаливый `null` хуже исходного `else throw`.
- Инициализация поля через `this::method` в инициализаторе поля работает, но в Spring-бине со сложными зависимостями заполняй map в конструкторе.
- Регистр и пробелы во внешних строковых ключах: нормализуй ключ (`toUpperCase(Locale.ROOT)`, `strip()`) один раз на входе.

## Связанные паттерны
Enum с поведением · Strategy (ветки с зависимостями) · Конфигурация вместо кода.

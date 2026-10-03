# sealed + switch с pattern matching

Тип: Java 17/21-идиома, современная альтернатива Visitor и `instanceof`-цепочкам

## Суть
Закрытая иерархия (`sealed interface … permits A, B, C`) из `record` и `switch` по типу без `default` — компилятор проверяет, что обработаны все подтипы. Когда в `permits` добавится новый тип, **каждый** такой `switch` перестанет компилироваться. Это расширяемость, которую гарантирует компилятор.

## Признаки в Java/Spring коде
- `instanceof`-цепочки: `if (n instanceof Email e) … else if (n instanceof Sms s) …`.
- Набор подтипов закрыт (его контролирует твой модуль), а **операции** над ним добавляются часто: рендер, валидация, маппинг в DTO, расчёт.
- Visitor на Java 21+.
- `switch` по полю-дискриминатору (`type`) с последующим приведением типов.

## Как выбрать между sealed + switch и Strategy (expression problem)

| Что добавляется чаще | Выбирай | Почему |
|---|---|---|
| Новые **варианты** (провайдеры, способы оплаты), операций мало и они стабильны | Strategy / полиморфизм | новый вариант — новый класс, остальное не трогаем |
| Новые **операции** над закрытым набором вариантов | sealed + `switch` | новая операция — один метод со `switch`, классы данных не трогаем |
| Варианты добавляют другие модули или команды (плагины) | Strategy | sealed требует, чтобы все подтипы были в одном модуле или пакете |

Не советуй заменить работающий sealed + `switch` на Strategy (и наоборот), не определив, какая ось реально меняется.

## После (Java 21)
```java
public sealed interface Notification permits EmailNotification, SmsNotification, PushNotification {}
public record EmailNotification(String to, String subject, String body) implements Notification {}
public record SmsNotification(String phone, String text) implements Notification {}
public record PushNotification(String deviceToken, String title) implements Notification {}

String preview(Notification n) {
    return switch (n) {                     // без default: компилятор требует покрыть все подтипы
        case EmailNotification e -> e.subject();
        case SmsNotification s   -> s.text();
        case PushNotification p  -> p.title();
    };
}

// record patterns и guard-условия
String route(Notification n) {
    return switch (n) {
        case EmailNotification(var to, var subject, var body) when to.endsWith("@corp.example") -> "internal-smtp";
        case EmailNotification e -> "external-smtp";
        case SmsNotification s   -> "sms-gateway";
        case PushNotification p  -> "fcm";
    };
}
```

## Шаги рефакторинга
1. Убедиться, что Java ≥ 21 (на 17 pattern matching в `switch` — preview). На 17 можно ввести `sealed` и `instanceof`-паттерны, но полноту `switch` по типам компилятор не проверяет.
2. Сделать иерархию `sealed`, подтипы — `record` или `final`.
3. Заменить `instanceof`-цепочки на `switch`-выражения без `default`.

## Подводные камни
- `default ->` в `switch` по sealed-типу отключает проверку полноты. Отмечай это как замечание: найти такие места можно поиском `default\s*->` рядом с `case [A-Z]\w* \w+ ->`.
- Все подтипы должны лежать в одном модуле (JPMS) или, без модулей, в одном пакете.
- JPA-сущности и sealed сочетаются плохо (прокси Hibernate — подклассы). Применяй к DTO, событиям, командам и value-объектам.
- Jackson: для (де)сериализации sealed-иерархии нужен `@JsonTypeInfo` (`polymorphic-json.md`).

## Связанные паттерны
Visitor (классический аналог) · Strategy (противоположная ось) · Composite (sealed-дерево) · Command (sealed-набор команд).

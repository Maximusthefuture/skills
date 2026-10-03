# Полиморфная (де)сериализация Jackson

Тип: Jackson-идиома, часто вход в sealed-switch / Strategy / Command

## Суть
Вместо ручного разбора поля-дискриминатора (`type`) и `switch` с `treeToValue` Jackson сам выбирает подтип по имени. Новый тип сообщения — новый `record` и строка в `@JsonSubTypes`, а не новая ветка парсера.

## Признаки в Java/Spring коде
- `JsonNode node = mapper.readTree(json); switch (node.get("type").asText()) { case "CARD" -> mapper.treeToValue(node, CardPaymentDto.class); … }`.
- DTO-«мешок» со всеми полями всех вариантов, часть из которых `null` в зависимости от `type`.
- Вебхуки и события разных типов в одном эндпоинте или топике.

## Когда не применять
- Тип один или различие в одном поле.
- Формат задаёт внешняя система, и дискриминатор у неё сложный (вложенный, зависит от нескольких полей). Тогда нужен кастомный `JsonDeserializer` или `@JsonTypeIdResolver`.

## После
```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = CardPaymentDto.class, name = "CARD"),
        @JsonSubTypes.Type(value = SbpPaymentDto.class,  name = "SBP")
})
public sealed interface PaymentDto permits CardPaymentDto, SbpPaymentDto {}

public record CardPaymentDto(String cardToken, BigDecimal amount) implements PaymentDto {}
public record SbpPaymentDto(String phone, BigDecimal amount) implements PaymentDto {}

@PostMapping("/payments")
ResponseEntity<?> pay(@RequestBody @Valid PaymentDto dto) {
    return switch (dto) {                      // sealed-switch, см. sealed-switch.md
        case CardPaymentDto c -> ok(cardFlow.pay(c));
        case SbpPaymentDto s  -> ok(sbpFlow.pay(s));
    };
}
```
Явный список подтипов в `@JsonSubTypes` — это ещё и документация контракта: его видно в ревью, и случайный класс не станет допустимым типом.

## Подводные камни
- **Безопасность (критично):** никогда не используй `JsonTypeInfo.Id.CLASS` / `Id.MINIMAL_CLASS` и `activateDefaultTyping` / `enableDefaultTyping` на входящих данных: это RCE через gadget-цепочки. Нужен только `Id.NAME` с явным списком подтипов.
- Неизвестный `type` даёт `InvalidTypeIdException`. Замапь его в 400 в `@ControllerAdvice` или задай `defaultImpl` осознанно.
- Имена типов — публичный контракт API: переименование класса не должно менять `name`.
- Для Kafka/RabbitMQ проверь, что те же аннотации использует конвертер сообщений (тот же `ObjectMapper`).

## Связанные паттерны
sealed-switch · Command (команды из JSON) · Strategy (обработчик по типу) · Composite (дерево правил в JSON).

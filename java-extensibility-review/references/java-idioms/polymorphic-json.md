# Polymorphic Jackson (de)serialization

Type: a Jackson idiom, often the entry to sealed-switch / Strategy / Command

## Essence
Instead of manually parsing a discriminator field (`type`) and a `switch` with `treeToValue`, Jackson picks the subtype by name itself. A new message type is a new `record` and a line in `@JsonSubTypes`, not a new parser branch.

## Signs in Java/Spring code
- `JsonNode node = mapper.readTree(json); switch (node.get("type").asText()) { case "CARD" -> mapper.treeToValue(node, CardPaymentDto.class); … }`.
- A "bag" DTO with all fields of all variants, some of which are `null` depending on `type`.
- Webhooks and events of different types in one endpoint or topic.

## When not to apply
- There is one type, or the difference is in one field.
- An external system defines the format, and its discriminator is complex (nested, depends on several fields). Then you need a custom `JsonDeserializer` or `@JsonTypeIdResolver`.

## After
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
    return switch (dto) {                      // sealed-switch, see sealed-switch.md
        case CardPaymentDto c -> ok(cardFlow.pay(c));
        case SbpPaymentDto s  -> ok(sbpFlow.pay(s));
    };
}
```
An explicit list of subtypes in `@JsonSubTypes` is also contract documentation: it is visible in review, and a random class cannot become an allowed type.

## Pitfalls
- **Security (critical):** never use `JsonTypeInfo.Id.CLASS` / `Id.MINIMAL_CLASS` and `activateDefaultTyping` / `enableDefaultTyping` on incoming data: that is RCE through gadget chains. Only `Id.NAME` with an explicit subtype list.
- An unknown `type` gives `InvalidTypeIdException`. Map it to 400 in a `@ControllerAdvice` or set `defaultImpl` deliberately.
- Type names are a public API contract: renaming a class must not change the `name`.
- For Kafka/RabbitMQ check that the message converter uses the same annotations (the same `ObjectMapper`).

## Related patterns
sealed-switch · Command (commands from JSON) · Strategy (a handler per type) · Composite (a rule tree in JSON).

# Abstract Factory

Group: creational

## Essence
An abstract factory creates a **family** of related objects that must work together. The client gets one factory (e.g. "everything for provider X") and cannot accidentally mix parts of different families. A new family is a new factory implementation.

## Structure (participants)
- **AbstractFactory** — an interface with methods to get each product of the family (`PaymentProviderKit`: `client()`, `mapper()`, `webhookVerifier()`).
- **ConcreteFactory** — one implementation per family (`StripeKit`, `YooKassaKit`).
- **AbstractProduct** — interfaces of the product kinds (`PaymentClient`, `PaymentMapper`).
- **ConcreteProduct** — products of a concrete family. Compatible only with each other.
- **Client** — works only with abstractions and gets the whole family from one factory.

```
«interface» AbstractFactory: createA(), createB()
        ▲                         ▲
  StripeFactory             YooKassaFactory
   → StripeA, StripeB         → YooA, YooB
```

## Signs in Java/Spring code
- Several `switch (provider)` / `switch (country)` / `switch (tenant)` in different places choose objects that must match: the API client, the response mapper, the webhook signature check, the document number format.
- An error "provider A's client + provider B's mapper" is possible.
- Connecting a new provider or country requires edits in 4–5 places.
- Multitenancy or multiregion setups with a set of implementations per region.

## When not to apply
- Exactly one family is active per deployment → `@Profile` / `@ConditionalOnProperty` on a `@Configuration`: the Spring container itself works as the abstract factory.
- A "family" of one object → Strategy.
- The set of product kinds changes often: adding a new kind changes the factory interface and all implementations.

## Before
```java
PaymentClient client = switch (provider) { case STRIPE -> stripeClient; case YOOKASSA -> yooClient; };
// … in another service
PaymentMapper mapper = switch (provider) { case STRIPE -> new StripeMapper(); case YOOKASSA -> new YooMapper(); };
// … in the webhook controller
WebhookVerifier verifier = switch (provider) { … };
```

## After — the family as one bean
```java
public interface PaymentProviderKit {
    Provider provider();
    PaymentClient client();
    PaymentMapper mapper();
    WebhookVerifier webhookVerifier();
}

@Component
@RequiredArgsConstructor
class StripeKit implements PaymentProviderKit {
    private final StripeClient client;
    private final StripeMapper mapper;
    private final StripeWebhookVerifier verifier;

    public Provider provider() { return Provider.STRIPE; }
    public PaymentClient client() { return client; }
    public PaymentMapper mapper() { return mapper; }
    public WebhookVerifier webhookVerifier() { return verifier; }
}

// a registry by Provider — as in ../behavioral/strategy.md (List → EnumMap + a completeness check)
var kit = kits.get(order.provider());
var response = kit.client().charge(kit.mapper().toRequest(order));
```

## After — one family per deployment
```java
@Configuration
@ConditionalOnProperty(name = "region", havingValue = "eu")
class EuConfig {
    @Bean TaxCalculator taxCalculator() { return new EuVatCalculator(); }
    @Bean AddressFormatter addressFormatter() { return new EuAddressFormatter(); }
    @Bean InvoiceNumbering invoiceNumbering() { return new EuInvoiceNumbering(); }
}
// RuConfig with havingValue = "ru" — the same family for another region
```

## Refactoring steps
1. Find all `switch` blocks on the same discriminator: `find_referencing_symbols` on the provider, country or tenant enum (or Grep).
2. Determine which objects are always chosen together — that is the family.
3. Introduce the family interface and an implementation per variant; replace the `switch` blocks with getting the family from a registry.

## Pitfalls
- A kit turning into a Service Locator: if it has 10 methods and clients use one each, several separate strategies are better.
- Parts of a family often share configuration (URLs, keys). Tie them together through the provider's `@ConfigurationProperties`.

## Pros and cons
**Pros**
- Products of one family are guaranteed to be compatible.
- The client is decoupled from concrete classes.
- A new family (provider, region) is added without changing the client.

**Cons**
- A new *kind* of product changes the factory interface and all its implementations.
- Many classes and interfaces.
- Without discipline the factory turns into a Service Locator.

## Related patterns
Factory Method (one product) · Strategy (a family of one) · Bridge · Facade (can hide a family behind a simple API).

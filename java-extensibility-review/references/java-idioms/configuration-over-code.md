# Configuration over code

Type: a Spring Boot idiom (externalized configuration, conditional beans)

## Essence
Data that changes more often than the code (rates, thresholds, mappings, country lists) moves out of `if/else` into typed configuration. Choosing an implementation by a flag happens once, when the context is assembled (`@ConditionalOnProperty`, `@Profile`), not as an `if` in every call. A new value is a line in YAML, not a release.

## Signs in Java/Spring code
- `if (country.equals("DE")) vat = 0.19; else if (country.equals("FR")) vat = 0.20; …`
- Magic threshold numbers in business logic (`if (amount > 50000)`) that the business asks to change.
- `if (props.isNewPricingEnabled()) newEngine.calc() else oldEngine.calc()` in several places.
- `@Value("${…}")` with the same keys scattered across many classes.
- Various `if (env.equals("prod"))` in the code.

## When not to apply
- The flag switches at runtime without a restart (A/B, a percentage of users, a kill switch) — you need a feature-flag service (Unleash, LaunchDarkly, Togglz) and a Strategy chosen per request.
- A business user changes the values through an admin UI (tariffs, promotions) — that is data in the DB, not YAML.
- The value is part of the logic, not a setting (not every number belongs in config).

## After — tables
```java
@ConfigurationProperties(prefix = "tax")
@Validated
public record TaxProperties(@NotEmpty Map<String, @NotNull @PositiveOrZero BigDecimal> vatByCountry) {}
```
```yaml
tax:
  vat-by-country:
    DE: 0.19
    FR: 0.20
```
```java
@Component
@RequiredArgsConstructor
class VatCalculator {
    private final TaxProperties tax;
    BigDecimal rate(String country) {
        var r = tax.vatByCountry().get(country);
        if (r == null) throw new UnsupportedCountryException(country);
        return r;
    }
}
```
Do not forget `@EnableConfigurationProperties(TaxProperties.class)` or `@ConfigurationPropertiesScan`.

## After — choosing the implementation at startup
```java
@Component
@ConditionalOnProperty(name = "pricing.engine", havingValue = "v2")
class PricingEngineV2 implements PricingEngine { … }

@Component
@ConditionalOnProperty(name = "pricing.engine", havingValue = "v1", matchIfMissing = true)
class PricingEngineV1 implements PricingEngine { … }
```
The calling code simply injects `PricingEngine`.

## Refactoring steps
1. Move the values into `@ConfigurationProperties` with validation, keeping the current defaults.
2. Replace the hardcoding and the scattered `@Value` with injected properties.
3. A test: the context starts with the real `application.yml`; an invalid configuration fails the startup.

## Pitfalls
- Without `@Validated` a typo in YAML gives `null` in production, not an error at startup.
- Map keys in YAML with dots or special characters must be escaped (`"[a.b]": 1`).
- Secrets do not go into `application.yml` in the repository.
- A YAML change is a behavior change too. It needs review and a test just like code.

## Related patterns
Map-lookup (a table in code) · Null Object (`@ConditionalOnMissingBean`) · Abstract Factory (a family of beans per profile) · Strategy.

# Adapter

Group: structural

## Essence
An adapter turns a foreign interface (an SDK, an external API, legacy code) into the interface your code needs. In a backend this is usually the "port + adapter" scheme (hexagonal architecture): the domain declares an interface in its own terms, and an adapter at the boundary implements it with a concrete SDK and translates types and errors.

## Structure (participants)
- **Target (port)** — the interface the client needs, in domain terms (`DocumentStorage`).
- **Adaptee** — an existing class with an incompatible interface (an SDK, an external API, legacy).
- **Adapter** — implements Target, calls Adaptee, translates types, data and errors (`S3DocumentStorage`).
- **Client** — domain code, works only with Target.
- Java almost always uses an object adapter (composition). A class adapter, inheriting from Adaptee, is rare.

```
Client ──▶ «interface» Target ◀── Adapter ──calls──▶ Adaptee (SDK)
```

## Signs in Java/Spring code
- A domain service imports SDK classes (`software.amazon.awssdk…`, `com.stripe…`, generated OpenAPI clients) and operates on their types.
- `if (provider.equals("A")) clientA.send(…) else clientB.post(…)` — different clients with different interfaces for one task.
- SDK exceptions (`StripeException`, `SdkClientException`) are caught and examined in business logic.
- Domain tests require mocking the SDK or starting WireMock.
- Switching providers or connecting a second one is being discussed.

## When not to apply
- One integration nobody will change, and a thin service around it. An interface "just in case" with a single implementation forever is a needless level of indirection. The exception is when testing is inconvenient without it.

## After
```java
// the port — in the domain package, in domain terms
public interface DocumentStorage {
    StoredDocument put(DocumentId id, InputStream content, long contentLength, String contentType);
    InputStream get(DocumentId id);
}

// the adapter — in the infrastructure package, the only place where the SDK is visible
@Component
@RequiredArgsConstructor
class S3DocumentStorage implements DocumentStorage {
    private final S3Client s3;
    private final StorageProperties props;

    @Override
    public StoredDocument put(DocumentId id, InputStream content, long contentLength, String contentType) {
        try {
            var request = PutObjectRequest.builder()
                    .bucket(props.bucket()).key(id.value()).contentType(contentType).build();
            s3.putObject(request, RequestBody.fromInputStream(content, contentLength));
            return new StoredDocument(id, contentType);
        } catch (SdkException e) {
            throw new StorageUnavailableException("S3 put failed for " + id, e);  // translate into a domain error
        }
    }
    // …
}
```
If the provider is chosen by configuration, use `@ConditionalOnProperty(name = "storage.type", havingValue = "s3")`. If several providers work at the same time, you need a registry by key (see `../behavioral/strategy.md`).

## Refactoring steps
1. Collect all SDK usages: `grep -rn "import com.stripe" src/main/java`.
2. Describe the port by what the domain really needs, not as a copy of the SDK API.
3. Implement the adapter, migrate the calls; the domain stops importing the SDK.
4. Domain tests — on a fake port implementation; the adapter — an integration test (WireMock/Testcontainers/LocalStack).

## Pitfalls
- A leaking adapter: the port returns SDK types or rethrows its exceptions, and there is no gain.
- An adapter growing business logic. It must only translate.
- A port that copies the provider's API: switching providers still means changing the domain.
- SDK constraints (a known stream length, multipart for big files, client retries) are the adapter's responsibility; do not drag them into the domain.

## Pros and cons
**Pros**
- Interface and data translation is isolated in one place.
- The domain does not depend on a foreign API; the provider can be replaced or a second one added (Open/Closed).
- The domain is tested against a fake port implementation.

**Cons**
- An extra layer and mapping code.
- A wide API means a lot of boilerplate.
- A risk of a leaky abstraction if the port repeats the provider's API.

## Related patterns
Facade (simplifies several subsystems, not one) · Strategy (adapters as strategies for choosing a provider) · Proxy and Decorator (the same interface, not a translation).

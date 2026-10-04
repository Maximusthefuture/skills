# Proxy

Group: structural

## Essence
A proxy implements the same interface as the real object and controls access to it: creates it lazily, checks permissions, caches, calls remotely, logs. The client does not notice the substitution. Spring is built on proxies: `@Transactional`, `@Cacheable`, `@PreAuthorize`, `@Async`, JPA lazy associations, `@HttpExchange` and Feign clients.

## Structure (participants)
- **Subject** — the common interface of the real object and the proxy.
- **RealSubject** — the real object doing the useful work.
- **Proxy** — implements Subject, holds or creates the RealSubject and controls access to it: lazy creation, permission checks, caching, remote calls, logging.
- **Client** — works with Subject and does not notice the substitution.
- Kinds: virtual (lazy), protection, remote, caching, logging, "smart reference". In Spring the container generates them (JDK dynamic proxy or CGLIB).

```
Client ──▶ «interface» Subject ◀── Proxy ──access control──▶ RealSubject
```

## Signs in Java/Spring code
- `if (!securityService.hasAccess(user, id)) throw new AccessDeniedException()` repeats at the start of many methods.
- Manual lazy initialization of a heavy resource with double-checked locking.
- Hand-written HTTP clients: every method builds a URL, serializes the body, parses the response. They can be replaced with a declarative interface.
- Caching or rate limiting around a remote service is written into the calling code.

## When not to apply
- Spring AOP already gives the needed behavior — it is enough to use it correctly.
- The goal is to add behavior and assemble layers in combinations → `decorator.md`.

## After — declarative permission checks
```java
@Service
class DocumentService {
    @PreAuthorize("@documentAccess.canRead(authentication, #id)")
    public Document get(UUID id) { … }

    @PreAuthorize("@documentAccess.canEdit(authentication, #id)")
    public void update(UUID id, DocumentPatch patch) { … }
}

@Component("documentAccess")
class DocumentAccess {
    public boolean canRead(Authentication auth, UUID id) { … }
    public boolean canEdit(Authentication auth, UUID id) { … }
}
```
Requires `@EnableMethodSecurity`.

## After — a remote proxy instead of a hand-written client (Spring 6+)
```java
@HttpExchange("/api/v1/customers")
public interface CustomerClient {
    @GetExchange("/{id}")
    CustomerDto get(@PathVariable UUID id);

    @PostExchange
    CustomerDto create(@RequestBody NewCustomer body);
}

@Configuration
class ClientsConfig {
    @Bean
    CustomerClient customerClient(RestClient.Builder builder, @Value("${crm.url}") String url) {
        var restClient = builder.baseUrl(url).build();
        return HttpServiceProxyFactory.builderFor(RestClientAdapter.create(restClient))
                .build().createClient(CustomerClient.class);
    }
}
```

## After — lazy initialization
`@Lazy` at the injection point (Spring substitutes a proxy), `ObjectProvider<T>` to get it on demand, or a memoizing `Supplier` instead of hand-written double-checked locking.

## Pitfalls
- **Self-invocation:** a `this.method()` call bypasses the proxy, and the annotations do not work. This is the most common mistake.
- CGLIB does not proxy `final` classes and methods or `private` methods. Annotations on them are silently ignored.
- Hibernate proxies: `getClass()` returns the proxy class, so `equals` via `getClass() ==` breaks. Use `Hibernate.getClass(…)` or `instanceof`.
- `@Lazy` used to break a circular dependency hides a design problem (see `../behavioral/mediator.md`).

## Pros and cons
**Pros**
- Access and lifecycle control invisible to the client.
- Works even if the real object is not created yet or is gone (laziness, remote calls).
- New proxies are added without changing the service and the client (Open/Closed).

**Cons**
- Extra latency and indirection.
- The behavior can surprise: a cached answer, a lazy error on first access.
- Spring proxy limitations: self-invocation, `final`, `private`.

## Related patterns
Decorator (the same structure, the goal is adding behavior) · Adapter (changes the interface) · Facade.

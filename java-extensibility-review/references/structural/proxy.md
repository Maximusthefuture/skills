# Proxy (Заместитель)

Группа: структурный

## Суть
Заместитель реализует тот же интерфейс, что и настоящий объект, и контролирует доступ к нему: создаёт лениво, проверяет права, кэширует, вызывает удалённо, логирует. Клиент не замечает подмены. Spring построен на прокси: `@Transactional`, `@Cacheable`, `@PreAuthorize`, `@Async`, lazy-связи JPA, клиенты `@HttpExchange` и Feign.

## Структура (участники)
- **Subject** — общий интерфейс реального объекта и заместителя.
- **RealSubject** — настоящий объект с полезной работой.
- **Proxy** — реализует Subject, хранит или создаёт RealSubject и контролирует доступ к нему: лениво создаёт, проверяет права, кэширует, вызывает удалённо, логирует.
- **Client** — работает с Subject и не замечает подмены.
- Виды: виртуальный (ленивый), защищающий, удалённый, кэширующий, логирующий, «умная ссылка». В Spring их генерирует контейнер (JDK dynamic proxy или CGLIB).

```
Client ──▶ «interface» Subject ◀── Proxy ──контроль доступа──▶ RealSubject
```

## Признаки в Java/Spring коде
- В начале многих методов повторяется `if (!securityService.hasAccess(user, id)) throw new AccessDeniedException()`.
- Ручная ленивая инициализация тяжёлого ресурса с double-checked locking.
- Ручные HTTP-клиенты: в каждом методе собирается URL, сериализуется тело, разбирается ответ. Их можно заменить декларативным интерфейсом.
- Кэширование или rate limiting вокруг удалённого сервиса вписаны в вызывающий код.

## Когда не применять
- Нужное поведение уже даёт Spring AOP — достаточно правильно его использовать.
- Цель — добавить поведение и собирать слои в комбинации → `decorator.md`.

## После — декларативная проверка прав
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
Требует `@EnableMethodSecurity`.

## После — удалённый прокси вместо ручного клиента (Spring 6+)
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

## После — ленивая инициализация
`@Lazy` на точке внедрения (Spring подставит прокси), `ObjectProvider<T>` для получения по требованию, или мемоизирующий `Supplier` вместо ручного double-checked locking.

## Подводные камни
- **Self-invocation:** вызов `this.method()` идёт мимо прокси, и аннотации не работают. Это самая частая ошибка.
- CGLIB не проксирует `final`-классы и методы и `private`-методы. Аннотации на них молча игнорируются.
- Hibernate-прокси: `getClass()` возвращает класс прокси, поэтому `equals` через `getClass() ==` ломается. Используй `Hibernate.getClass(…)` или `instanceof`.
- `@Lazy`, использованный для разрыва циклической зависимости, прячет проблему дизайна (см. `../behavioral/mediator.md`).

## Плюсы и минусы
**Плюсы**
- Контроль доступа и жизненного цикла незаметно для клиента.
- Работает, даже если реальный объект ещё не создан или удалён (ленивость, удалённые вызовы).
- Новые прокси добавляются без изменения сервиса и клиента (Open/Closed).

**Минусы**
- Дополнительная задержка и косвенность.
- Поведение может удивлять: кэшированный ответ, ленивая ошибка при первом обращении.
- Ограничения прокси в Spring: self-invocation, `final`, `private`.

## Связанные паттерны
Decorator (структура та же, цель — добавить поведение) · Adapter (меняет интерфейс) · Facade.

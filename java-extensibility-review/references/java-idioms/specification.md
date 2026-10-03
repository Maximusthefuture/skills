# Specification для динамических фильтров

Тип: паттерн DDD / Spring Data JPA, частный случай Composite для запросов

## Суть
Каждое условие фильтра — отдельный маленький объект-предикат. Условия комбинируются через AND/OR/NOT. Новый фильтр — новый метод-спецификация и одна строка в сборке, без переписывания запроса и без новых методов репозитория.

## Признаки в Java/Spring коде
- Построение запроса через `if (filter.getX() != null) jpql += " and x = :x"` и параллельный `if` для параметров.
- Взрыв методов репозитория: `findByStatusAndCreatedAfterAndCustomerId…`.
- Одинаковые условия (активен, не удалён, принадлежит тенанту) копируются в разные запросы.
- Фильтр из UI с 5–15 необязательными полями.

## Когда не применять
- Запрос фиксированный — хватит derived query или `@Query`.
- В проекте уже есть Querydsl или jOOQ — используй их механизм предикатов, а не второй.

## После
```java
final class OrderSpecs {
    private OrderSpecs() {}

    static Specification<Order> hasStatus(OrderStatus status) {
        return (root, q, cb) -> status == null ? null : cb.equal(root.get(Order_.status), status);
    }
    static Specification<Order> createdAfter(Instant from) {
        return (root, q, cb) -> from == null ? null : cb.greaterThanOrEqualTo(root.get(Order_.createdAt), from);
    }
    static Specification<Order> ofCustomer(UUID customerId) {
        return (root, q, cb) -> customerId == null ? null : cb.equal(root.get(Order_.customerId), customerId);
    }
}

public interface OrderRepository extends JpaRepository<Order, UUID>, JpaSpecificationExecutor<Order> {}

// сервис
Specification<Order> spec = Specification.allOf(          // Spring Data JPA 3.x; в 2.x — where(a).and(b)
        OrderSpecs.hasStatus(filter.status()),
        OrderSpecs.createdAfter(filter.from()),
        OrderSpecs.ofCustomer(filter.customerId()));
Page<Order> page = orders.findAll(spec, pageable);
```
`null`-предикат игнорируется. `Order_` — JPA Metamodel (`hibernate-jpamodelgen`): опечатки в именах полей ловит компилятор. Без метамодели — `root.get("status")`.

## Шаги рефакторинга
1. Тесты на текущий поиск (`@DataJpaTest` + Testcontainers) по основным комбинациям фильтров.
2. Подключить `JpaSpecificationExecutor`, вынести условия по одному.
3. Удалить ручную сборку JPQL и лишние derived-методы.

## Подводные камни
- **Безопасность:** конкатенация пользовательского ввода в JPQL/SQL — уже уязвимость (инъекция), а не вопрос расширяемости. Отметь её отдельно как критичную.
- `fetch join` внутри спецификации ломает count-запрос пагинации. Проверяй `q.getResultType()` или выноси fetch в `@EntityGraph`.
- Join в нескольких спецификациях на одну связь даёт дубликаты join-ов и строк (`q.distinct(true)` или переиспользование join).
- Сортировку по полю из пользовательского ввода ограничивай белым списком.

## Связанные паттерны
Composite (AND/OR/NOT-дерево) · Chain of Responsibility · Builder (сборка запроса).

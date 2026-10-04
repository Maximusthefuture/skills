# Specification for dynamic filters

Type: a DDD / Spring Data JPA pattern, a special case of Composite for queries

## Essence
Every filter condition is a separate small predicate object. Conditions combine through AND/OR/NOT. A new filter is a new specification method and one line in the assembly, without rewriting the query and without new repository methods.

## Signs in Java/Spring code
- Building a query with `if (filter.getX() != null) jpql += " and x = :x"` and a parallel `if` for the parameters.
- An explosion of repository methods: `findByStatusAndCreatedAfterAndCustomerId…`.
- The same conditions (active, not deleted, belongs to the tenant) copied into different queries.
- A UI filter with 5–15 optional fields.

## When not to apply
- The query is fixed — a derived query or `@Query` is enough.
- The project already has Querydsl or jOOQ — use their predicate mechanism, not a second one.

## After
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

// service
Specification<Order> spec = Specification.allOf(          // Spring Data JPA 3.x; in 2.x — where(a).and(b)
        OrderSpecs.hasStatus(filter.status()),
        OrderSpecs.createdAfter(filter.from()),
        OrderSpecs.ofCustomer(filter.customerId()));
Page<Order> page = orders.findAll(spec, pageable);
```
A `null` predicate is ignored. `Order_` is the JPA Metamodel (`hibernate-jpamodelgen`): the compiler catches typos in field names. Without the metamodel — `root.get("status")`.

## Refactoring steps
1. Tests on the current search (`@DataJpaTest` + Testcontainers) for the main filter combinations.
2. Add `JpaSpecificationExecutor`, move the conditions out one at a time.
3. Remove the manual JPQL assembly and the extra derived methods.

## Pitfalls
- **Security:** concatenating user input into JPQL/SQL is already a vulnerability (injection), not an extensibility question. Flag it separately as critical.
- A `fetch join` inside a specification breaks the pagination count query. Check `q.getResultType()` or move the fetch into an `@EntityGraph`.
- Joins on the same association in several specifications produce duplicate joins and rows (`q.distinct(true)` or reuse the join).
- Limit sorting by a field from user input with an allowlist.

## Related patterns
Composite (an AND/OR/NOT tree) · Chain of Responsibility · Builder (assembling the query).

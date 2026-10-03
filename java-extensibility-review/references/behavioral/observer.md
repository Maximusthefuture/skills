# Observer (Наблюдатель)

Группа: поведенческий

## Суть
Объект публикует событие «что-то произошло» и не знает, кто на него реагирует. Подписчики добавляются, не трогая издателя. В Spring это `ApplicationEventPublisher` + `@EventListener` / `@TransactionalEventListener` внутри приложения, а между сервисами — брокер (Kafka, RabbitMQ).

## Структура (участники)
- **Publisher (Subject)** — объект, в котором происходит событие. Публикует его и не знает подписчиков (`OrderService` + `ApplicationEventPublisher`).
- **Event** — неизменяемое сообщение о том, что произошло (`OrderCreated`).
- **Subscriber (Listener)** — интерфейс или метод реакции (`@EventListener`, `@TransactionalEventListener`).
- **ConcreteSubscribers** — реакции: письмо, аудит, аналитика. Регистрирует их контейнер Spring, а не издатель вручную.

```
Publisher ──publish(event)──▶ ApplicationEventMulticaster ──▶ ListenerA
                                                         ├──▶ ListenerB
                                                         └──▶ ListenerC
```

## Признаки в Java/Spring коде
- После основного действия идёт хвост побочных эффектов:
  ```java
  orderRepository.save(order);
  emailService.sendConfirmation(order);
  auditService.log(order);
  analyticsClient.track(order);
  loyaltyService.addPoints(order);
  ```
- Каждая новая реакция на «заказ создан» требует правки `OrderService`.
- Конструктор сервиса принимает много не связанных с его задачей зависимостей.
- Модули знают друг о друге только ради уведомлений.

## Когда не применять
- Эффект — часть бизнес-инварианта (списать остаток на складе при создании заказа). Он должен быть явным вызовом в той же транзакции, а не реакцией, которую легко потерять.
- Нужен результат реакции (вернуть ответ клиенту) — это обычный вызов.

## После
```java
public record OrderCreated(UUID orderId, UUID customerId, BigDecimal total) {}

@Service
@RequiredArgsConstructor
class OrderService {
    private final OrderRepository orders;
    private final ApplicationEventPublisher events;

    @Transactional
    public Order create(CreateOrder cmd) {
        var order = orders.save(Order.from(cmd));
        events.publishEvent(new OrderCreated(order.getId(), order.getCustomerId(), order.getTotal()));
        return order;
    }
}

@Component
@RequiredArgsConstructor
class OrderConfirmationEmail {
    private final EmailService email;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(OrderCreated e) { email.sendConfirmation(e.orderId()); }
}
```
Новая реакция — новый класс со слушателем. `OrderService` не меняется.

## Надёжность — обязательно упомяни в рекомендации
- `@EventListener` синхронный и работает внутри транзакции издателя. Исключение в слушателе откатит создание заказа.
- `@TransactionalEventListener(AFTER_COMMIT)` срабатывает после коммита, но событие живёт только в памяти: если процесс упадёт, реакция потеряется. Для денег и внешних систем нужен outbox (таблица событий в той же транзакции) или Spring Modulith Event Publication Registry.
- Внутри `AFTER_COMMIT` транзакции уже нет. Если слушателю нужно писать в БД, используй `@Transactional(propagation = REQUIRES_NEW)`.
- `@Async` на слушателе убирает задержку из запроса, но требует своего пула потоков и решения про потерю событий при рестарте.
- Событие — неизменяемый `record` с идентификаторами, а не JPA-сущность: сущность может быть detached или lazy.

## Шаги рефакторинга
1. Определи, какие эффекты — инварианты (остаются явными), а какие — реакции.
2. Введи событие-`record`, опубликуй его рядом с текущими вызовами.
3. Переноси реакции в слушатели по одной, выбирая фазу и синхронность.
4. Тест: публикация события (`@RecordApplicationEvents` в Spring Test) и отдельный тест каждого слушателя.

## Подводные камни
- Неявный поток управления: по `OrderService` больше не видно, что отправляется письмо. Называй события в прошедшем времени, а слушатели — по реакции.
- Цепочки событий (слушатель публикует следующее событие) быстро становятся нечитаемыми. Если появился процесс, нужен `mediator.md`.

## Плюсы и минусы
**Плюсы**
- Издатель не зависит от подписчиков; новая реакция не требует его правки (Open/Closed).
- Реакции можно добавлять из других модулей.
- Связи устанавливаются в рантайме и конфигурацией.

**Минусы**
- Поток управления неявный: по издателю не видно, что произойдёт.
- Порядок уведомлений не очевиден (нужен `@Order`).
- Ошибки и транзакционность: синхронный слушатель может откатить транзакцию издателя, а асинхронный — потерять событие.
- Цепочки событий быстро становятся нечитаемыми.

## Связанные паттерны
Mediator (координатор, который знает участников) · Command (событие против команды: «произошло» против «сделай») · State (события на смену статуса).

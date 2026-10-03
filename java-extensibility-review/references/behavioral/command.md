# Command (Команда)

Группа: поведенческий

## Суть
Запрос на действие становится объектом: в нём есть всё, чтобы действие выполнить. Такой объект можно передать обработчику, поставить в очередь, сохранить, залогировать, повторить или отменить. В бэкенде это обычно пара «команда-`record` + обработчик-бин» и диспетчер между ними.

## Структура (участники)
- **Command** — объект-запрос со всеми данными для выполнения (`CancelOrder(orderId, reason)`). Классически у него метод `execute()` (и `undo()`).
- **Receiver** — тот, кто делает реальную работу (сервисы, репозитории).
- **Invoker** — запускает команды, не зная их содержимого (диспетчер, очередь заданий, планировщик, consumer).
- **Client** — создаёт команду и передаёт её инвокеру (контроллер, Kafka-listener).
- В бэкенде команду обычно разделяют на данные (`record`) и обработчик (`CommandHandler`). Обработчик объединяет роли `execute` и Receiver.

```
Client ──создаёт──▶ Command(data)
Invoker ──dispatch(cmd)──▶ CommandHandler<Cmd> ──▶ Receiver (сервисы, репозитории)
```

## Признаки в Java/Spring коде
- Один эндпоинт или consumer с большим `switch (action)` / `switch (message.getType())`, где каждая ветка — отдельный use case.
- Сервис на 1500+ строк, в котором собраны все операции над сущностью, и каждая тянет свои зависимости.
- Операции нужно выполнять отложенно или по расписанию, повторять при сбое, писать в журнал, отменять (undo).
- Одна и та же операция вызывается из REST, из Kafka и из планировщика, и её параметры собираются по-разному.

## Когда не применять
- 3–4 операции в небольшом сервисе. CQRS-фреймворк (Axon и т.п.) ради этого — перебор.
- Нет ни очередей, ни журнала, ни undo, а диспетчеризация по ключу уже решена Strategy.

## После
```java
public sealed interface OrderCommand permits CreateOrder, CancelOrder, ChangeAddress {}
public record CreateOrder(UUID customerId, List<Line> lines) implements OrderCommand {}
public record CancelOrder(UUID orderId, String reason) implements OrderCommand {}
public record ChangeAddress(UUID orderId, Address address) implements OrderCommand {}

public interface CommandHandler<C extends OrderCommand> {
    Class<C> commandType();
    void handle(C command);
}

@Component
@RequiredArgsConstructor
class CancelOrderHandler implements CommandHandler<CancelOrder> {
    private final OrderRepository orders;
    public Class<CancelOrder> commandType() { return CancelOrder.class; }
    @Transactional public void handle(CancelOrder c) { /* … */ }
}

@Component
class CommandDispatcher {
    private final Map<Class<?>, CommandHandler<?>> handlers;

    CommandDispatcher(List<CommandHandler<?>> all) {
        this.handlers = all.stream().collect(Collectors.toMap(CommandHandler::commandType, Function.identity()));
    }

    @SuppressWarnings("unchecked")
    public <C extends OrderCommand> void dispatch(C command) {
        var handler = (CommandHandler<C>) handlers.get(command.getClass());
        if (handler == null) throw new IllegalArgumentException("No handler for " + command.getClass().getSimpleName());
        handler.handle(command);
    }
}
```
Контроллер, consumer и планировщик только собирают команду и вызывают `dispatch`. Логика каждой операции лежит в своём обработчике.

Явный `commandType()` проще и надёжнее, чем доставать generic-параметр рефлексией (у CGLIB-прокси generic теряется).

## Отложенное выполнение, повтор, журнал
Команда — `record`, поэтому её легко сериализовать в JSON и положить в таблицу заданий или outbox. Воркер читает, вызывает `dispatch`, отмечает выполнение. Повтор при сбое — повторный `dispatch` того же объекта, поэтому обработчик должен быть идемпотентным (ключ идемпотентности в команде).

## Undo
Если нужна отмена, у команды или обработчика появляется `undo(...)`, или обработчик возвращает компенсирующую команду. Для сложного состояния смотри `memento.md`.

## Готовая маршрутизация — сначала проверь её
Kafka: несколько `@KafkaHandler` по типу payload в одном `@KafkaListener` (класс с `@KafkaListener`). Spring Integration / Spring Cloud Stream routing. В REST часто достаточно отдельных эндпоинтов вместо `action` в теле запроса.

## Шаги рефакторинга
1. Тесты на каждую ветку `switch (action)`.
2. Выделить `record`-команду и обработчик для одной ветки; ветка вызывает обработчик.
3. Повторить для остальных; ввести диспетчер; убрать `switch`.

## Подводные камни
- Не надо оборачивать в команду каждый вызов метода: нужна причина (диспетчеризация, очередь, журнал).
- `@Transactional` ставь на `handle`, а не на диспетчер, иначе все команды окажутся в одной транзакции.

## Плюсы и минусы
**Плюсы**
- Отправитель отделён от исполнителя.
- Операции можно ставить в очередь, откладывать, логировать, повторять и отменять.
- Новая операция — новая пара «команда + обработчик», инвокер не меняется.
- Из простых команд собираются составные (макрокоманды).

**Минусы**
- Много мелких классов.
- Косвенность: по месту вызова не видно, какой код выполнится.
- Сериализуемые команды (очереди, outbox) — это контракт со схемой и версиями.

## Связанные паттерны
Strategy (как сделать, а не что) · Chain of Responsibility (команда идёт через цепочку middleware) · Memento (undo через снимок) · Observer (событие — «произошло», команда — «сделай»).

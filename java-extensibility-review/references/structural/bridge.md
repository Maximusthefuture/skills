# Bridge (Мост)

Группа: структурный

## Суть
Когда класс меняется по двум независимым осям, наследование даёт декартово произведение подклассов. Мост разделяет оси: абстракция (что делаем) хранит ссылку на реализацию (как или где делаем), и обе оси расширяются независимо. N + M классов вместо N × M.

## Структура (участники)
- **Abstraction** — высокоуровневая логика («что сделать»). Хранит ссылку на Implementation и делегирует ей низкоуровневую работу (`Notifier`, `MessageTemplate`).
- **RefinedAbstraction** — варианты абстракции (`OrderShippedTemplate`, `InvoiceReadyTemplate`).
- **Implementation** — интерфейс «как/где сделать» (`Channel`).
- **ConcreteImplementation** — реализации (`EmailChannel`, `SmsChannel`).

```
Abstraction ─────────────────▶ «interface» Implementation
    ▲          ▲                      ▲              ▲
RefinedA   RefinedB            ConcreteImplX   ConcreteImplY
        (N абстракций + M реализаций вместо N × M подклассов)
```

## Признаки в Java/Spring коде
- Имена классов — комбинации двух осей: `EmailOrderNotification`, `SmsOrderNotification`, `EmailInvoiceNotification`, `SmsInvoiceNotification`, `PushInvoiceNotification`…
- `switch (channel)` внутри `switch (messageType)` (или наоборот).
- Новый канал требует нового подкласса для каждого типа сообщения.
- Отчёты: `PdfSalesReport`, `ExcelSalesReport`, `PdfStockReport`… — тип отчёта × формат.

## Когда не применять
- Ось изменений одна → Strategy.
- Комбинаций мало, и они не растут.

## До
```java
abstract class Notification { abstract void send(Customer c); }
class EmailOrderShipped extends Notification { … }
class SmsOrderShipped   extends Notification { … }
class EmailInvoiceReady extends Notification { … }
class SmsInvoiceReady   extends Notification { … }
// + Push → ещё два класса, + новый тип сообщения → ещё по классу на каждый канал
```

## После
```java
// ось 1: КАК доставить (реализация)
public interface Channel {
    ChannelType type();
    void deliver(Recipient to, RenderedMessage message);
}
@Component class EmailChannel implements Channel { … }
@Component class SmsChannel   implements Channel { … }

// ось 2: ЧТО отправить (абстракция) — ничего не знает о каналах
public interface MessageTemplate<E> {
    String kind();
    RenderedMessage render(E event, ChannelType channel);   // текст под ограничения канала (SMS короче)
}
@Component class OrderShippedTemplate implements MessageTemplate<OrderShipped> { … }

// мост: соединяет оси в рантайме
@Service
@RequiredArgsConstructor
class Notifier {
    private final ChannelRegistry channels;          // реестр по ChannelType, см. strategy.md
    private final PreferenceService preferences;

    public <E> void notify(Customer c, E event, MessageTemplate<E> template) {
        for (ChannelType ch : preferences.channelsFor(c, template.kind())) {
            channels.get(ch).deliver(c.recipient(), template.render(event, ch));
        }
    }
}
```
Новый канал — один класс `Channel`. Новый тип сообщения — один `MessageTemplate`.

## Шаги рефакторинга
1. Выписать матрицу существующих классов (ось 1 × ось 2), найти, что общее по строкам и столбцам.
2. Выделить интерфейс реализации (каналы) и перенести в него код доставки.
3. Шаблоны сообщений оставить без знания о транспорте.
4. Удалить комбинированные подклассы.

## Подводные камни
- Оси не всегда независимы (у SMS свои ограничения на длину). Явно передавай контекст другой оси (здесь — `ChannelType` в `render`), а не прячь `instanceof` внутрь.
- Не изобретай вторую ось заранее: Bridge оправдан, когда комбинации уже начали размножаться.

## Плюсы и минусы
**Плюсы**
- N + M классов вместо N × M.
- Две оси развиваются независимо (Open/Closed по каждой).
- Реализацию можно выбрать или заменить в рантайме.
- Клиент работает с высокоуровневой абстракцией и не видит деталей платформы.

**Минусы**
- Лишнее усложнение, если ось изменений одна.
- Оси нужно правильно определить заранее, а переделывать мост дорого.
- Интерфейс реализации должен подходить всем абстракциям; иногда приходится передавать контекст другой оси.

## Связанные паттерны
Strategy (одна ось) · Adapter (стыкует готовое, а не проектирует оси) · Abstract Factory (может создавать согласованные пары абстракция/реализация).

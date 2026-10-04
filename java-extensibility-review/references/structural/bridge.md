# Bridge

Group: structural

## Essence
When a class varies along two independent axes, inheritance gives a Cartesian product of subclasses. A bridge separates the axes: the abstraction (what we do) holds a reference to the implementation (how or where we do it), and both axes extend independently. N + M classes instead of N × M.

## Structure (participants)
- **Abstraction** — the high-level logic ("what to do"). Holds a reference to Implementation and delegates the low-level work to it (`Notifier`, `MessageTemplate`).
- **RefinedAbstraction** — variants of the abstraction (`OrderShippedTemplate`, `InvoiceReadyTemplate`).
- **Implementation** — the "how/where to do it" interface (`Channel`).
- **ConcreteImplementation** — implementations (`EmailChannel`, `SmsChannel`).

```
Abstraction ─────────────────▶ «interface» Implementation
    ▲          ▲                      ▲              ▲
RefinedA   RefinedB            ConcreteImplX   ConcreteImplY
        (N abstractions + M implementations instead of N × M subclasses)
```

## Signs in Java/Spring code
- Class names are combinations of two axes: `EmailOrderNotification`, `SmsOrderNotification`, `EmailInvoiceNotification`, `SmsInvoiceNotification`, `PushInvoiceNotification`…
- A `switch (channel)` inside a `switch (messageType)` (or the reverse).
- A new channel needs a new subclass for every message type.
- Reports: `PdfSalesReport`, `ExcelSalesReport`, `PdfStockReport`… — report type × format.

## When not to apply
- There is one axis of change → Strategy.
- There are few combinations and they do not grow.

## Before
```java
abstract class Notification { abstract void send(Customer c); }
class EmailOrderShipped extends Notification { … }
class SmsOrderShipped   extends Notification { … }
class EmailInvoiceReady extends Notification { … }
class SmsInvoiceReady   extends Notification { … }
// + Push → two more classes, + a new message type → one more class per channel
```

## After
```java
// axis 1: HOW to deliver (the implementation)
public interface Channel {
    ChannelType type();
    void deliver(Recipient to, RenderedMessage message);
}
@Component class EmailChannel implements Channel { … }
@Component class SmsChannel   implements Channel { … }

// axis 2: WHAT to send (the abstraction) — knows nothing about channels
public interface MessageTemplate<E> {
    String kind();
    RenderedMessage render(E event, ChannelType channel);   // text fitted to the channel's limits (SMS is shorter)
}
@Component class OrderShippedTemplate implements MessageTemplate<OrderShipped> { … }

// the bridge: joins the axes at runtime
@Service
@RequiredArgsConstructor
class Notifier {
    private final ChannelRegistry channels;          // a registry by ChannelType, see strategy.md
    private final PreferenceService preferences;

    public <E> void notify(Customer c, E event, MessageTemplate<E> template) {
        for (ChannelType ch : preferences.channelsFor(c, template.kind())) {
            channels.get(ch).deliver(c.recipient(), template.render(event, ch));
        }
    }
}
```
A new channel is one `Channel` class. A new message type is one `MessageTemplate`.

## Refactoring steps
1. Write out the matrix of existing classes (axis 1 × axis 2), find what is common along rows and columns.
2. Extract the implementation interface (channels) and move the delivery code into it.
3. Keep the message templates unaware of the transport.
4. Remove the combined subclasses.

## Pitfalls
- The axes are not always independent (SMS has its own length limits). Pass the context of the other axis explicitly (here `ChannelType` in `render`) instead of hiding an `instanceof` inside.
- Do not invent a second axis in advance: Bridge is justified when the combinations have already started to multiply.

## Pros and cons
**Pros**
- N + M classes instead of N × M.
- The two axes evolve independently (Open/Closed along each).
- The implementation can be chosen or replaced at runtime.
- The client works with a high-level abstraction and does not see platform details.

**Cons**
- Needless complexity if there is one axis of change.
- The axes must be identified correctly up front, and reworking a bridge is expensive.
- The implementation interface must suit all abstractions; sometimes the other axis's context has to be passed.

## Related patterns
Strategy (one axis) · Adapter (joins existing things, does not design axes) · Abstract Factory (can create matching abstraction/implementation pairs).

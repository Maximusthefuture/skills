# State (Состояние)

Группа: поведенческий

## Суть
Поведение объекта зависит от его текущего состояния. Вместо `if (status == …)` в каждом методе правила (какие переходы разрешены, как ведёт себя операция в этом состоянии) собираются в объекте-состоянии. В Java это обычно enum: на простом уровне — таблица переходов, на полном — абстрактные методы у каждой константы.

## Структура (участники)
- **Context** — объект с изменяемым поведением (`Order`). Хранит текущее состояние и делегирует ему операции, зависящие от состояния.
- **State** — интерфейс (или enum) с операциями, поведение которых зависит от состояния (`cancel`, `pay`, `ship`).
- **ConcreteState** — поведение в конкретном состоянии (`NEW`, `PAID`, `SHIPPED`). Решает, разрешена ли операция и какое состояние следующее.

```
Context ──текущее──▶ «interface» State ◀── NewState, PaidState, ShippedState
   ▲                                              │
   └────────── переход: context.state = next ─────┘
```
Отличие от Strategy: состояние меняется изнутри, по ходу жизни объекта, и состояния знают о переходах друг в друга.

## Признаки в Java/Spring коде
- `if (order.getStatus() == NEW && target == PAID) … else if (…)` в нескольких сервисах.
- Методы `cancel()`, `ship()`, `refund()` начинаются с одинаковых проверок статуса.
- Статус меняется сеттером из разных мест (`order.setStatus(…)`), единой точки смены нет.
- Баги вида «заказ отменили после отгрузки».

## Когда не применять
- Статус — просто метка без правил.
- Долгие процессы с таймерами, вложенными состояниями и персистентностью процесса. Сначала прикинь, хватит ли таблицы в enum; Spring Statemachine или Camunda — только если их сложность действительно нужна.

## До
```java
void cancel(Order o) {
    if (o.getStatus() == SHIPPED || o.getStatus() == DELIVERED) throw new IllegalStateException();
    if (o.getStatus() == PAID) refundService.refund(o);
    o.setStatus(CANCELLED);
}
void ship(Order o) {
    if (o.getStatus() != PAID) throw new IllegalStateException();
    o.setStatus(SHIPPED);
}
```

## После — уровень 1: таблица переходов в enum
```java
public enum OrderStatus {
    NEW, PAID, SHIPPED, DELIVERED, CANCELLED;

    private static final Map<OrderStatus, Set<OrderStatus>> TRANSITIONS = new EnumMap<>(Map.of(
            NEW,       EnumSet.of(PAID, CANCELLED),
            PAID,      EnumSet.of(SHIPPED, CANCELLED),
            SHIPPED,   EnumSet.of(DELIVERED),
            DELIVERED, EnumSet.noneOf(OrderStatus.class),
            CANCELLED, EnumSet.noneOf(OrderStatus.class)));

    public boolean canTransitionTo(OrderStatus next) {
        return TRANSITIONS.get(this).contains(next);
    }
}

// в сущности — единственная точка смены статуса, без публичного setStatus
public void transitionTo(OrderStatus next) {
    if (!status.canTransitionTo(next)) throw new IllegalStatusTransitionException(status, next);
    this.status = next;
}
```

## После — уровень 2: поведение по состояниям
Когда операции ведут себя по-разному в разных состояниях:
```java
public enum OrderState {
    NEW {
        @Override OrderState cancel(Order o, OrderEffects fx) { return CANCELLED; }
        @Override OrderState pay(Order o, OrderEffects fx)    { return PAID; }
    },
    PAID {
        @Override OrderState cancel(Order o, OrderEffects fx) { fx.refund(o); return CANCELLED; }
        @Override OrderState ship(Order o, OrderEffects fx)   { fx.ship(o);   return SHIPPED; }
    },
    SHIPPED, DELIVERED, CANCELLED;

    // по умолчанию операция запрещена
    OrderState cancel(Order o, OrderEffects fx) { throw illegal("cancel"); }
    OrderState pay(Order o, OrderEffects fx)    { throw illegal("pay"); }
    OrderState ship(Order o, OrderEffects fx)   { throw illegal("ship"); }

    private IllegalStatusTransitionException illegal(String op) {
        return new IllegalStatusTransitionException(this, op);
    }
}
```
`OrderEffects` — интерфейс, который реализует Spring-бин. Через него состояния вызывают побочные действия, при этом enum не хранит зависимостей. Если эффекты тяжёлые, лучше публиковать событие `OrderStatusChanged` (см. `observer.md`).

## Шаги рефакторинга
1. Собрать все места смены статуса: `grep -rn "setStatus\|getStatus() ==" src/main/java`.
2. Параметризованный тест по всем парам (from, to) с текущим поведением.
3. Ввести таблицу переходов и `transitionTo`; заменить `setStatus` в сервисах.
4. При необходимости перенести поведение по состояниям в enum или в классы состояний.

## Подводные камни
- Полный параметризованный тест таблицы (все пары) дешёвый и ценный. Предлагай его вместе с рефакторингом.
- Конкурентная смена статуса требует `@Version` (оптимистическая блокировка) или условного `UPDATE … WHERE status = :expected`.
- Enum хранится в БД (`@Enumerated(STRING)`): константы можно добавлять, но не переименовывать.

## Плюсы и минусы
**Плюсы**
- Правила каждого состояния собраны в одном месте, а не размазаны `if (status == …)` по сервисам.
- Допустимые переходы явны и легко покрываются тестом таблицы.
- Методы контекста упрощаются: нет ветвлений по статусу.

**Минусы**
- Избыточно для 2–3 состояний без собственной логики.
- Состояния знают друг о друге (кто следующий), и это связанность.
- В enum-реализации нельзя внедрять бины. Побочные эффекты нужно передавать через параметр или события.
- При десятках состояний и операций логика дробится на множество мелких методов.

## Связанные паттерны
Strategy (похожая структура, но выбор делается снаружи) · Observer (реакции на смену статуса) · Memento (откат состояния).

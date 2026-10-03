# Proposal

## Why

Курьерская служба не знает, куда везти заказ: адреса доставки в заказе нет.

## What Changes

- Заказ хранит адрес доставки, клиент передаёт его при создании
- Клиент может поменять адрес, пока заказ не отправлен
- Адрес виден в GET /orders/{id}

## Capabilities

### New Capabilities
- `order-delivery`: адрес доставки заказа и его изменение

### Modified Capabilities
- `order-lifecycle`: создание заказа требует адрес

## Impact

Маршрут: фича · M · сигналы: новая колонка, изменение контракта POST /orders → data-modeling-discipline, migration-safety, error-handling-as-design

- Таблица `orders`: колонка `delivery_address`
- POST /orders: новое обязательное поле `deliveryAddress`
- Новый эндпоинт PUT /orders/{id}/address

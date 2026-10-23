## Why
Покупатели просят подарочную упаковку. Это +5% к среднему чеку по опросу.

## What Changes
- Новый модуль giftwrap: GiftWrapController, GiftWrapService, GiftWrapRepository
- Поле gift_wrap и gift_message в заказе
- Событие GiftWrapAdded в Kafka
- Стоимость упаковки 150 руб.

## Capabilities
### New Capabilities
- `order-gift-wrap`: подарочная упаковка заказа

## Impact
- REST API, таблица orders, Kafka

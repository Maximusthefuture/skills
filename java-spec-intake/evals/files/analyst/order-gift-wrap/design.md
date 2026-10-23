## Context
Отдельный модуль com.acme.orders.giftwrap с пакетами web, service, repo.

## Decisions
- GiftWrapController (@RestController) в com.acme.orders.giftwrap.web, DTO GiftWrapRequest рядом с контроллером.
- Интерфейс GiftWrapPricing и реализация DefaultGiftWrapPricing — на будущее.
- Миграция Flyway V12__gift_wrap.sql: ALTER TABLE orders ADD COLUMN gift_wrap BOOLEAN NOT NULL; ADD COLUMN gift_message VARCHAR(500).
- После сохранения сервис сразу отправляет GiftWrapAdded через KafkaTemplate.
- Стоимость считается как double: total = total + 150.0.

## Open Questions
- Можно ли добавлять упаковку к оплаченному заказу?

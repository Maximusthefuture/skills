# Design

## Context

Endpoint в OrderController, нагрузка как у создания заказа.

## Goals / Non-Goals

**Goals:** адрес в заказе и его смена.

**Non-Goals:** валидация адреса через внешний сервис.

## Decisions

- Колонка `orders.delivery_address text NOT NULL`, одним changeset'ом.
- Смена адреса разрешена только в статусе NEW; иначе 409 `ORDER_NOT_EDITABLE`.
- Проверка владельца — как в getOrder: `findByIdAndCustomerId`, чужой заказ → 404.
- Адрес — одна строка до 500 символов, без структуры.

## Risks / Trade-offs

- Клиенты API должны начать слать адрес → предупредить фронт.

## Migration Plan

- Changeset `ALTER TABLE orders ADD COLUMN delivery_address text NOT NULL`.

## Open Questions

- Можно ли менять адрес после оплаты (PAID), пока заказ не отправлен?

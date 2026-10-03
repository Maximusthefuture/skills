# order-lifecycle Specification

## Purpose

Жизненный цикл заказа клиента: создание, чтение, отмена.

## Requirements

### Requirement: Create order
The system SHALL create an order in status NEW for the calling customer.

#### Scenario: Order created
- **WHEN** POST /orders with amount 100.00 and header X-Customer-Id 7
- **THEN** 201, body has status `NEW` and amount 100.00

#### Scenario: Unknown customer
- **WHEN** POST /orders with X-Customer-Id of a missing customer
- **THEN** 404

### Requirement: Cancel order
The system SHALL cancel an order of the calling customer in status NEW.

#### Scenario: Cancel NEW order
- **WHEN** POST /orders/1/cancel for own order in NEW
- **THEN** 200 and status `CANCELLED`

# Spec Delta

## Purpose

Адрес доставки заказа: где он хранится, кто и когда может его менять.

## ADDED Requirements

### Requirement: Change delivery address
The system SHALL let the customer change the delivery address of an own order.

#### Scenario: Address changed
- **WHEN** PUT /orders/1/address with a new address for own order in NEW
- **THEN** адрес обновляется корректно

### Scenario: Address too long
- **WHEN** PUT /orders/1/address with address longer than 500 characters
- **THEN** 400 `VALIDATION_ERROR`

### Requirement: Address in order response
The system SHALL return the delivery address in GET /orders/{id}.

#### Scenario: Address returned
- **WHEN** GET /orders/1 for own order
- **THEN** 200, body field `deliveryAddress` equals the stored address

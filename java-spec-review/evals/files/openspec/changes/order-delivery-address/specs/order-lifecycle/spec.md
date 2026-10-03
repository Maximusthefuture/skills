# Spec Delta

## MODIFIED Requirements

### Requirement: Create order
The system SHALL create an order in status NEW for the calling customer with a delivery address.

#### Scenario: Order created
- **WHEN** POST /orders with amount 100.00, deliveryAddress "Lenina 1" and header X-Customer-Id 7
- **THEN** 201, body has status `NEW`, amount 100.00 and deliveryAddress "Lenina 1"

#### Scenario: Missing address
- **WHEN** POST /orders without deliveryAddress
- **THEN** 400 `VALIDATION_ERROR`

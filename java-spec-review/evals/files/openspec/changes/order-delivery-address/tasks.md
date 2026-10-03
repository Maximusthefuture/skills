# Tasks

## 1. Схема

- [ ] 1.1 Changeset с колонкой delivery_address — проверка: приложение стартует

## 2. API

- [ ] 2.1 Поле deliveryAddress в POST /orders и в ответе
- [ ] 2.2 Эндпоинт PUT /orders/{id}/address — @WebMvcTest — проверка: `OrderAddressControllerTest`

## 3. Тесты

- [ ] 3.1 Тест репозитория на H2 — проверка: `OrderRepositoryAddressTest`
- [ ] 3.2 Интеграционные тесты — проверка: `./mvnw verify`

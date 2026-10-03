# Null Object / реализация по умолчанию

Тип: классический паттерн (не GoF), часто — дефолтная стратегия

## Суть
Вместо `null` или «отсутствующего» обработчика используется реализация интерфейса, которая осознанно ничего не делает (или делает поведение по умолчанию). Проверки `if (x != null)` в местах вызова исчезают, а «ничего не делать» становится явным, именованным и тестируемым поведением.

## Признаки в Java/Spring коде
- `if (notifier != null) notifier.send(…)` в нескольких местах.
- `Optional<Handler>` с `ifPresent` в каждом месте вызова.
- `@Autowired(required = false)` с последующими null-проверками.
- `default -> {}` (пустая ветка) в каждом `switch`.
- Флаг `if (props.isAuditEnabled()) audit.log(…)` в нескольких местах.

## Когда не применять
- «Ничего не делать» маскирует ошибку: если отсутствие обработчика — баг конфигурации, лучше упасть при старте (см. проверку полноты в `../behavioral/strategy.md`).
- Вызывающему важно знать, что действие не выполнилось (тогда нужен явный результат).

## После
```java
public interface AuditLog { void record(AuditEvent e); }

@Configuration
class AuditConfig {
    @Bean
    @ConditionalOnProperty(name = "audit.enabled", havingValue = "true")
    AuditLog dbAuditLog(AuditRepository repo) { return new DbAuditLog(repo); }

    @Bean
    @ConditionalOnMissingBean(AuditLog.class)
    AuditLog noopAuditLog() {
        return e -> log.debug("Audit disabled, skipping {}", e.type());   // ничего не делаем, но видно в debug
    }
}

// в сервисах — без проверок
audit.record(new AuditEvent("order.created", orderId));
```
В реестрах стратегий это обработчик по умолчанию для ключей без своей реализации, но только если такое поведение — осознанное бизнес-решение.

## Подводные камни
- `@ConditionalOnMissingBean` надёжно работает в автоконфигурации; в обычных `@Configuration` порядок обработки может удивить. Безопаснее пара `@ConditionalOnProperty(havingValue = "true")` / `(havingValue = "false", matchIfMissing = true)`.
- Null Object, который возвращает значения (например, пустой список), должен соблюдать контракт интерфейса.
- Логируй на `debug`, что сработала заглушка. Иначе «почему не пришло письмо» будет долгим расследованием.

## Связанные паттерны
Strategy (дефолтная стратегия) · Конфигурация вместо кода (`@ConditionalOnProperty`) · Proxy (`@Lazy` / опциональные зависимости).

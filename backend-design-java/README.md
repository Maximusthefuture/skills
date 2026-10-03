# Backend Design: Java

Форк плагина [Backend Design 0.2.0](https://github.com/sheitabrk/backend-design) для Claude Code, адаптированный под стек **Java 21+ / Spring Boot 3.x–4.x / Hibernate (JPA) / PostgreSQL / Liquibase**.

Идеи апстрима сохранены: думать до кода, инварианты в схеме, каждая миграция — потенциальный инцидент, идемпотентность и наблюдаемость с первого дня, скучная технология по умолчанию. Примеры на Prisma, TypeScript и Python заменены на Spring, Hibernate и Liquibase. Добавлены ловушки, которых в оригинале не было вовсе.

## Что изменилось относительно оригинала

### Хуки: переписаны и починены

В оригинале хуки на этом стеке фактически не работали:

| Проблема в 0.2.0 | Что сделано |
|---|---|
| `hooks.json` вызывал `python`, а на macOS есть только `python3`, поэтому хуки падали | Вызов через `python3` |
| `PreToolUse` + stderr + `exit 0`: такой вывод **не попадает к Claude**, предупреждения уходили в пустоту | `PostToolUse` + JSON `hookSpecificOutput.additionalContext`: Claude видит находки и может сразу исправить. Пользователь видит короткий `systemMessage`. |
| Детекторы под Python/JS (`requests`, `axios`, `except: pass`) | Детекторы под Java/Spring: `@Transactional`, `@KafkaListener`, `@Scheduled`, `RestClient`, `@Entity`, `application.yml` |
| Пути Liquibase (`db/changelog/*.xml\|yaml\|sql`) не распознавались как миграции | Formatted SQL, XML и YAML changelog. Разбор по changeset'ам: проверяются только новые и изменённые. |
| `/test` в пути отключал проверки и для пакета `com/acme/testimonials` | Пропускаются только `src/test`, `src/it`, `target`, `build`, `generated` |
| Для Edit сканировалась и удалённая строка (`old_string`) | Хук читает файл с диска целиком и проверяет итоговое состояние |
| Тестов не было (хотя CONTRIBUTING их требует) | `hooks/tests/test_hooks.py`: 41 позитивный и негативный кейс |

Что ловят хуки:

- **`check_migration.py`** (Liquibase + PostgreSQL):
  - правка уже существующего changeset'а (сломает checksum на окружениях);
  - `CREATE INDEX` без `CONCURRENTLY`, или `CONCURRENTLY` без `runInTransaction:false`;
  - `NOT NULL` без default, volatile default (`gen_random_uuid()`), `SET NOT NULL` и `addNotNullConstraint defaultNullValue`;
  - FK/CHECK без `NOT VALID`;
  - смена типа, rename, drop;
  - `UPDATE`/`DELETE` внутри changeset'а;
  - нет `--rollback`, нет `lock_timeout`;
  - `validCheckSum`, `runOnChange` на DDL.
- **`check_backend_component.py`** (Spring/JPA):
  - `@Transactional` на `private`;
  - HTTP или Kafka внутри транзакции;
  - `REQUIRES_NEW`;
  - `@RequestBody` без `@Valid`, сущность как `@RequestBody`, per-id эндпоинт без видимой авторизации;
  - `findAll()` без лимита;
  - листенер без дедупликации и DLT;
  - `@Scheduled` без ShedLock;
  - HTTP-клиент без таймаутов;
  - в сущностях: Lombok `@Data`, EAGER to-one, ORDINAL enum, `double` для денег, `LocalDateTime`, `IDENTITY`;
  - в конфиге: `ddl-auto=update`, `open-in-view` не выключен, `show-sql`.
- **`check_security.py`** (Java + `application*.yml`):
  - SQL/JPQL через конкатенацию, `String.format` и `.formatted()`;
  - SpEL-инъекция, небезопасная десериализация, XXE, `Runtime.exec`;
  - trust-all TLS;
  - `NoOpPasswordEncoder`, MD5/SHA-1, ECB, `Random` для токенов;
  - `anyRequest().permitAll()`, отключённый CSRF, CORS `*`;
  - Actuator `include=*`, stacktrace в ответах;
  - секреты литералом в коде и в `application.yml`.

Все хуки только предупреждают, ничего не блокируют, и любая внутренняя ошибка в них глушится.

### Скиллы

Все 13 скиллов переписаны под стек и добавлен один новый:

- **`jpa-and-transactions`** (новый):
  - прокси-природа `@Transactional`: self-invocation, `private`, checked exceptions коммитят, `UnexpectedRollbackException`, `REQUIRES_NEW` и дедлок пула;
  - OSIV;
  - гигиена маппинга: LAZY, STRING, equals/hashCode без Lombok, каскады, `Set` против bag;
  - ID: SEQUENCE и `allocationSize`, UUIDv7;
  - persistence context, dirty checking, батчинг;
  - `@Version` и `SKIP LOCKED`.
- **`migration-safety`**:
  - неизменяемость changeset'ов и checksum;
  - `runInTransaction:false` для `CONCURRENTLY`;
  - очередь блокировок и `lock_timeout`;
  - `DATABASECHANGELOGLOCK` и убитые поды;
  - миграции отдельным Job, а не на старте каждого пода;
  - NOT NULL без скана через `CHECK NOT VALID → VALIDATE → SET NOT NULL`;
  - expand/contract вместе с Hibernate.
- **`query-discipline`**:
  - где прячется N+1 в Spring: EAGER to-one, мапперы, Jackson + OSIV, `findById` в цикле;
  - `Page` против `Slice` против keyset `Window`;
  - fetch коллекции с пагинацией (`HHH90003004`);
  - generic plans в pgjdbc;
  - padding для `IN`.
- **`data-modeling-discipline`**:
  - таблица соответствия типов Postgres и Java;
  - `@Column(nullable=false)` — это не constraint;
  - инварианты, которые Hibernate не выражает (`num_nonnulls`, partial unique);
  - `@SQLRestriction` и soft delete.
- **`idempotency-and-side-effects`**:
  - Spring Kafka по умолчанию после 9 ретраев **логирует и пропускает** запись;
  - outbox на `SKIP LOCKED`;
  - `@TransactionalEventListener(AFTER_COMMIT)` — это не outbox;
  - один слой ретраев.
- **`error-handling-as-design`**:
  - `@RestControllerAdvice` + `ProblemDetail` со стабильными кодами;
  - маппинг имени constraint'а в код ошибки;
  - checked exceptions и откат;
  - таймауты: Hikari, statement, HTTP.
- **`observability-by-default`**:
  - structured logging (Boot 3.4+), Micrometer, OTel;
  - health groups: БД только в readiness, никогда в liveness;
  - Hikari pending как первый график при «всё тормозит».
- **`performance-and-scaling`**:
  - бюджет соединений: поды × пул ≤ возможностей Postgres;
  - виртуальные потоки не добавляют ёмкости БД;
  - PgBouncer и prepared statements;
  - кэш второго уровня выключен по умолчанию.
- **`security-discipline`**, **`auth-and-authorization`**:
  - deny-by-default в `SecurityFilterChain`, IDOR через `findById`;
  - проверка `aud` в resource server;
  - RLS с `FORCE` и transaction-local `set_config` (иначе тенант утекает через пул).
- **`debugging-discipline`**: карта «симптом → куда смотреть» для Spring и Postgres (Hikari timeout, `idle in transaction`, `pg_blocking_pids`, OOM, stuck Liquibase lock), `jcmd`/JFR до рестарта.
- **`testing-with-discernment`**: выбор инфраструктуры по сборке проекта (есть Testcontainers — БД и Kafka на них, нет — Kafka на `@EmbeddedKafka`), тесты `@KafkaListener` и producer'ов, Testcontainers вместо H2, `@Transactional` в тестах скрывает поведение на коммите, кэш контекстов и `@MockitoBean`, assert'ы на количество запросов.
- **`think-before-coding`** и **`boring-by-default`**: шаги и дефолтный стек на Spring-конструкциях (MVC + виртуальные потоки вместо WebFlux, `SKIP LOCKED` вместо Kafka внутри сервиса, `jsonb` вместо Mongo, Spring Modulith вместо микросервисов).

В `description` каждого скилла добавлены русские триггеры («миграция», «тормозит», «напиши тест», …), чтобы скиллы срабатывали на запросы на русском. Тела скиллов остались на английском, как в апстриме.

### Агенты и команды

- **`schema-reviewer`** сверяет changeset и `@Entity` друг с другом (дрейф типов, nullability, sequence).
- **`security-reviewer`** проходит чек-лист Spring Security, Actuator и десериализации.
- **`component-architect`**: blueprint включает changeset'ы, границы транзакций и таблицу кодов ошибок.
- **`incident-thinker`**, **`incident-investigator`**: сценарии и инструменты JVM, Hikari и Kafka.
- **`/backend-design-java:review-migration`** проверяет неизменяемость через `git diff` против базовой ветки, готовит план деплоя и исправленный changeset.
- **`/backend-design-java:hunt-n-plus-one`** ищет N+1 в Hibernate и Spring Data и проверяет исправление assert'ом на количество запросов.
- **`/backend-design-java:explain-this-query`** переводит derived methods и JPQL в SQL и учитывает `Page` + count.
- **`/backend-design-java:audit`** получил новые разделы «JPA and transactions» и «Timeouts».
- **`/backend-design-java:design`**: дизайн-сессия по 6 шагам в терминах Spring.

## Установка

Плагин называется `backend-design-java`, поэтому может стоять рядом с оригинальным `backend-design`. Если оставить оба, отключите оригинал: иначе сработают оба набора скиллов и хуков.

Ручная установка: положите каталог в место для плагинов Claude Code и включите его в настройках. Проверка:

```bash
claude plugin validate /path/to/backend-design-java
```

Хукам нужен `python3` (3.8+) в PATH. На Windows замените в `hooks/hooks.json` `python3` на `py -3`.

## Тесты хуков

```bash
python3 hooks/tests/test_hooks.py -v
```

## Предположения о стеке

Java 21+, Spring Boot 3.2+ (часть советов помечена 3.4+ или PostgreSQL 16+/18+), Hibernate 6+, PostgreSQL 12+, Liquibase 4.x, Kafka или RabbitMQ через Spring. Если у вас Flyway вместо Liquibase, хук миграций всё равно проверяет SQL-правила для `V*__*.sql`. Liquibase-специфичные правила (`runInTransaction`, rollback) к ним не применяются.

## Лицензия

MIT, как у апстрима. См. LICENSE.

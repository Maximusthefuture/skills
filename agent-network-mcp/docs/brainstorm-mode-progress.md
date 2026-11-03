# Brainstorm: реализация и проверка

Первая версия реализована в ветке `codex/brainstorm-mode` от `bb7153b`. Работал основной агент и один
сабагент: ядро, затем проверка интеграции. Реальные модели, включая Qwen, не вызывались.

## Что доступно

- Включение в форме задачи, CLI (`--brainstorm`, `--brainstorm-rounds`) и предложении координатора.
- Варианты каждого участника → раскрытие → рецензии → синтез ведущего → решение пользователя.
- Версии, хеш решения, revision, идентификаторы операций, ограничение раундов и размера материалов.
- Утверждение, возврат с замечаниями, продление, изменение постановки с архивом предыдущей эпохи.
- Запрет реализации до утверждения; отдельное утверждение плана при `planReview`.
- Ожидание без работающей модели и свежая сессия после утверждения; адаптеры Codex, Claude и Qwen.
- Вкладки материалов, прогресс команды, уведомление «Нужно мне», сохранение черновика замечаний и фокуса.

Ядро собрано в `src/brainstorm/index.ts`, а не в четырёх файлах из первоначальной разбивки.
Состояние сохраняется под блокировкой задачи. При одновременной отправке второй запрос получает
ошибку устаревшей revision и должен повториться с актуальным контекстом; данные первого не теряются.

## Доказательства

Пути ниже относительно репозитория. После `#` указано полное название теста.

| Требование | Проверка |
| --- | --- |
| Настройки ограничены; чтение не создаёт лишних записей | `test/unit/brainstormCore.test.ts#defaults the bounded config and keeps read-only initialization deterministic` |
| Полный цикл и восстановление хранилища | `test/unit/brainstormCore.test.ts#requires all options/critiques, lead synthesis and exact operator approval; survives reload` |
| Схемы примеров подходят для следующего действия | `test/unit/brainstormCore.test.ts#provides schema-valid action examples with actual peer option identifiers` |
| Начальные варианты скрыты от других участников | `test/unit/brainstormCore.test.ts#hides other initial options and operation bodies, but reveals the complete comparison stage` |
| Повтор, конфликт операции, revision, эпоха, посторонний агент | `test/unit/brainstormCore.test.ts#makes retries idempotent, rejects operation reuse, stale revisions, late epochs and nonmembers` |
| Рецензия чужого варианта и права ведущего | `test/unit/brainstormCore.test.ts#requires a peer critique and rejects premature/nonlead synthesis` |
| Лимит, продление, возврат, старое решение | `test/unit/brainstormCore.test.ts#preserves exhausted rounds, extends explicitly and versions a revised decision` |
| Серверные запреты и переход к IMPLEMENT | `test/integration/brainstorm.test.ts#guides participants, hides initial options and gates all normal paths until explicit approval` |
| План утверждается отдельно и сбрасывается при изменении brief | `test/integration/brainstorm.test.ts#requires an independent plan approval when planReview is enabled` |
| Настоящий MCP transport, без модели | `test/integration/brainstorm.test.ts#accepts the context example through the actual MCP transport` |
| Конкурентные записи под task lock | `test/integration/brainstorm.test.ts#serializes concurrent submissions and permits a stale participant to retry without losing materials` |
| HTTP: человек, stale approval, supervisor, feedback, продление | `test/integration/brainstorm.test.ts#exposes human approval in HTTP, rejects stale/supervisor decisions and supports explicit round extension` |
| Пересчёт фаз не принимает старый хеш соглашения | `test/integration/brainstorm.test.ts#the pure phase evaluator cannot advance a brainstorm task using an old agreement` |
| Отмена и несовместимые настройки | `test/integration/brainstorm.test.ts#rejects incompatible task settings and freezes cancelled discussions` |
| Свежая сессия, бюджет рестартов, скрытый activity/transcript | `test/integration/brainstorm.test.ts#restarts a read-only brainstorm session after approval without consuming the failure budget or leaking activity` |
| Новая постановка, архив, повтор reset и старое соглашение | `test/integration/brainstorm.test.ts#changes the brief explicitly, archives old materials and invalidates agreement/plan approval` |
| Аргументы адаптеров CLI и запрет неизвестного runner | `test/integration/brainstorm.test.ts#restricts native write tools for each supported CLI and refuses unsupported adapters` |

Целевой прогон: **35 тестов прошли** (10 интеграционных Brainstorm, 7 ядра, 8 ожидания runner,
7 владения файлами, 3 согласованности документации). `npm run build`, `npm run typecheck`, `git diff --check` проходят.
Дополнительно прошли **32 регрессионных теста**: advanced MCP, планы, уведомления, команды проекта
и payload предложений координатора. Включён полный обычный цикл DISCUSS → DONE с исправлениями
после review, конкурентными сообщениями и восстановлением после SIGKILL.

Общий прогон `npx vitest run --maxWorkers=2 --minWorkers=1`: **651 passed, 26 failed, 4 skipped**.
Он выполнен перед добавлением последнего теста конкурентной записи и финальной привязкой файловых
разрешений к хешу решения; эти изменения проверены целевым прогоном.
Все 26 названий упавших тестов воспроизводятся в чистом checkout исходного `bb7153b` с теми же зависимостями
и числом workers. Среди причин: Unix-пути и команды в Windows, права на symlink, EPERM при rename,
установленный Qwen в тесте, ожидающем его отсутствия, тайминги фоновых операций.
Общий набор нельзя считать зелёным; исправления этих старых проблем не входят в эту ветку.

## Проверка интерфейса

Карточка с тестовыми вариантами localStorage/IndexedDB просмотрена в headless Chrome на отдельном сервере.
Проверены расположение рекомендации, разногласий, ограничений, поля замечаний и кнопок решения.
После просмотра исправлены фон поля замечаний и показ выбранного подхода вместо внутреннего ID.
Это визуальная проверка; автоматизированная проверка ввода, прокрутки и двух окон браузера не выполнялась.
HTTP-тесты проверяют устаревшие действия и версии независимо от браузера.

Для ручной приёмки создайте задачу с двумя настроенными runner и Brainstorm. После подачи вариантов
откройте вкладки сравнения и рекомендации. Верните решение с замечаниями, при необходимости добавьте раунд.
Убедитесь, что замечания сохраняются при обновлении карточки. Утвердите решение и отдельно план, если он включён.
Проверьте переход к соглашению. Для проверки stale-окна откройте задачу в двух окнах и измените её в первом:
действие со старой версией во втором должно потребовать обновления, не изменяя новое решение.

## Границы гарантий и оставшаяся приёмка

- Качество аргументов моделей и работа на конкретных моделях не проверялись.
- Адаптеры проверены по аргументам запуска и fake session. Реальный запуск CLI с ограничениями — отдельная
  приёмка, особенно для Qwen extensions и сторонних MCP. Неизвестный CLI отклоняется без снятия ограничений.
- Скрытие начальных вариантов действует в MCP-представлении участника. Общий диск и доверенные локальные
  операторские HTTP API не являются границей изоляции агентов. Пользователь видит материалы сразу.
- Codex получает `read-only`; Claude — только Read/Grep/Glob и отключённые hooks; Qwen — список разрешённых
  нативных средств чтения. Это не обещание полной изоляции ОС и внешних инструментов.
- Плагины не добавляются автоматически и не расширяются в обсуждении. Их фактическая безопасность зависит
  от установленного extension и CLI. Полные транскрипты обсуждения скрываются в штатном runner.
- Специальное восстановление проверено перезагрузкой хранилища и повтором операций; аппаратный сбой во всех
  промежуточных точках записи не моделировался.
- В первой версии нет Brainstorm для OpenSpec/change-writing, динамического spawn/delegate, автоматических
  экспериментов или переоткрытия после IMPLEMENT.

# Скиллы и агенты для Java / Spring Boot

Набор для Claude Code: оркестратор разработки `java-dev-flow`, доменные скиллы `backend-design-java`, TDD, ревью, диагностика багов, агенты-ревьюеры и критик. Тестовый проект для проверки — [`orders-service/`](orders-service/).

## Что здесь

| Каталог | Имя скилла | Что делает | Нужен для |
|---|---|---|---|
| [`java-dev-flow/`](java-dev-flow/) | `java-dev-flow` | Оркестратор: тип и размер задачи (S/M/L), фазы от дизайна до отчёта | точка входа для любой задачи по коду |
| [`backend-design-java/`](backend-design-java/) | плагин: 14 скиллов, 6 агентов, 5 команд, 3 хука | Дисциплины Spring/JPA/PostgreSQL/Liquibase: миграции, транзакции, идемпотентность, безопасность | `java-dev-flow`, `critic`, `java-spec-review` |
| [`java-tdd/`](java-tdd/) | `java-tdd` | red → green → refactor, режимы A–D | фаза 4 `java-dev-flow` |
| [`java-diagnosing-bugs/`](java-diagnosing-bugs/) | `java-diagnosing-bugs` | Причина локального бага: воспроизведение, гипотезы, замеры | маршрут B `java-dev-flow` |
| [`review/`](review/) | `java-code-review` | Ревью diff: корректность, Spring/JPA, безопасность | агент `java-code-reviewer` |
| [`java-extensibility-review/`](java-extensibility-review/) | `java-extensibility-review` | Ветвления по типу и статусу, окупится ли паттерн | фазы 2 и 5 `java-dev-flow` |
| [`java-spec-review/`](java-spec-review/) | `java-spec-review` | Разбор OpenSpec change до кода | проекты с OpenSpec |
| [`jira-tasks/`](jira-tasks/) | `jira-tasks` | Задачи в Jira с подтверждением | нужен Atlassian MCP |
| [`mattpocock-skills/`](mattpocock-skills/) | `grilling`, `grill-me`, `handoff`, `retro`, `writing-for-agents`, `git-guardrails-claude-code` | Сторонние скиллы, подробности — в их [README](mattpocock-skills/README.md) | `grilling` — фаза 1 для L |
| [`vibe-skills/`](vibe-skills/) | `update-claude-md` | Сверка `CLAUDE.md` с кодом | — |

Агенты, которые лежат внутри скилла и ставятся отдельно:

| Файл | Агент | Что делает |
|---|---|---|
| [`java-dev-flow/assets/agents/java-code-reviewer.md`](java-dev-flow/assets/agents/java-code-reviewer.md) | `java-code-reviewer` | Независимое ревью diff и соответствие спеке, без правок |
| [`java-dev-flow/assets/agents/critic.md`](java-dev-flow/assets/agents/critic.md) | `critic` | Пре-мортем после задач M и L: что сломается в проде |

Скилл `test-audit` в этой папке не лежит. Его копия есть в `orders-service/.claude/skills/test-audit`, а ещё он приходит из claude.ai как `anthropic-skills:test-audit`.

`*.skill` — zip-архивы тех же каталогов для загрузки в claude.ai. Они могут отставать от каталогов: источник правды — каталог.

## Куда ставить

| Что | Для всех проектов | Только для одного проекта |
|---|---|---|
| Скилл (каталог с `SKILL.md`) | `~/.claude/skills/<имя>/` | `<проект>/.claude/skills/<имя>/` |
| Агент (`.md`-файл) | `~/.claude/agents/` | `<проект>/.claude/agents/` |
| Хуки | `~/.claude/settings.json` | `<проект>/.claude/settings.json` |

Правила:
- Копируй каталог скилла целиком: `SKILL.md` ссылается на `references/`, `scripts/`, `assets/` рядом с собой.
- Каталог называй так же, как поле `name` в `SKILL.md`. Исключение здесь одно: `review/` ставится как `java-code-review/`.
- Проектная копия важнее глобальной с тем же именем. Если в проекте лежит старая копия, работать будет она.
- Новый скилл или агент виден в уже открытой сессии через пару секунд. Исключение: папку `~/.claude/agents/` или `.claude/agents/` создали впервые — тогда нужна новая сессия.

## Установка для всех проектов

Команды запускай из этой папки (`~/Downloads/files`).

1. Каталоги для скиллов, агентов и хуков:

```bash
mkdir -p ~/.claude/skills ~/.claude/agents ~/.claude/hooks
```

2. Свои скиллы:

```bash
cp -R java-dev-flow java-tdd java-diagnosing-bugs java-extensibility-review java-spec-review jira-tasks ~/.claude/skills/
```

3. `java-code-review`. В каталоге `review/` файлы лежат плоско, а `SKILL.md` ждёт подкаталоги `references/` и `scripts/`. Поэтому ставь из архива, там структура правильная:

```bash
unzip -o review/java-code-review.skill -d ~/.claude/skills/
```

4. Сторонние скиллы. `grilling` нужен `java-dev-flow`, `grill-me` — ручной вход в него:

```bash
cp -R mattpocock-skills/grilling mattpocock-skills/grill-me mattpocock-skills/handoff ~/.claude/skills/
```

Остальные (`retro` вместе с `writing-for-agents`, `update-claude-md`, `git-guardrails-claude-code`) — по желанию, так же через `cp -R`.

5. Агенты:

```bash
cp java-dev-flow/assets/agents/java-code-reviewer.md java-dev-flow/assets/agents/critic.md ~/.claude/agents/
```

6. `backend-design-java` — см. следующий раздел.

7. Хук `critic-gate` — по желанию, см. ниже.

8. Начни новую сессию и проверь: попроси «перечисли доступные скиллы и агентов» или вызови `/java-dev-flow`.

## Плагин backend-design-java

В нём скиллы, агенты, команды (`/backend-design-java:audit` и другие) и хуки, которые проверяют миграции, Spring-компоненты и безопасность после каждой записи файла. Хукам нужен `python3` 3.8+.

**Вариант 1 — плагином (CLI).** Плагин подключается на одну сессию:

```bash
claude --plugin-dir ~/Downloads/files/backend-design-java
```

Проверить структуру:

```bash
claude plugin validate ~/Downloads/files/backend-design-java
```

**Вариант 2 — по частям, как в `orders-service`** (подходит и для десктопного приложения). Скиллы и агенты копируются, а хуки прописываются вручную, потому что `${CLAUDE_PLUGIN_ROOT}` вне плагина не работает.

```bash
cp -R backend-design-java/skills/* ~/.claude/skills/
```

```bash
cp backend-design-java/agents/*.md ~/.claude/agents/
```

```bash
mkdir -p ~/.claude/commands && cp backend-design-java/commands/*.md ~/.claude/commands/
```

```bash
mkdir -p ~/.claude/hooks/backend-design-java && cp backend-design-java/hooks/*.py ~/.claude/hooks/backend-design-java/
```

Затем добавь в `hooks` файла `~/.claude/settings.json`, не затирая то, что там уже есть:

```json
"PostToolUse": [
  {
    "matcher": "Write|Edit|MultiEdit",
    "hooks": [
      { "type": "command", "command": "python3 ~/.claude/hooks/backend-design-java/check_migration.py", "timeout": 10 },
      { "type": "command", "command": "python3 ~/.claude/hooks/backend-design-java/check_backend_component.py", "timeout": 10 },
      { "type": "command", "command": "python3 ~/.claude/hooks/backend-design-java/check_security.py", "timeout": 10 }
    ]
  }
]
```

Команды при такой установке вызываются без префикса: `/audit`, `/review-migration`.

**Конфликт с оригиналом.** Если включён плагин `backend-design` (из claude.ai он приходит синхронизированным), отключи его: у скиллов одинаковые имена, и сработают оба набора.

## Хук critic-gate

Напоминает запустить `critic`, если ход закончился задачей M или L, а критик не запускался. Два варианта, ставь один. Подробно — в [skill-map.md](java-dev-flow/references/skill-map.md), раздел «Хук critic-gate».

- **Промпт-хук (рекомендуется).** Лёгкая модель читает итоговое сообщение хода и решает сама. Перенеси объект из `hooks.Stop` файла [`critic-gate.prompt.json`](java-dev-flow/assets/hooks/critic-gate.prompt.json) в `hooks.Stop` своего `settings.json`. Стоит один короткий вызов модели на каждое завершение хода.
- **Скрипт.** Без модели, по реальным изменениям на диске:

```bash
cp java-dev-flow/assets/hooks/critic_gate.py ~/.claude/hooks/
```

и в `hooks.Stop`:

```json
{ "hooks": [{ "type": "command", "command": "python3 ~/.claude/hooks/critic_gate.py", "timeout": 30 }] }
```

## Установка в один проект

То же самое, но в `<проект>/.claude/skills/`, `<проект>/.claude/agents/` и `<проект>/.claude/settings.json`. Удобно, чтобы команда получила скиллы вместе с репозиторием. Пример — `orders-service/.claude/`.

В `CLAUDE.md` проекта стоит добавить точку входа, как в [orders-service/CLAUDE.md](orders-service/CLAUDE.md):

```markdown
Любую задачу по коду начинай со скилла `java-dev-flow`. Ревью для задач M и L — агенты `java-code-reviewer` и `critic`.
```

## claude.ai

Скилл можно загрузить в claude.ai архивом `.skill` (настройки → возможности → скиллы). Загруженные скиллы синхронизируются в Claude Code как `~/.claude/skills/synced/…` и становятся доступны во всех сессиях. Агенты и хуки так не переносятся — их ставь по инструкции выше.

Пересобрать архив после правок, например для `java-dev-flow`:

```bash
zip -r -X java-dev-flow.skill java-dev-flow -x '*.DS_Store' 'java-dev-flow/evals/*'
```

## Обновление

Копии не обновляются сами. После правки скилла в этой папке скопируй его заново туда, где он установлен, в том числе в `orders-service/.claude/`. Агенты и хуки `critic` дублируются в `java-dev-flow/assets/` — держи копии одинаковыми:

```bash
cmp ~/.claude/agents/critic.md java-dev-flow/assets/agents/critic.md
```

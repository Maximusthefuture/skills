# Скиллы и агенты для Java / Spring Boot

Набор для Claude Code: оркестратор разработки `java-dev-flow`, доменные скиллы `backend-design-java`, TDD, ревью, диагностика багов, агенты-ревьюеры и критик. Тестовый проект для проверки — [`orders-service/`](orders-service/).

**Язык.** С 2026-10-04 скиллы, агенты, хуки и OpenSpec-ассеты написаны по-английски: тот же текст занимает на 26–35% меньше токенов (замеры — [audit/2026-10-04-report.md](audit/2026-10-04-report.md)). Отвечает Claude на языке пользователя; триггер-фразы в описаниях скиллов — на русском и английском; шаблоны задач Jira остались русскими. README и отчёты — по-русски. Русская версия скиллов (с теми же исправлениями) — в архиве `audit/2026-10-04-ru-skills-snapshot.tar.gz`:

```bash
mkdir -p /tmp/ru-skills && tar -xzf audit/2026-10-04-ru-skills-snapshot.tar.gz -C /tmp/ru-skills
```

## Что здесь

| Каталог | Имя скилла | Что делает | Нужен для |
|---|---|---|---|
| [`java-dev-flow/`](java-dev-flow/) | `java-dev-flow` | Оркестратор: тип и размер задачи (S/M/L), фазы от дизайна до отчёта | точка входа для любой задачи по коду |
| [`backend-design-java/`](backend-design-java/) | плагин: 14 скиллов, 6 агентов, 5 команд, 3 хука | Дисциплины Spring/JPA/PostgreSQL/Liquibase: миграции, транзакции, идемпотентность, безопасность | `java-dev-flow`, `critic`, `java-spec-review` |
| [`java-tdd/`](java-tdd/) | `java-tdd` | red → green → refactor, режимы A–D | фаза 4 `java-dev-flow` |
| [`java-diagnosing-bugs/`](java-diagnosing-bugs/) | `java-diagnosing-bugs` | Причина локального бага: воспроизведение, гипотезы, замеры | маршрут B `java-dev-flow` |
| [`java-code-review/`](java-code-review/) | `java-code-review` | Ревью diff: корректность, Spring/JPA, безопасность | агент `java-code-reviewer` |
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
| [`java-dev-flow/assets/agents/test-runner.md`](java-dev-flow/assets/agents/test-runner.md) | `test-runner` | Прогон тестов со сводкой вместо логов (Haiku) |

У `java-code-reviewer` и `critic` стоит `model: sonnet`: на Haiku они пропускают связки между файлами и ошибаются в механике PostgreSQL (аудит 2026-10-03). Основную сессию с `java-dev-flow` тоже лучше вести на Sonnet или Opus.

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
- Каталог называй так же, как поле `name` в `SKILL.md`.
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
cp -R java-dev-flow java-tdd java-diagnosing-bugs java-code-review java-extensibility-review java-spec-review jira-tasks ~/.claude/skills/
```

3. Сторонние скиллы. `grilling` нужен `java-dev-flow`, `grill-me` — ручной вход в него:

```bash
cp -R mattpocock-skills/grilling mattpocock-skills/grill-me mattpocock-skills/handoff ~/.claude/skills/
```

Остальные (`retro` вместе с `writing-for-agents`, `update-claude-md`, `git-guardrails-claude-code`) — по желанию, так же через `cp -R`.

4. Агенты:

```bash
cp java-dev-flow/assets/agents/java-code-reviewer.md java-dev-flow/assets/agents/critic.md java-dev-flow/assets/agents/test-runner.md ~/.claude/agents/
```

5. `backend-design-java` — см. следующий раздел.

6. Хуки `java-dev-flow` (critic-gate, evidence-guard, tdd-guard) — см. ниже.

7. Бюджет листинга скиллов. На Haiku листинг из ~60 скиллов не влезает в бюджет по умолчанию (1% окна), и у всех своих скиллов модель видит только имя. В `~/.claude/settings.json`:

```json
"skillListingBudgetFraction": 0.05
```

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

**Конфликт с оригиналом.** Если включён плагин `backend-design` (из claude.ai он приходит синхронизированным как `backend-design@synced`), отключи его: у скиллов одинаковые имена, модель выбирает оригинал с примерами на Prisma и Python, а его PreToolUse-хуки падают на `python: command not found`. В `~/.claude/settings.json`:

```json
"enabledPlugins": { "backend-design@synced": false }
```

## Хуки java-dev-flow

Механические ворота для того, что модель забывает по тексту скилла. Все — `python3`, без модели (кроме промпт-варианта critic-gate), с юнит-тестами в `java-dev-flow/assets/hooks/tests/`. Подробно — [skill-map.md](java-dev-flow/references/skill-map.md), раздел «Хуки этого скилла».

| Хук | Событие | Что делает |
|---|---|---|
| `critic_gate.py` | Stop | изменение похоже на M или L по файлам на диске (видит и правки через Bash), а `critic` не запускался → просит запустить |
| `critic-gate.prompt.json` | Stop | то же по смыслу переписки: лёгкая модель решает, было ли это M или L. Один вызов Haiku на каждое завершение хода |
| `evidence_guard.py` | Stop | последний прогон тестов упал или не запустился (Docker), а отчёт молчит → просит назвать упавшие и незапущенные |
| `tdd_guard.py` | PostToolUse | правка `src/main/**` без показанного RED → напоминание |

Ставь их в `.claude/settings.json` Java-проекта, а не в пользовательский: иначе промпт-хук тратит вызов модели на каждом ходе во всех проектах.

```bash
cp java-dev-flow/assets/hooks/critic_gate.py java-dev-flow/assets/hooks/evidence_guard.py java-dev-flow/assets/hooks/tdd_guard.py ~/.claude/hooks/
```

Готовый `settings.json` проекта со всеми хуками (`backend-design-java` + эти четыре) и `skillOverrides` для лишних скиллов из claude.ai — [`java-dev-flow/assets/hooks/settings.example.json`](java-dev-flow/assets/hooks/settings.example.json). Пример установки — `orders-service/.claude/settings.json`.

Проверить хуки:

```bash
python3 -m unittest discover -s java-dev-flow/assets/hooks/tests
```

## Maven и Docker

Тесты `orders-service` идут на Testcontainers, поэтому нужен запущенный Docker Desktop. Maven в PATH не обязателен: в проекте есть wrapper `./mvnw`. Если нужен глобальный `mvn`, он лежит внутри IntelliJ IDEA:

```bash
"/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn" -v
```

Wrapper в новый проект добавляется той же командой: `"<путь к mvn>" -N wrapper:wrapper`.

## Установка в один проект

То же самое, но в `<проект>/.claude/skills/`, `<проект>/.claude/agents/` и `<проект>/.claude/settings.json`. Удобно, чтобы команда получила скиллы вместе с репозиторием. Пример — `orders-service/.claude/`.

В `CLAUDE.md` проекта стоит добавить точку входа, как в [orders-service/CLAUDE.md](orders-service/CLAUDE.md):

```markdown
Любую задачу по коду начинай со скилла `java-dev-flow`. Ревью для задач M и L — агенты `java-code-reviewer` и `critic`.
Ревью diff — скилл `java-code-review` или агент `java-code-reviewer`, не встроенный `/code-review`.
```

## claude.ai

Скилл можно загрузить в claude.ai архивом `.skill` (настройки → возможности → скиллы). Загруженные скиллы синхронизируются в Claude Code как `~/.claude/skills/synced/…` и становятся доступны во всех сессиях. Агенты и хуки так не переносятся — их ставь по инструкции выше.

Пересобрать архив после правок, например для `java-dev-flow`:

```bash
rm -f java-dev-flow.skill && zip -r -X java-dev-flow.skill java-dev-flow -x '*.DS_Store' 'java-dev-flow/evals/*' '*/__pycache__/*'
```

## Обновление

Копии не обновляются сами. После правки скилла в этой папке скопируй его заново туда, где он установлен, в том числе в `orders-service/.claude/`. Агенты и хуки `critic` дублируются в `java-dev-flow/assets/` — держи копии одинаковыми:

```bash
cmp ~/.claude/agents/critic.md java-dev-flow/assets/agents/critic.md
```

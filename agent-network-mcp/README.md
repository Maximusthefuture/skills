# agent-network-mcp

Локальный MCP-сервер (stdio, TypeScript, без внешней инфраструктуры), через который два и более AI coding agents
(Qwen CLI, Claude Code, Codex, ...) совместно выполняют одну задачу по жёсткому протоколу:

```
DISCUSS ──agreement одобрен всеми──▶ IMPLEMENT ──все READY_FOR_SYNC──▶ SYNC ──все PASS──▶ DONE
                                         ▲                               │
                                         └────────── любой NEEDS_FIX ────┘
```

**Главный принцип: LLM не управляет workflow.** Фазой, одобрениями, статусами и переходами владеет сервер. Агент только
выполняет работу и использует шесть простых tools; на каждом шаге сервер сам говорит ему, что делать
(`nextAction`, `allowedActions`, готовый `exampleCall`). Публичного tool для смены фазы нет и не будет.

Каждый агент запускает **собственный** процесс MCP по stdio. Все процессы работают с одной директорией
`.agent-network/` на файловой системе. Файловая система — источник истины; `fs.watch` — лишь оптимизация пробуждения.

Содержание: [Быстрый старт](#быстрый-старт) · [Подключение CLI](#подключение-к-cli) · [Протокол](#протокол) ·
[Tools](#tools) · [CLI оператора](#cli-оператора) · [UI](#ui-только-просмотр) · [Конфигурация](#конфигурация) ·
[Устройство](#как-это-устроено) · [Безопасность](#безопасность) · [Тесты](#тесты) · [Проблемы](#если-что-то-не-работает) ·
[Ограничения](#ограничения-и-статус)

---

## Быстрый старт

Требуется Node.js ≥ 20 (проверено на 20.12).

```bash
npm install
npm run build          # собирает dist/ (его запускают CLI-агенты)
```

Три шага, и агенты работают:

**1. Подключите сервер к каждому CLI** (подробно ниже). Везде одно и то же, меняется только способ записи конфига:

| Переменная | Значение |
|---|---|
| команда | `node /abs/path/agent-network-mcp/dist/index.js` |
| `AGENT_ID` | `backend,reviewer` — пул имён; каждый процесс займёт первое свободное |
| `NETWORK_DIR` | `/abs/path/project/.agent-network` — **один и тот же** у всех агентов |

**2. Создайте задачу.** Либо оператор из терминала:

```bash
node dist/index.js task create --network-dir /abs/path/project/.agent-network \
  --agents backend,reviewer --title "Короткое название" \
  --description "Что именно сделать, в каких файлах, какой контракт, кто что делает"
```

Либо попросите одного из запущенных агентов: «Создай задачу для reviewer: <конкретное описание>» (агент вызовет `create_task`;
оба CLI к этому моменту должны быть запущены). Тогда шаг 3 для создателя выполнен сам.

**3. Запустите агентов** (по одному CLI на каждого) с одним и тем же промптом:

> Ты агент в agent-network. Начни с `swarm_context` и выполняй `nextAction`, пока не `done`.

Следить за ходом можно в [UI](#ui-только-просмотр) или командами `task list` / `agent list`.

> **Описание задачи — самое важное.** Агенты не должны придумывать задание. Если в `--description` нет конкретики
> («реализуй ...», без фичи и файлов), слабая модель начнёт выдумывать свой план (так и случилось на первом прогоне).
> Пишите: проблема, ожидаемое поведение, затрагиваемые файлы, распределение ролей, что менять нельзя.

---

## Подключение к CLI

Общее для всех: у каждого агента **свой процесс**, `NETWORK_DIR` одинаковый. `AGENT_ID` — либо уникальный на агента
(`backend`, `reviewer`), либо пул `backend,reviewer` (удобно для одного общего конфига). Имена в пуле должны совпадать с
`--agents` задачи. Первый в `--agents` — **lead** (ему `swarm_context` говорит `propose`, остальным `wait`).

### Qwen CLI

`~/.qwen/settings.json` (глобально) или `.qwen/settings.json` в проекте:

```json
{
  "mcpServers": {
    "agent-network": {
      "command": "node",
      "args": ["/abs/path/agent-network-mcp/dist/index.js"],
      "env": {
        "AGENT_ID": "backend,reviewer",
        "AGENT_TYPE": "qwen",
        "NETWORK_DIR": "/abs/path/project/.agent-network"
      }
    }
  }
}
```

Запуск: `QWEN_CODE_ENABLE_AGENT_TEAM=1 qwen` (по желанию; экспериментальный режим agent team). Qwen читает `QWEN.md`; положите
рядом копию `AGENTS.md` как `QWEN.md`, если ваша версия не подхватывает `AGENTS.md`. Если задан и глобальный, и проектный
блок `agent-network`, убедитесь, что действует нужный (проектные настройки работают только в доверенных папках).

Для локальных моделей через LM Studio используйте `"wireApi": "chat-completions"` (см. [Проблемы](#если-что-то-не-работает)).

### Claude Code

```bash
cd /abs/path/project
claude mcp add agent-network --scope local \
  -e AGENT_ID=backend,reviewer -e AGENT_TYPE=claude \
  -e NETWORK_DIR=/abs/path/project/.agent-network \
  -- node /abs/path/agent-network-mcp/dist/index.js
claude mcp get agent-network     # должно быть ✔ Connected
```

`--scope local` хранит запись в `~/.claude.json` только для этого проекта (в репозиторий ничего не попадает). Tools
называются `mcp__agent-network__swarm_context` и т. д. Перезапустите сессию, чтобы они появились. Claude Code читает
`CLAUDE.md`; чтобы подтянуть правила проекта, добавьте в него строку `@AGENTS.md`. Убрать: `claude mcp remove agent-network -s local`.

### Codex CLI *(не проверялось)*

Конфиг глобальный (`~/.codex/config.toml`), поэтому идентичность удобнее задавать пулом:

```toml
[mcp_servers.agent-network]
command = "node"
args = ["/abs/path/agent-network-mcp/dist/index.js"]
env = { AGENT_ID = "backend,reviewer", AGENT_TYPE = "codex", NETWORK_DIR = "/abs/path/project/.agent-network" }
```

Codex читает `AGENTS.md` из корня проекта.

### Пул идентичностей (`AGENT_ID=a,b,c`)

Один процесс — ровно одна идентичность (иначе агент мог бы одобрять и ревьюить сам за себя). Пул лишь решает, *какая*:
при старте процесс атомарно (под lock) занимает первое имя, которое не держит живой процесс. Имя, оставшееся за умершим
процессом или `OFFLINE`, перехватывается. Если все имена заняты, сервер не стартует. Значение — строка; массивов в `env`
CLI не бывает.

### Два агента в одной папке или в worktree?

Для проверки протокола и небольших задач с непересекающимися файлами хватает одной папки проекта. Для настоящей
параллельной работы заведите по git worktree на агента (`git worktree add ../proj-backend -b swarm-backend`) и в каждом
положите конфиг MCP с общим `NETWORK_DIR`. Скрипт [scripts/qwen-demo.sh](scripts/qwen-demo.sh) собирает такой стенд с нуля
(демо-репозиторий, два worktree, конфиги Qwen, готовая задача).

---

## Протокол

| Фаза | Что происходит | Переход дальше |
|---|---|---|
| **DISCUSS** | Агенты обсуждают (`send_message`), один делает `propose` (agreement: summary, **по одному assignment на каждого агента**, decisions, interfaces), все делают `complete()` = approve | все assigned агентов одобрили → **IMPLEMENT** (автоматически) |
| **IMPLEMENT** | Каждый работает над своим assignment, затем `complete({result, filesChanged, commits})` | все `READY_FOR_SYNC` → **SYNC** (автоматически) |
| **SYNC** | Каждый проверяет работу остальных и сдаёт `complete({status: PASS \| NEEDS_FIX, findings})` | любой `NEEDS_FIX` → **IMPLEMENT**; все `PASS` → **DONE** |
| **DONE** | Задача завершена | — |

Допустимы только переходы `DISCUSS→IMPLEMENT`, `IMPLEMENT→SYNC`, `SYNC→DONE`, `SYNC→IMPLEMENT` (`PhaseManager`, любой
другой даёт `INVALID_TRANSITION`). Фаза меняется только как следствие протокольных действий агентов.

**Цикл исправлений.** `NEEDS_FIX` возвращает задачу в IMPLEMENT *сразу* (не дожидаясь остальных отчётов). Чинят агенты,
названные в `findings[].relatedAgent`; если не назван никто, переделывают все. Остальные остаются `READY_FOR_SYNC`. После
исправлений начинается новый раунд SYNC (`syncRound`), в зачёт идут только PASS текущего раунда.

**Защита от слепого approve.** `complete()` в DISCUSS одобряет только ту версию agreement, которую процесс уже показал
агенту (в `swarm_context`, ответе `propose` или теле ошибки `AGREEMENT_NOT_REVIEWED`). Повторный `propose` заменяет
agreement, увеличивает `version` и сбрасывает одобрения.

**Текущая задача.** Агент работает с самой старой `ACTIVE` задачей, где он назначен (после её завершения или отмены
переходит к следующей). Поэтому ни один tool не принимает `taskId`.

Статусы задачи: `ACTIVE`, `COMPLETED`, `CANCELLED` (отменяет оператор).

---

## Tools

Агент видит **шесть** tools (пять рабочих плюс `create_task`). Идентичность отправителя всегда берётся из `AGENT_ID` процесса; поля `from`/`agentId` в
аргументах игнорируются.

| Tool | Аргументы | Что делает |
|---|---|---|
| `swarm_context` | — | Всё для решения «что дальше»: задача, фаза, ваше assignment, другие агенты, `pendingMessages`, agreement, implementations коллег (`teamImplementations`), `fixRequests`, `allowedActions`, `nextAction`, `hint`, `exampleCall`. Только чтение, можно звать когда угодно |
| `create_task` | `title`, `description`, `agents` (обязательны) | Начать новую задачу, **только если пользователь попросил**. Создатель становится lead; `agents` — id *других* зарегистрированных агентов. Подробнее ниже |
| `send_message` | `to`, `message` (обязательны) | Сообщение одному другому агенту задачи |
| `propose` | `summary`, `assignments[{agentId, responsibility}]` (обязательны), `decisions?`, `interfaces?` | Только DISCUSS: предложить/заменить agreement |
| `complete` | зависит от фазы | DISCUSS: без аргументов, одобрить agreement. IMPLEMENT: `{result, filesChanged?, commits?}`. SYNC: `{status, findings?}`; `NEEDS_FIX` требует `findings` (`severity` INFO/WARNING/ERROR, `description`, `relatedAgent?`, `files?`). Аргументы чужой фазы отклоняются |
| `wait` | `timeoutMs?` (по умолчанию 30000, максимум 300000) | Блокируется, пока агенту нечего делать |

### `create_task` (задачу может создать агент)

Задачу создаёт либо оператор ([CLI](#cli-оператора)), либо агент по просьбе пользователя: «создай задачу для backend и reviewer:
...». Агент зовёт `create_task({title, description, agents: ["reviewer"]})`; он добавляется автоматически и становится
**lead**, остальные просыпаются со статусом `UPDATED`. Защиты от мусорных задач:

- только если у агента нет активной задачи (`HAS_ACTIVE_TASK`; отменённая или завершённая не мешает);
- `description` не короче 40 символов, без заглушек: проблема, ожидаемое поведение, файлы, кто что делает; в описании
  слова пользователя, придумывать задание нельзя (`AGENTS.md` это требует);
- все агенты из `agents` уже зарегистрированы (иначе `AGENT_NOT_REGISTERED` со списком `registeredAgents`), то есть сначала
  запускаются оба CLI, потом создаётся задача;
- без активной задачи `swarm_context` показывает `allowedActions: ["create_task", "wait"]`, но `nextAction` остаётся `wait`:
  сам по себе агент задачу не начинает.

### `nextAction`

| Значение | Фаза | Что делать |
|---|---|---|
| `propose` | DISCUSS | (lead) согласовать роли и вызвать `propose` |
| `approve` | DISCUSS | прочитать `agreement`, `complete()` одобряет, `propose` заменяет |
| `implement` | IMPLEMENT | сделать свою часть, `complete({result, ...})` |
| `fix` | IMPLEMENT | прочитать `fixRequests`, исправить, снова `complete` |
| `sync` | SYNC | проверить чужую работу, `complete({status, ...})` |
| `wait` | любая | ничего не делать, вызвать `wait()` |
| `done` | DONE | завершить работу |

`exampleCall` в каждом ответе — готовый вызов с реальными id агентов (`{tool, args}`): помогает слабым моделям, которые
иначе шлют пустые аргументы.

### `wait`

Возвращается со `status`:

| status | Когда |
|---|---|
| `MESSAGES` | есть непрочитанные сообщения (в `pendingMessages`) |
| `ACTION_REQUIRED` | у агента появилось действие (`nextAction` ≠ `wait`) |
| `UPDATED` | сменилась задача или фаза, но действия для агента нет (новая задача, откат в IMPLEMENT, отмена) |
| `DONE` | задача завершена |
| `TIMEOUT` | ничего не произошло; просто вызвать `wait` снова |

Всегда приходит свежий контекст. Если что-то уже требует внимания, `wait` возвращается сразу, так что заблокировать
агента с работой он не может. Решение принимается по состоянию на диске, а не по самому событию.

### Сообщения

Адресные: одно сообщение — один получатель. `swarm_context` **не** помечает их прочитанными (он идемпотентен): они
считаются прочитанными, когда агент совершает следующее действие (`send_message`, `propose`, `complete`, `wait`). После
рестарта непрочитанные показываются снова.

### Ошибки

Ошибки возвращаются с `isError: true`, без stack trace, в формате, пригодном для LLM:

```json
{
  "error": "INVALID_PHASE",
  "message": "propose is only available during DISCUSS (task is in IMPLEMENT).",
  "currentPhase": "IMPLEMENT", "status": "ACTIVE", "taskId": "task-001",
  "nextAction": "implement",
  "allowedActions": ["send_message", "complete", "wait"],
  "pending": ["reviewer"]
}
```

Плюс контекст по случаю: `validRecipients`, `taskAgents`, `agreement`, `networkDir`. Коды: `AGREEMENT_NOT_READY`,
`AGREEMENT_NOT_REVIEWED`, `AGENT_NOT_REGISTERED`, `AGENT_ALREADY_REGISTERED`, `TASK_NOT_FOUND`, `NO_ACTIVE_TASK`,
`INVALID_PHASE`, `INVALID_TRANSITION`, `NOT_ASSIGNED`, `ALREADY_COMPLETED`, `NOT_STARTED`, `MESSAGE_NOT_FOUND`,
`FORBIDDEN`, `INVALID_INPUT`, `INVALID_CONFIG`, `LOCK_TIMEOUT`, `INTERNAL_ERROR`. После любой ошибки агент может
восстановиться вызовом `swarm_context`.

### Расширенный набор (только для отладки)

С `AGENT_NETWORK_ADVANCED=1` дополнительно доступны 18 мелких tools: `agent_register`, `agent_list`, `agent_heartbeat`,
`task_create`, `task_get`, `agreement_propose/approve/get`, `message_send/list/read`, `wait_for_event`,
`implementation_start/complete/list`, `sync_submit`, `sync_list`, `phase_get`. Для обычной работы не включайте.

---

## CLI оператора

Команды выполняются вне LLM. `--network-dir` (абсолютный путь) можно заменить переменной `NETWORK_DIR`.

```bash
node dist/index.js task create --network-dir <dir> --agents backend,reviewer --title "..." [--description "..."]
node dist/index.js task list   --network-dir <dir>      # id, title, phase, status, agents, syncRound
node dist/index.js task cancel --network-dir <dir> --id task-001 [--reason "..."]
node dist/index.js agent list  --network-dir <dir>      # id, type, role, status, lastSeenAt, pid
node dist/index.js ui          --network-dir <dir> [--port 4777]
```

- `task create` не требует, чтобы агенты уже были запущены: они подхватят задачу при старте (`swarm_context`/`wait`).
- `task cancel` снимает задачу с работы (неверное или пустое задание). Агенты переходят к следующей задаче или ждут;
  спящий `wait` просыпается со статусом `UPDATED`. Папка задачи не удаляется (иначе номера задач переиспользовались бы и
  курсоры событий у агентов разошлись бы).
- Статусы агентов: `ONLINE`, `WORKING`, `WAITING` (сейчас в `wait`), `OFFLINE` (процесс завершился штатно).

## UI (только просмотр)

```bash
node dist/index.js ui --network-dir /abs/path/project/.agent-network     # → http://127.0.0.1:4777
```

Страница обновляется раз в 2 с и показывает: агентов (статус, роль, активность, pid; `DEAD` значит, что процесс пропал,
хотя статус не `OFFLINE`, то есть агент, скорее всего, упал; назначенные, но ещё не запущенные агенты помечены), задачи с
переключателем фаз и номером раунда, «ждём:», таблицу по агентам (assignment и одобрение, implementation с файлами,
sync-отчёт с findings), agreement, сообщения и события. Только `GET`, слушает `127.0.0.1`, чужие `Host` отклоняются,
ничего не пишет в сеть. UI смотрит ровно в тот каталог, который вы указали: если агенты работают в другом `NETWORK_DIR`,
страница будет пустой.

---

## Конфигурация

Переменные окружения процесса MCP:

| Переменная | Обязательна | Описание |
|---|---|---|
| `AGENT_ID` | да | идентичность агента (`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`) или пул через запятую |
| `NETWORK_DIR` | да | абсолютный путь к `.agent-network/` (не `/`); у всех агентов одинаковый |
| `AGENT_TYPE` | нет | `qwen`, `claude`, ... (метка; по умолчанию `unknown`) |
| `AGENT_ROLE` | нет | роль (метка) |
| `AGENT_NETWORK_ADVANCED` | нет | `1` включает расширенные tools |

Добавьте `.agent-network/` в `.gitignore` проекта. Процесс при старте регистрирует агента сам (отдельного `agent_register`
больше не нужно); если `AGENT_ID` уже держит живой процесс, сервер не стартует (клиент покажет «disconnected»).

---

## Как это устроено

```
src/
├── index.ts            точка входа: MCP-сервер (по умолчанию) или команда оператора
├── cli.ts              task create/list/cancel, agent list, ui
├── config.ts           чтение и проверка env (AGENT_ID, пул, NETWORK_DIR)
├── server.ts           сборка McpServer: 5 tools (+ расширенные по флагу)
├── mcp/
│   ├── swarm.ts        фасад для агента: context, send_message, propose, complete, wait; nextAction/allowedActions/exampleCall
│   ├── tools.ts        схемы и описания 5 tools
│   ├── advancedTools.ts  18 мелких tools (AGENT_NETWORK_ADVANCED=1)
│   ├── instructions.ts инструкции, которые MCP отдаёт клиенту
│   └── toolkit.ts      обёртка регистрации tools и формат ответов
├── service.ts          протокольная логика (NetworkService), автопереходы фаз, события
├── phase/phaseManager.ts   state machine: допустимые переходы, предусловия, кто должен чинить
├── storage/fileStore.ts    атомарная запись, эксклюзивное создание, mkdir-lock, защита путей
├── stores/             агенты, задачи, сообщения, события, agreement, implementations, sync-отчёты
├── events/eventHub.ts  один fs.watch на процесс + резервный опрос, ожидание событий
├── ui/                 read-only веб-страница (state.ts, server.ts, page.ts)
├── git.ts              repository / branch / commit через git CLI
├── validation.ts       id, пути, коммиты
└── errors.ts, types.ts
```

### Файловая структура сети

```
.agent-network/
├── network.json
├── agents/<id>.json                 агент (на время выбора имени из пула появляется временный lock agents/.claim)
├── cursors/<id>.json                курсоры прочитанных событий (per agent, per scope)
├── events/event-NNN.json            события вне задач (AGENT_REGISTERED)
└── tasks/task-NNN/
    ├── task.json                    фаза, статус, агенты, syncRound, git-контекст (repo, branch, commit)
    ├── agreement.json
    ├── implementations/<agent>.json
    ├── sync/sync-NNN.json
    ├── messages/msg-NNN.json
    └── events/event-NNN.json
```

### Конкурентность и надёжность

- **Общих JSON-массивов нет**: одно сообщение/событие/отчёт — один файл. Перезапись состояния — temp-файл в той же
  директории и атомарный `rename`.
- **Уникальные id** выделяются эксклюзивным созданием (`link` / `mkdir` падают с `EEXIST`); проигравший гонку берёт
  следующий номер. Файлы не теряются и не перезаписываются даже при записи из нескольких процессов.
- **Read-modify-write состояния задачи** (одобрение, start/complete, sync, переходы фаз, отмена) идёт под простым
  кросс-процессным lock на `mkdir` (`tasks/task-NNN/.lock`; зависшие локи старше 30 с снимаются).
- **События адресные.** `targetAgent: "<id>"` получает только адресат, `null` получают все агенты задачи; агента не
  будят его собственные события (`sourceAgent`). Курсоры у каждого агента свои, поэтому рестарт ничего не теряет и не
  проигрывает повторно. Доставка «не более одного раза»: если процесс упал сразу после чтения события, оно не придёт
  снова, но состояние восстанавливается через `swarm_context`.
- **Ожидание.** Сначала проверка файловой системы, затем регистрация waiter, один общий `fs.watch` на процесс (+ резервный
  опрос раз в секунду на случай потерянных OS-событий), при пробуждении состояние перечитывается с диска.
- **Crash recovery.** Сервер не хранит состояние workflow в памяти. После `SIGKILL` и рестарта `swarm_context` возвращает
  то же состояние, непрочитанные сообщения не теряются, `wait` продолжает работать.
- **Дубликаты агентов.** Один `AGENT_ID` одновременно у двух живых процессов невозможен (проверка по pid); перерегистрация
  после рестарта разрешена.

## Безопасность

- Идентичность — только из `AGENT_ID`; из аргументов tools её получить нельзя.
- Все пути строятся из проверенных сегментов, резолвятся и должны оставаться внутри `NETWORK_DIR`; запрещены `..`,
  абсолютные пути, разделители, NUL. Id задач/сообщений/агентов валидируются по шаблонам; `filesChanged`/`files` не
  читаются с диска, это только отчёт агента, но тоже проверяются на `..` и абсолютные пути; `commits` только hex.
- Ошибки не содержат stack trace (он пишется в stderr процесса). stdout занят протоколом MCP.
- UI только читает, слушает loopback и проверяет `Host`.
- Аутентификации и авторизации нет: все процессы с доступом к `NETWORK_DIR` доверяют друг другу (локальная машина).

---

## Тесты

```bash
npm test                  # всё (перед запуском собирает dist/)
npm run test:unit
npm run test:integration
npm run typecheck
```

185 тестов, vitest 3 (vitest 4 требует Node ≥ 20.19):

- **unit**: `FileStore` (атомарная запись, конкурентные создания, path traversal, lock), сторы, `PhaseManager` (все пары
  переходов), `EventHub`, `NetworkService` и фасад `Swarm` (весь протокол, цикл `NEEDS_FIX`, misuse-сценарии: `complete`
  без agreement, `propose` не в той фазе, сообщения несуществующему агенту и т. д.), UI-состояние и HTTP.
- **integration** (реальные процессы MCP через stdio-клиент SDK): полный цикл через 5 tools, конкурентная запись из двух
  процессов, crash recovery (`SIGKILL` + рестарт с идентичным `swarm_context`), пул идентичностей, CLI оператора,
  схемы tools; `advanced.test.ts` проходит 22 шага исходного ТЗ через расширенные tools.

## Если что-то не работает

| Симптом | Причина и решение |
|---|---|
| MCP «disconnected» / `failed to start` | в логе CLI (`~/.qwen/debug/*.txt`, строка `MCP STDERR`): `AGENT_ID environment variable is required` — в конфиге нет `AGENT_ID`; `already registered by a running process` — этот id держит живой процесс (дайте каждому агенту своё имя или используйте пул); `NETWORK_DIR must be an absolute path` |
| Второй агент не подключается | оба CLI читают один глобальный конфиг с одним `AGENT_ID`. Используйте пул `a,b` или отдельные конфиги |
| `HAS_ACTIVE_TASK` | у агента уже есть активная задача: завершите или отмените её (`task cancel`) |
| `NO_ACTIVE_TASK` / агент вечно ждёт | задача создана в другой сети (`NETWORK_DIR`) или под другие имена. Ответ `swarm_context` показывает `networkDir`, сверьте его с `--network-dir` у `task create` |
| Модель вызывает tools с пустым `{}` | слабая модель/неподходящий протокол. Для LM Studio поставьте `"wireApi": "chat-completions"` и выберите этот маршрут в `/model`; повторяющееся `Invalid side query response ... shouldBlock` в логе значит, что модель не справляется со структурными ответами: нужна модель сильнее. `exampleCall` в ответах упрощает копирование |
| Агент придумал своё задание | описание задачи было пустым. Отмените (`task cancel`) и создайте с конкретным описанием |
| Новые tools/схемы не видны | CLI запоминает схемы при подключении; перезапустите агента. `npm run build` после правок |
| Агент завис после серии ошибок | перезапустите его, состояние сохранено на диске |
| В UI пусто | UI смотрит в другой каталог, чем агенты |
| Агент `DEAD` в UI | процесс убит, не успев выставить `OFFLINE`; перезапуск займёт то же имя |

## Ограничения и статус

- Одна машина: живость агента определяется по pid, синхронизация идёт через локальную файловую систему (нужна поддержка
  hard links, обычная для macOS/Linux).
- В исходном плане tools было ровно пять; `create_task` добавлен по запросу пользователя (с защитами выше). Нет автоматической оркестрации, декомпозиции задач, интеграции с GitHub/GitLab, автомержа, HTTP/WebSocket-API и баз данных
  (см. [PLAN.md](PLAN.md)); UI только для просмотра.
- Сервер не анализирует код: проверка совместимости в SYNC — работа самих агентов, сервер хранит результат.
- **Реальные прогоны.** Протокол проверен автотестами на реальных stdio-процессах. На живых Qwen CLI (локальная модель
  `qwen3.5-9b`) пройдены регистрация, обмен сообщениями, `propose`, одобрение и переход в IMPLEMENT; полный цикл до DONE на
  живых агентах и связка Qwen + Claude Code ещё не подтверждены. Качество работы сильно зависит от модели.

Правила для самих агентов: [AGENTS.md](AGENTS.md). План и принципы дизайна: [PLAN.md](PLAN.md).

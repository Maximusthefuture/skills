# agent-network-mcp

Локальный MCP-сервер (stdio, TypeScript, без внешней инфраструктуры), через который два и более AI coding agents
(Qwen CLI, Claude Code, Codex, ...) совместно выполняют одну задачу по жёсткому протоколу:

```
DISCUSS ──agreement одобрен всеми──▶ IMPLEMENT ──все READY_FOR_SYNC──▶ SYNC ──все PASS──▶ INTEGRATE ──PASS──▶ DONE
                                         ▲                               │                   │
                                         ├───── NEEDS_FIX (ERROR) ───────┘                   │
                                         └───── NEEDS_FIX (сборка/тесты/конфликт) ───────────┘
              после maxFixRounds неудачных раундов задача BLOCKED → оператор: task unblock / task cancel
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
  --description "Что именно сделать, в каких файлах, какой контракт, кто что делает" \
  --verify "mvn -q verify"          # необязательно: чем lead проверяет слитый результат
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

#### Хуки: сообщения доходят до занятого агента

Без хуков агент видит сообщения только в `wait()` и в ответах tools agent-network. Пока он в IMPLEMENT пишет код
(Edit, Bash), `FILE_REQUEST` соседа лежит непрочитанным до его `complete`, а сосед всё это время ждёт. Команда
`agent-network-mcp hook` закрывает это двумя хуками Claude Code:

| Хук | Что делает |
|---|---|
| `PostToolUse` (`hook post-tool`) | после любого tool (кроме tools agent-network) проверяет непрочитанные сообщения этому агенту; о новых добавляет в контекст короткую сводку: от кого, тип, начало текста, файлы; `FILE_REQUEST`, `BLOCKER`, `FIX_REQUEST` помечены «X is waiting for you». Об одном сообщении говорит один раз |
| `Stop` (`hook stop`) | пока у агента есть активная задача (`ACTIVE`, не DONE), один раз не даёт закончить ход: «вызови `wait()` и продолжай цикл». Повторная остановка (`stop_hook_active`) проходит, поэтому агент, который ждёт ответа пользователя, не застревает |

Хук только читает сеть: прочитанными сообщения помечает сервер, когда агент вызывает `swarm_context` или `wait`. Свою
память о том, что уже показано, хук держит в `.agent-network/hooks/<agent>.json`. Любая ошибка — тишина и exit 0.

Агента хук находит сам: его MCP-сервер — прямой потомок того же процесса `claude`, что и хук (`pid` из
`agents/<id>.json` + дерево `ps`). Это работает и с пулом `AGENT_ID=a,b`. Если сервер запущен через обёртку (`npx`, `sh -c`)
или нет `ps` (Windows), передайте `--agent <id>`. Сессия без agent-network в соседнем терминале чужого агента не находит.

Готовые настройки — [examples/claude-hooks/settings.json](examples/claude-hooks/settings.json); вместе с хуками
`java-dev-flow` — [settings.with-java-dev-flow.json](examples/claude-hooks/settings.with-java-dev-flow.json). Положите
содержимое в `.claude/settings.local.json` проекта (или каждого worktree), замените `/abs/path/...`. `--network-dir` —
тот же каталог, что `NETWORK_DIR` у MCP; без флага берётся переменная `NETWORK_DIR` окружения `claude`. Хуки
подхватываются при старте сессии, проверить — `/hooks`. Задержка: до следующего вызова tool, обычно секунды. Сессию,
которая уже закончила ход и простаивает, хук не будит: этого не допускает Stop-хук.

### Codex CLI *(не проверялось)*

У Codex таймаут вызова tool по умолчанию 60 с, а `wait` по умолчанию ждёт 120 с: добавьте в `env`
`AGENT_NETWORK_WAIT_MS = "50000"`.

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

Для проверки протокола и небольших задач с непересекающимися файлами хватает одной папки проекта (но параллельные
сборки в одной папке мешают друг другу: общий `target/`, `node_modules/.cache`). Для настоящей параллельной работы
заведите по git worktree на агента (`git worktree add ../proj-backend -b swarm-backend`) и в каждом положите конфиг MCP
с общим `NETWORK_DIR`. Worktree одного репозитория делят базу объектов, поэтому коммит из любого worktree виден серверу
и остальным агентам по хэшу; ветки агентов в конце сливает lead (фаза INTEGRATE). Скрипт [scripts/qwen-demo.sh](scripts/qwen-demo.sh) собирает такой стенд с нуля
(демо-репозиторий, два worktree, конфиги Qwen, готовая задача).

---

## Протокол

| Фаза | Что происходит | Переход дальше |
|---|---|---|
| **DISCUSS** | Агенты обсуждают (`send_message`), один делает `propose` (agreement: summary, **по одному assignment на каждого агента**, decisions, interfaces), все делают `complete()` = approve | все assigned агентов одобрили → **IMPLEMENT** (автоматически) |
| **IMPLEMENT** | Каждый работает над своим assignment, коммитит свои файлы, затем `complete({result, filesChanged, commits})` | все `READY_FOR_SYNC` → **SYNC** (автоматически) |
| **SYNC** | Ревьюеры проверяют чужую работу (`reviewTargets`) и сдают `complete({status: PASS \| NEEDS_FIX, findings})` | когда отчитались **все** ревьюеры раунда: хоть один `NEEDS_FIX` → **IMPLEMENT**, иначе → **INTEGRATE** |
| **INTEGRATE** | Lead (первый в `--agents`) сливает коммиты всех, запускает сборку и все тесты (`verifyCommand`), сдаёт `complete({status, result, commits, findings?})` | `PASS` → **DONE**; `NEEDS_FIX` → **IMPLEMENT** |
| **DONE** | Задача завершена | — |

Допустимы только переходы `DISCUSS→IMPLEMENT`, `IMPLEMENT→SYNC`, `SYNC→INTEGRATE`, `SYNC→IMPLEMENT`, `INTEGRATE→DONE`,
`INTEGRATE→IMPLEMENT` (`PhaseManager`, любой другой даёт `INVALID_TRANSITION`). Фаза меняется только как следствие
протокольных действий агентов.

**Раунд ревью собирается целиком.** `NEEDS_FIX` не прерывает раунд: задача ждёт отчётов всех ревьюеров и только потом
уходит в IMPLEMENT. Так ничья проверка не пропадает, а исправляющий получает все замечания сразу (`fixRequests`).

**`NEEDS_FIX` только для ERROR.** `NEEDS_FIX` требует хотя бы одного finding с `severity: ERROR` (дефект или нарушение
agreement); `WARNING`/`INFO` сдаются вместе с `PASS` как заметки. `PASS` с ERROR-находкой отклоняется. Чинят агенты,
названные в `relatedAgent` ERROR-находок; если не назван никто, переделывают все. Остальные остаются `READY_FOR_SYNC`.

**Повторное ревью только исправленного.** После исправлений начинается новый раунд SYNC (`syncRound`), но проверяется только
работа исправлявших (`reviewScope`): ревьюерами становятся все остальные, исправлявший ждёт. С двумя агентами это одно ревью
вместо двух, с тремя — два вместо шести. Если исправляли все, все ревьюят всех.

**Интеграция.** Без неё в конце остались бы неслитые ветки, а общую сборку никто бы не запускал. Lead сливает ветки (или, в
одной папке, просто берёт HEAD), запускает `verifyCommand` (или сборку и тесты проекта) и сообщает результат. Конфликт или
красные тесты — `NEEDS_FIX` с ERROR-находкой на виновника; после исправления — ревью исправленного и снова интеграция.

**Лимит раундов.** У задачи `maxFixRounds` (по умолчанию 3, `task create --max-fix-rounds N`): сколько раз ревью или
интеграция могут вернуть её в IMPLEMENT. Если `NEEDS_FIX` приходит, когда раунды исчерпаны, задача не зацикливается, а
получает статус `BLOCKED` (`blockedReason`), агентам говорят ждать. Оператор решает: `task unblock --id ... [--rounds N]`
(добавляет раунды, отложенное исправление стартует сразу) или `task cancel`.

**Защита от слепого approve.** `complete()` в DISCUSS одобряет только ту версию agreement, которую процесс уже показал
агенту (в `swarm_context`, ответе `propose` или теле ошибки `AGREEMENT_NOT_REVIEWED`). Повторный `propose` заменяет
agreement, увеличивает `version` и сбрасывает одобрения.

**Текущая задача.** Агент работает с самой старой `ACTIVE` задачей, где он назначен (после её завершения или отмены
переходит к следующей). Поэтому ни один tool не принимает `taskId`.

Статусы задачи: `ACTIVE`, `BLOCKED` (исчерпан лимит раундов, ждёт оператора), `COMPLETED`, `CANCELLED` (отменяет оператор).
Заблокированная задача остаётся текущей для своих агентов, пока оператор её не разблокирует или не отменит.

### Коммиты

Если `NETWORK_DIR` лежит в git-репозитории с хотя бы одним коммитом, задача требует коммитов (`requireCommits`; выключается
`task create --no-commits`). Коммиты — единственный способ увидеть работу агента из другого worktree.

- `complete` в IMPLEMENT без `commits` отклоняется. Каждый коммит проверяется через `git`: существует и сделан поверх
  базового коммита задачи (`task.git.commit`), то есть для этой задачи.
- Файлы, затронутые коммитами, считаются изменёнными, что бы агент ни перечислил в `filesChanged`. Проверка владения
  идёт по ним: незаявленная правка чужого файла в коммите даёт `FILE_NOT_OWNED`. Файлы из `filesChanged`, которых нет в
  коммитах, дают предупреждение «не закоммичено».
- `complete({status: "PASS"})` в INTEGRATE требует `commits` с HEAD слитого результата.
- Вне git-репозитория (или с `--no-commits`) коммиты необязательны и не проверяются.

---

## Tools

Агент видит **шесть** tools (пять рабочих плюс `create_task`). Идентичность отправителя всегда берётся из `AGENT_ID` процесса; поля `from`/`agentId` в
аргументах игнорируются.

| Tool | Аргументы | Что делает |
|---|---|---|
| `swarm_context` | — | Всё для решения «что дальше»: задача (с `lead`, `maxFixRounds`, `verifyCommand`, `blockedReason`), фаза, ваше assignment, другие агенты, `pendingMessages`, agreement, implementations коллег (`teamImplementations`), в SYNC `reviewTargets`, `integration`, `fixRequests`, `allowedActions`, `nextAction`, `hint`, `exampleCall`. Только чтение, можно звать когда угодно |
| `create_task` | `title`, `description`, `agents` (обязательны), `verifyCommand?` | Начать новую задачу, **только если пользователь попросил**. Создатель становится lead; `agents` — id *других* зарегистрированных агентов. Подробнее ниже |
| `send_message` | `to`, `message` (обязательны), `requestFiles?`, `grantFiles?` | Сообщение одному другому агенту задачи; через `requestFiles`/`grantFiles` ведутся переговоры о чужих файлах |
| `propose` | `summary`, `assignments[{agentId, responsibility, files}]` (обязательны), `decisions?`, `interfaces?` | Только DISCUSS: предложить/заменить agreement. У каждого агента заявлены **файлы** (пути или маски), заявки не должны пересекаться |
| `complete` | зависит от фазы | DISCUSS: без аргументов, одобрить agreement. IMPLEMENT: `{result, filesChanged?, commits}` (в git-проекте коммиты обязательны). SYNC: `{status, findings?}`; `NEEDS_FIX` требует finding с `severity: ERROR` (`description`, `relatedAgent?`, `files?`). INTEGRATE (только lead): `{status, result, commits, findings?}`. Аргументы чужой фазы отклоняются |
| `wait` | `timeoutMs?` (по умолчанию 120000 или `AGENT_NETWORK_WAIT_MS`, максимум 300000) | Блокируется, пока агенту нечего делать |

### Файлы: кто что меняет

Чтобы агенты не затирали друг другу правки, в DISCUSS они сообщают друг другу, какие файлы будут менять, и закрепляют это в agreement:

1. В `propose` у **каждого** агента обязательно поле `files` (пути или маски: `src/main/**`, `src/*.java`, `src/test/Foo.java`;
   `dir/` = вся директория). У каждого файла ровно один владелец: пересекающиеся заявки сервер отклоняет с `FILE_OVERLAP` и
   показывает, какие именно заявки конфликтуют. Одобряя agreement, агент видит файлы всех (`ownership` в `swarm_context`).
2. В IMPLEMENT агент меняет только свои файлы. **Читать можно любые файлы без разрешения** — владение касается только изменений. Нужно изменить файл другого — просьба владельцу:
   `send_message({to: owner, message: "зачем", requestFiles: ["src/test/Helper.java"]})`. Сообщение приходит владельцу с типом
   `FILE_REQUEST` и списком файлов (сервер проверяет, что адресат действительно владелец). Запросивший не ждёт сложа руки:
   он продолжает свою работу, а запрос виден у него в `yourOpenRequests`.
   **Запрос открыт, пока владелец не ответит запросившему** (разрешением или любым сообщением-отказом); просто прочитать его
   недостаточно. Пока запрос открыт, у владельца `nextAction` = **`respond`** (с `openFileRequests` и готовым `exampleCall`),
   и это действие идёт раньше его собственной работы: другой агент заблокирован. `wait` в этом состоянии возвращается сразу.
   Занятый агент видит такие запросы, если вызывает `swarm_context` между шагами работы (так требуют `AGENTS.md` и инструкции).
3. Владелец разрешает: `send_message({to, message: "условия", grantFiles: [...]})` (сервер проверяет, что файлы его, и записывает
   разрешение в `tasks/task-NNN/grants/`; у получателя оно видно в `ownership.grantedToYou`). Отказ — обычное сообщение с причиной.
4. `complete` в IMPLEMENT отклоняется с `FILE_NOT_OWNED`, если в `filesChanged` есть чужой файл без разрешения (ответ называет
   файлы и владельцев). Файлы, которые никто не заявил, допускаются с предупреждением `warnings`: нужно сообщить остальным.

Маски сравниваются точно: `src/*Controller.java` и `src/*Service.java` не пересекаются, поэтому делить файлы можно и внутри
одной директории; `src/**/*Test.java` и `src/main/**` пересекаются (`src/main/FooTest.java`).

Это договорённость, а не файловая блокировка: сервер не следит за диском. В git-проекте он сверяет заявки с реальными
коммитами (см. [Коммиты](#коммиты)); без git — только с тем, что агенты сообщают. Для настоящей параллельной работы
по-прежнему лучше worktree на каждого агента.

### `create_task` (задачу может создать агент)

Задачу создаёт либо оператор ([CLI](#cli-оператора)), либо агент по просьбе пользователя: «создай задачу для backend и reviewer:
...». Агент зовёт `create_task({title, description, agents: ["reviewer"]})`; он добавляется автоматически и становится
**lead**, остальные просыпаются со статусом `UPDATED`. Защиты от мусорных задач:

- только если у агента нет активной или заблокированной задачи (`HAS_ACTIVE_TASK`; отменённая или завершённая не мешает);
- `description` не короче 40 символов, без заглушек: проблема, ожидаемое поведение, файлы, кто что делает; в описании
  слова пользователя, придумывать задание нельзя (`AGENTS.md` это требует);
- `verifyCommand` — команда сборки/тестов для фазы INTEGRATE, только если пользователь её назвал;
- все агенты из `agents` уже зарегистрированы (иначе `AGENT_NOT_REGISTERED` со списком `registeredAgents`), то есть сначала
  запускаются оба CLI, потом создаётся задача;
- без активной задачи `swarm_context` показывает `allowedActions: ["create_task", "wait"]`, но `nextAction` остаётся `wait`:
  сам по себе агент задачу не начинает.

### `nextAction`

| Значение | Фаза | Что делать |
|---|---|---|
| `respond` | любая | другой агент ждёт ответа на запрос ваших файлов: ответить (`grantFiles` или отказ), потом продолжить |
| `propose` | DISCUSS | (lead) согласовать роли и вызвать `propose` |
| `approve` | DISCUSS | прочитать `agreement`, `complete()` одобряет, `propose` заменяет |
| `implement` | IMPLEMENT | сделать свою часть, `complete({result, ...})` |
| `fix` | IMPLEMENT | прочитать `fixRequests`, исправить, снова `complete` |
| `sync` | SYNC | проверить работу из `reviewTargets`, `complete({status, ...})` |
| `integrate` | INTEGRATE | (lead) слить коммиты всех, прогнать сборку и тесты, `complete({status, result, commits})` |
| `wait` | любая | ничего не делать, вызвать `wait()` (в том числе если задача `BLOCKED`) |
| `done` | DONE | завершить работу |

`exampleCall` в каждом ответе — готовый вызов с реальными id агентов (`{tool, args}`): помогает слабым моделям, которые
иначе шлют пустые аргументы.

### `wait`

Возвращается со `status`:

| status | Когда |
|---|---|
| `MESSAGES` | есть непрочитанные сообщения (в `pendingMessages`) |
| `ACTION_REQUIRED` | у агента появилось действие (`nextAction` ≠ `wait`) |
| `UPDATED` | сменилась задача, фаза или статус, но действия для агента нет (новая задача, откат в IMPLEMENT, отмена, `BLOCKED`) |
| `DONE` | задача завершена |
| `TIMEOUT` | ничего не произошло; просто вызвать `wait` снова |

Со всеми статусами, кроме `TIMEOUT`, приходит полный свежий контекст. `TIMEOUT` отвечает коротко (`task` с id/фазой/статусом,
`nextAction`, `allowedActions`, `waitingOn`, `hint`): пока агент ждёт медленного коллегу, каждый ход не тащит в его контекст
agreement и все implementations заново. Таймаут по умолчанию 120 с (раньше 30 с), то есть ждущий агент тратит в 4 раза меньше
ходов; его можно поменять через `AGENT_NETWORK_WAIT_MS`, держите его ниже таймаута вызова tool у клиента (у Codex 60 с). Если что-то уже требует внимания, `wait` возвращается сразу, так что заблокировать
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
`INVALID_PHASE`, `INVALID_TRANSITION`, `FILE_OVERLAP`, `FILE_NOT_OWNED`, `HAS_ACTIVE_TASK`, `NOT_ASSIGNED`, `ALREADY_COMPLETED`, `NOT_STARTED`, `MESSAGE_NOT_FOUND`,
`FORBIDDEN`, `INVALID_INPUT`, `INVALID_CONFIG`, `TASK_BLOCKED`, `LOCK_TIMEOUT`, `INTERNAL_ERROR`. После любой ошибки агент может
восстановиться вызовом `swarm_context`.

### Расширенный набор (только для отладки)

С `AGENT_NETWORK_ADVANCED=1` дополнительно доступны 19 мелких tools: `agent_register`, `agent_list`, `agent_heartbeat`,
`task_create`, `task_get`, `agreement_propose/approve/get`, `message_send/list/read`, `wait_for_event`,
`implementation_start/complete/list`, `sync_submit`, `sync_list`, `integration_submit`, `phase_get`. Для обычной работы не включайте.

---

## CLI оператора

Команды выполняются вне LLM. `--network-dir` (абсолютный путь) можно заменить переменной `NETWORK_DIR`.

```bash
node dist/index.js task create  --network-dir <dir> --agents backend,reviewer --title "..." [--description "..."] \
                               [--verify "mvn -q verify"] [--max-fix-rounds 3] [--no-commits]
node dist/index.js task list    --network-dir <dir>      # id, title, phase, status, agents, syncRound, maxFixRounds, blockedReason
node dist/index.js task cancel  --network-dir <dir> --id task-001 [--reason "..."]
node dist/index.js task unblock --network-dir <dir> --id task-001 [--rounds 1]
node dist/index.js agent list  --network-dir <dir>      # id, type, role, status, lastSeenAt, pid
node dist/index.js ui          --network-dir <dir> [--port 4777]
```

- `task create` не требует, чтобы агенты уже были запущены: они подхватят задачу при старте (`swarm_context`/`wait`).
- `task unblock` для `BLOCKED`-задачи добавляет `--rounds` раундов исправлений (по умолчанию 1) и сразу запускает отложенное
  исправление; спящие агенты просыпаются.
- `task cancel` (для `ACTIVE` и `BLOCKED`) снимает задачу с работы (неверное или пустое задание). Агенты переходят к следующей задаче или ждут;
  спящий `wait` просыпается со статусом `UPDATED`. Папка задачи не удаляется (иначе номера задач переиспользовались бы и
  курсоры событий у агентов разошлись бы).
- Статусы агентов: `ONLINE`, `WORKING`, `WAITING` (сейчас в `wait`), `OFFLINE` (процесс завершился штатно).

## UI (только просмотр)

```bash
node dist/index.js ui --network-dir /abs/path/project/.agent-network     # → http://127.0.0.1:4777
```

Страница обновляется раз в 2 с и показывает: агентов (статус, роль, активность, pid; `DEAD` значит, что процесс пропал,
хотя статус не `OFFLINE`, то есть агент, скорее всего, упал; назначенные, но ещё не запущенные агенты помечены), задачи с
переключателем фаз (включая INTEGRATE) и номером раунда, «ждём:», пометку `BLOCKED` с причиной, таблицу по агентам
(assignment и одобрение, implementation с файлами, sync-отчёт с findings), результат интеграции, agreement, сообщения и
события. Только `GET`, слушает `127.0.0.1`, чужие `Host` отклоняются,
ничего не пишет в сеть. UI смотрит ровно в тот каталог, который вы указали: если агенты работают в другом `NETWORK_DIR`,
страница будет пустой.

---

## Skill для агентов

[skills/agent-network/SKILL.md](skills/agent-network/SKILL.md) — краткая инструкция для модели (цикл по `nextAction`, tools, правила);
CLI подхватывает её как skill. Источник один, в этой папке; в проект её подключают копией или ссылкой:

```bash
# Qwen: .qwen/skills/<name>/SKILL.md   Claude Code: .claude/skills/<name>/SKILL.md
mkdir -p /abs/project/.qwen/skills/agent-network
ln -s /abs/path/agent-network-mcp/skills/agent-network/SKILL.md /abs/project/.qwen/skills/agent-network/SKILL.md   # или cp
```

**Вместе со skills разработки** (например, `java-dev-flow`) слои разделены: этот skill решает *когда и кто* (фаза, assignment,
владение файлами, кому писать), skill разработки — *как* делать свою часть внутри фазы из `nextAction`. Со стороны
`java-dev-flow` то же самое описано в `java-dev-flow/references/swarm.md`: дизайн и план уходят в `propose`, TDD и `critic` —
в IMPLEMENT по своему assignment, peer review в SYNC заменяет `java-code-reviewer`, вопросы — другим агентам, а не пользователю.
На маленькой локальной модели подключайте только skill `agent-network`.

## Конфигурация

Переменные окружения процесса MCP:

| Переменная | Обязательна | Описание |
|---|---|---|
| `AGENT_ID` | да | идентичность агента (`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`) или пул через запятую |
| `NETWORK_DIR` | да | абсолютный путь к `.agent-network/` (не `/`); у всех агентов одинаковый |
| `AGENT_TYPE` | нет | `qwen`, `claude`, ... (метка; по умолчанию `unknown`) |
| `AGENT_ROLE` | нет | роль (метка) |
| `AGENT_NETWORK_WAIT_MS` | нет | таймаут `wait` по умолчанию, 1000..300000 (по умолчанию 120000); ниже таймаута tool у клиента |
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
│   ├── advancedTools.ts  19 мелких tools (AGENT_NETWORK_ADVANCED=1)
│   ├── instructions.ts инструкции, которые MCP отдаёт клиенту
│   └── toolkit.ts      обёртка регистрации tools и формат ответов
├── service.ts          протокольная логика (NetworkService), автопереходы фаз, события
├── phase/phaseManager.ts   state machine: переходы, предусловия, кто ревьюит и чинит, лимит раундов
├── storage/fileStore.ts    атомарная запись, эксклюзивное создание, mkdir-lock, защита путей
├── stores/             агенты, задачи, сообщения, события, agreement, implementations, sync- и integration-отчёты, grants
├── events/eventHub.ts  один fs.watch на процесс + резервный опрос, ожидание событий
├── ui/                 read-only веб-страница (state.ts, server.ts, page.ts)
├── ownership.ts        владение файлами: маски, точное пересечение масок, владельцы (чистые функции)
├── git.ts              repository / branch / commit, проверка коммитов агентов через git CLI
├── validation.ts       id, пути, коммиты
└── errors.ts, types.ts
```

### Файловая структура сети

```
.agent-network/
├── network.json
├── agents/<id>.json                 агент (на время выбора имени из пула появляется временный lock agents/.claim)
├── cursors/<id>.json                курсоры прочитанных событий (per agent, per scope)
├── hooks/<id>.json                  что хук Claude Code уже показал агенту (только для хука)
├── events/event-NNN.json            события вне задач (AGENT_REGISTERED)
└── tasks/task-NNN/
    ├── task.json                    фаза, статус, агенты, syncRound, maxFixRounds, reviewScope, git-контекст (repo, branch, commit)
    ├── agreement.json
    ├── implementations/<agent>.json
    ├── sync/sync-NNN.json
    ├── integration/integration-NNN.json  результат INTEGRATE (раунд, коммиты, findings)
    ├── messages/msg-NNN.json
    ├── grants/grant-NNN.json            разрешения владельца менять его файлы
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
  читаются с диска, это только отчёт агента, но тоже проверяются на `..` и абсолютные пути; `commits` только hex и
  передаются в `git` только как аргументы (`execFile`, без shell). `verifyCommand` сервер не выполняет: его запускает lead.
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

247 тестов, vitest 3 (vitest 4 требует Node ≥ 20.19):

- **unit**: `FileStore` (атомарная запись, конкурентные создания, path traversal, lock), сторы, `PhaseManager` (все пары
  переходов, сбор раунда, ревью исправленного, лимит раундов), точное пересечение масок (с fuzz-проверкой), `EventHub`,
  `NetworkService` (протокол, интеграция, `BLOCKED`/`unblock`, проверка коммитов на настоящем git-репозитории) и фасад
  `Swarm` (весь протокол, цикл `NEEDS_FIX`, короткий `TIMEOUT`, misuse-сценарии), UI-состояние и HTTP, хуки Claude Code
  (поиск агента по дереву процессов, одно уведомление на сообщение, Stop один раз).
- **integration** (реальные процессы MCP через stdio-клиент SDK): полный цикл через 5 tools, **три агента в трёх git
  worktree** (деление файлов масками в одной папке, коммиты, сбор всех ревью, повторное ревью только исправления, слияние
  веток lead'ом), конкурентная запись из двух процессов, crash recovery (`SIGKILL` + рестарт), пул идентичностей, CLI
  оператора, схемы tools; `advanced.test.ts` проходит шаги исходного ТЗ через расширенные tools.

## Если что-то не работает

| Симптом | Причина и решение |
|---|---|
| MCP «disconnected» / `failed to start` | в логе CLI (`~/.qwen/debug/*.txt`, строка `MCP STDERR`): `AGENT_ID environment variable is required` — в конфиге нет `AGENT_ID`; `already registered by a running process` — этот id держит живой процесс (дайте каждому агенту своё имя или используйте пул); `NETWORK_DIR must be an absolute path` |
| Второй агент не подключается | оба CLI читают один глобальный конфиг с одним `AGENT_ID`. Используйте пул `a,b` или отдельные конфиги |
| `HAS_ACTIVE_TASK` | у агента уже есть активная или заблокированная задача: завершите, разблокируйте или отмените её |
| Задача `BLOCKED`, агенты ждут | ревью/интеграция снова нашли ошибки, а раунды исправлений кончились. Посмотрите findings в UI и решите: `task unblock --id ...` или `task cancel` |
| `complete` отклонён: «Commit your changes» | проект — git-репозиторий, работа сдаётся коммитами. Агент коммитит свои файлы и передаёт хэши; без git-процесса создайте задачу с `--no-commits` |
| `wait` обрывается по таймауту клиента | уменьшите `AGENT_NETWORK_WAIT_MS` ниже таймаута tool у CLI (Codex: 60 с) |
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
- Сервер не анализирует код и не запускает сборку: проверка совместимости в SYNC и прогон тестов в INTEGRATE — работа
  самих агентов, сервер хранит результат и сверяет коммиты.
- Протокол барьерный: каждая фаза ждёт всех. Параллельна только IMPLEMENT, поэтому выигрыш по времени есть, только если
  задача делится на сопоставимые независимые части с заранее зафиксированным `interfaces`.
- **Реальные прогоны.** Протокол проверен автотестами на реальных stdio-процессах. На живых Qwen CLI (локальная модель
  `qwen3.5-9b`) пройдены регистрация, обмен сообщениями, `propose`, одобрение и переход в IMPLEMENT; полный цикл до DONE на
  живых агентах и связка Qwen + Claude Code ещё не подтверждены. Качество работы сильно зависит от модели.

Правила для самих агентов: [AGENTS.md](AGENTS.md); skill для CLI со skills (Qwen, Claude Code): [skills/agent-network/SKILL.md](skills/agent-network/SKILL.md). План и принципы дизайна: [PLAN.md](PLAN.md).

# Рой agent-network + java-dev-flow: A/B-прогон

Цель: понять, помогают ли skills разработки рою или мешают ему. Ветка `swarm-skill-layers`: правила слоёв в
`java-dev-flow/references/swarm.md` и в разделе «With development skills» skill `agent-network`.

## Стенд

0. В `orders-service` `./mvnw verify` зелёный на базе. Если нет — сначала починить или взять другой проект: иначе INTEGRATE
   ничего не докажет. Закоммитить базу, чтобы откатываться между прогонами.
1. Два worktree на агента (`git worktree add ../orders-backend -b swarm-backend` и `../orders-reviewer`), общий
   `NETWORK_DIR`, MCP подключён в обоих (`claude mcp add agent-network --scope local ...`, см. README agent-network-mcp).
2. Модель одна и та же у обоих агентов, Claude Code. Qwen 9B — отдельный прогон только с skill `agent-network`.
3. Задача одна и та же, M, делится на две части по файлам. Пример: «POST /orders/{id}/cancel: отменять можно NEW и PAID,
   при отмене писать событие OrderCancelled в outbox; агент backend — API и сервис, агент events — событие и outbox».

## Варианты

| | Skills в `.claude/skills` | Что проверяем |
|---|---|---|
| A | только `agent-network` | базовая линия: протокол без дисциплины разработки |
| B | `agent-network` + `java-dev-flow` и его skills (как сейчас в orders-service) | разделение слоёв |
| C (опц.) | B, но `java-dev-flow` со старым SKILL.md без swarm mode (из `main`) | что даёт именно разделение |
| D | B + OpenSpec: рой поверх change `add-multi-currency` (L) | три слоя: агенты делят номера задач `tasks.md`, а не придумывают дизайн |

## Вариант D: подготовка

1. Сессия в `orders-service`: `/java-spec-review add-multi-currency`. Ожидаем замечание D9: группы идут в порядке сборки
   (миграция → сущности → сервис → API), параллельно их не раздать. Решить с пользователем: перерезать `tasks.md` на
   вертикальные срезы (например, «валюта в заказе: схема + сущность + API» и «наследование в платежах/возвратах + события»)
   через `/opsx:update` или оставить как есть и проверить, что рой честно скажет «быстрее одним агентом».
2. Закоммитить change, `create_task` с путём `openspec/changes/add-multi-currency/` в описании.

Дополнительно записать для D:
- задания в agreement — номера задач `tasks.md`, а не пересказ дизайна;
- никто, кроме lead, не правил `openspec/changes/add-multi-currency/**` (по `git log` веток агентов);
- никто не запускал цикл `/opsx:apply` и не брал чужие задачи;
- группа 9 (Verification and Reviews) разнесена по фазам; lead отметил чекбоксы в INTEGRATE после зелёного прогона;
- конфликты слияния в INTEGRATE — были ли, в каких файлах.

## Что записать в каждом прогоне

- дошёл ли рой до DONE; сколько раундов NEEDS_FIX (SYNC и INTEGRATE);
- код в DISCUSS (нарушение) — да/нет; вопросы пользователю от не-lead агентов — сколько;
- `FILE_NOT_OWNED` и `requestFiles` — сколько; были ли тесты и changesets в `files` agreement;
- есть ли в `interfaces` контракт события и эндпоинта;
- тест на каждое поведение и видел ли агент его красным (по транскрипту);
- `critic` в IMPLEMENT для M — запускался; `java-code-reviewer` в IMPLEMENT — не должен;
- хуки `critic-gate` / `evidence-guard`: блокировали ли ход посреди цикла `wait()`;
- зелёный ли `verifyCommand` после INTEGRATE; время до DONE; токены / расход лимита на агента.

## Ожидание

B лучше A по качеству (тесты, контракты, находки critic) при росте токенов не больше чем ~2×. Если B застревает
(вопросы пользователю, код в DISCUSS, двойное ревью) — дорабатывать `swarm.md`, а не протокол сервера.

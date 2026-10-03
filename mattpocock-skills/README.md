# Скиллы из mattpocock/skills

Копия пяти наборов скиллов из [mattpocock/skills](https://github.com/mattpocock/skills), коммит `d81f3a1` от 2026-09-29. Файлы не менялись, лицензия MIT — в [LICENSE](LICENSE). Каталоги `agents/openai.yaml` нужны только Codex, Claude Code их игнорирует.

Не установлены: чтобы скилл заработал, скопируй его каталог в `~/.claude/skills/` (для всех проектов) или в `.claude/skills/` проекта.

| Скилл | Вызов | Что делает | Зависит от |
|---|---|---|---|
| `grilling` | модель или `/grilling` | Интервью раундами: все вопросы, предпосылки которых уже решены, с нумерацией и рекомендуемым ответом к каждому. Факты агент ищет сам, решения оставляет пользователю. Вызывается из фазы 1 `java-dev-flow` для L-задач | — |
| `grill-me` | только `/grill-me` | Ручной вход в `grilling` | `grilling` |
| `writing-for-agents` | модель или `/writing-for-agents` | Как писать скиллы и `CLAUDE.md`: description как всегда загруженный указатель, один источник правды для каждого правила, удаление фраз, которые не меняют поведения, позитивные формулировки вместо запретов | — |
| `retro` | только `/retro` | Ретроспектива сессии: что превратить в хук или линтер, что убрать из `CLAUDE.md`, где агенту не хватало информации | `writing-for-agents` |
| `handoff` | только `/handoff` | Сжимает разговор в документ во временном каталоге ОС, чтобы продолжить в новой сессии | — |
| `git-guardrails-claude-code` | модель или `/git-guardrails-claude-code` | Ставит PreToolUse-хук, который блокирует `git push`, `reset --hard`, `clean -f`, `branch -D`, `checkout .`, `restore .`. Нужен один раз: после установки хука каталог скилла можно удалить | `jq` |

`grilling` и `grill-me`, а также `retro` и `writing-for-agents` ставь парами: второй скилл в паре вызывает первый.

Вызов «только `/…`» означает `disable-model-invocation: true`: скилл не занимает контекст, но и другие скиллы не могут его вызвать. Поэтому `java-dev-flow` не вызывает `handoff` сам, а предлагает пользователю набрать `/handoff`.

## Что ещё взято из репозитория, но не копией

- `diagnosing-bugs` переписан под Java как [`java-diagnosing-bugs`](../java-diagnosing-bugs/SKILL.md) и стал профильным скиллом маршрута B в `java-dev-flow`.
- Ось Spec из `code-review` встроена в агента `java-code-reviewer`: недостающие требования, лишнее поведение, неверная реализация, каждая находка с цитатой из спеки.
- Вертикальные срезы, связи «blocked by» и expand–contract из `to-tickets` встроены в `jira-tasks`.
- «Тесты только на согласованных границах» из `tdd` встроено в фазу 3 `java-dev-flow`.

## Обновление

Сравни с апстримом и перенеси изменения вручную:

```bash
git clone --depth 1 https://github.com/mattpocock/skills.git /tmp/mp-skills
for d in grilling grill-me writing-for-agents retro handoff git-guardrails-claude-code; do
  diff -r /tmp/mp-skills/skills/*/"$d" "$d"
done
```

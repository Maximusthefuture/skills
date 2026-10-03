# Скиллы из megamott/vibe-skills

Копия скилла `update-claude-md` из [megamott/vibe-skills](https://github.com/megamott/vibe-skills), коммит `b1b2c2c` от 2026-06-03. Файл не менялся, лицензия MIT — в [LICENSE](LICENSE) (vibe-skills основан на obra/superpowers).

Не установлен: чтобы скилл заработал, скопируй каталог в `~/.claude/skills/` или в `.claude/skills/` проекта.

| Скилл | Вызов | Что делает |
|---|---|---|
| `update-claude-md` | модель или `/update-claude-md` | Сверяет `CLAUDE.md` с кодом: что устарело, что описано неверно, чего не хватает. Показывает список «удалить / обновить / добавить» и правит точечно только после подтверждения. Мета-инструкции (язык, указатель на `java-dev-flow`) не трогает |

С `retro` из `mattpocock-skills/` не дублируется: `retro` ищет улучшения по ошибкам прошедшей сессии, `update-claude-md` — по расхождению `CLAUDE.md` с кодом.

## Что ещё взято из репозитория, но не копией

- Идея `next-stage-prompt` — переход в свежий контекст после утверждения плана L-задачи: фаза 3 `java-dev-flow` выдаёт готовый промпт для нового чата.
- Проверка на двусмысленность из само-ревью спеки в `brainstorming` — в шаблоне дизайн-резюме `java-dev-flow` (`references/templates.md`).

## Обновление

```bash
git clone --depth 1 https://github.com/megamott/vibe-skills.git /tmp/vibe-skills
diff -r /tmp/vibe-skills/skills/update-claude-md update-claude-md
```

---
name: jira-tasks
description: "Creates Jira tickets via the Atlassian MCP from the user's list or from a plan that must be sliced into tickets. Use when the user asks to create tickets/tasks in Jira («создай задачи/таски в jira»), passes a list of tasks for a sprint, asks to split a plan, feature or follow-ups into tickets («разбей на задачи»), or calls /jira-tasks. Slices a plan into vertical slices with \"blocks\" links, asks for the sprint and story points, checks the limit of 5 tickets per sprint, shows the final plan, creates tickets only after confirmation and keeps a quarterly log for the review."
---

# Creating Jira tickets

The user passes a ready list of tasks or a plan (a feature, a spec, follow-ups from a report) that must first be sliced into tasks. Every task becomes a separate Jira ticket via the Atlassian MCP (Rovo MCP: the tools `getAccessibleAtlassianResources`, `getVisibleJiraProjects`, `getJiraProjectIssueTypesMetadata`, `getJiraIssueTypeMetaWithFields`, `searchJiraIssuesUsingJql`, `createJiraIssue`, `editJiraIssue`, `getJiraIssue`). Take the exact names from the Atlassian server's tool list — if they are not in the session, stop and tell the user the Atlassian MCP is not connected.

Talk to the user in Russian. Ticket summaries and descriptions go in the language of the user's list (usually Russian); the templates below show the structure.

## Hard rules

1. **No calls that change Jira before the user's explicit confirmation** («да», «ок», «создавай», yes). Reads (searching sprints, projects, fields) may happen right away.
2. **Always ask for story points** — for every ticket, even if the user did not mention them. Do not invent or default values. If the user gave SP in the original list, show them in the plan — that is the confirmation.
3. **No more than 5 tickets in one sprint.** Counted: the user's tickets already in the sprint plus the new ones (see step 4).
4. **A sprint is mandatory.** Not given — ask, then find it in Jira. Do not guess.

## Config

The file `~/.claude/skills/jira-tasks/config.json` stores values found on the first run so they are not searched every time:

```json
{
  "cloudId": "",
  "projectKey": "",
  "issueType": "Task",
  "storyPointsField": "",
  "sprintField": "",
  "reviewLogDir": "~/Documents/jira-review"
}
```

No file or an empty field — determine the value (step 1) and save it. A value from the config causes an API error — determine it again and overwrite.

## Workflow

### 1. Preparation
- `cloudId`: via `getAccessibleAtlassianResources`. Several sites — ask which one.
- `projectKey`: not in the config and not given by the user — ask (you can show the list from `getVisibleJiraProjects`).
- Field IDs: via `getJiraIssueTypeMetaWithFields` for the project and issue type find:
  - the story points field — by the name `Story Points` or `Story point estimate` (usually `customfield_10016` or `customfield_100xx`);
  - the sprint field — by the name `Sprint` (usually `customfield_10020`).

### 2. Parsing the list or slicing the plan
**A ready list.** Split the user's message into separate tasks: a short title (summary) and, if present, a description. A task's wording is unclear — clarify, but do not ask unnecessary questions.

**A plan, feature or spec.** Slice it into **vertical slices**:
- a slice goes along a narrow but complete path through all layers: changeset → entity and repository → service → controller or listener → tests. Not "the whole schema in one ticket, all services in another";
- a slice is verifiable by itself: after it the endpoint responds, the event is handled, the report is built;
- a slice fits into one working session. If the code must be prepared first (a preparatory refactoring), that is a separate slice, and it goes first.

Every ticket has **"Blocked by"**: the tickets that must be done before it. Name only real dependencies; a ticket without blockers can start right away.

**A wide refactoring** — one mechanical edit that touches all the code (renaming a column, changing the type of a shared class) — is not sliced vertically. Slice it by expand–contract:
1. **expand** — the new next to the old, nothing breaks;
2. **migration** — the calling code moves over in batches (per module or package), each batch is its own ticket, blocked by expand;
3. **contract** — the old is removed, the ticket is blocked by all migration batches.

For a DB schema this is the same expand/contract as in `migration-safety`.

The ticket description follows the template, without file paths and code: they go stale fast. For Russian tickets use these headings:

```
Что сделать: <behavior from the user's or API consumer's point of view, not a list of layers>

Критерии приёмки:
- [ ] <a verifiable condition>
- [ ] <a verifiable condition>

Блокируется: <ticket numbers from the plan or «нет»>
```

Show the slicing as a numbered list (title, "Blocked by", what the ticket delivers) and ask:
- is the granularity right: not too coarse or too fine;
- are the dependencies right: every ticket depends only on what really blocks it;
- what to merge or split.

Repeat until the user agrees with the slicing. Then steps 3–9, as for a ready list.

### 3. Sprint
- No sprint given — ask: «В какой спринт добавить задачи?»
- Find the sprint in Jira. Rovo MCP has no dedicated sprint tool, so search via JQL (`searchJiraIssuesUsingJql`, request the sprint field):
  - active/future: `project = <KEY> AND sprint in (openSprints(), futureSprints())`
  - by name: `project = <KEY> AND sprint = "<name>"`
  From the sprint field of the found issues take `id`, `name`, `state`.
- Several matching sprints or no exact match — show the found ones and ask to choose. No sprint found at all — say so and ask again. Do not use a `closed` sprint; warn about it.

### 4. The 5-ticket limit
- Count the user's tickets already in the sprint:
  `sprint = <sprintId> AND (assignee = currentUser() OR reporter = currentUser())`
- `free = 5 − already_in_sprint`. More new tickets than free slots — do not create the extra ones in this sprint. Say how many slots are left and offer: move the rest to another (the next) sprint, drop some tickets, or leave the rest without a sprint. Moving to another sprint goes through steps 3–4 again.
- If tickets have "Blocked by", only the end of a chain may move to the next sprint. A blocker cannot be in a later sprint than the ticket it blocks.

### 5. Story points
For every ticket without SP ask in one message, as a list, e.g.:
```
Сколько сторипоинтов на каждую задачу?
1. Настроить CI для сервиса X — ?
2. Починить таймаут в API — ?
```
Accept numbers only. An incomplete answer — ask again for the missing ones.

### 6. Plan and confirmation
Show the final table and wait for confirmation:

```
Проект: ABC   Спринт: ABC Sprint 42 (id 1234, active)   Задач в спринте после создания: 4/5

| # | Задача                         | SP | Спринт         | Блокируется |
|---|--------------------------------|----|----------------|-------------|
| 1 | Настроить CI для сервиса X     | 3  | ABC Sprint 42  | —           |
| 2 | Починить таймаут в API         | 2  | ABC Sprint 42  | 1           |

Итого: 2 задачи, 5 SP. Связей «blocks»: 1. Создаю?
```
Show the "Блокируется" column only if there are dependencies. Confirming the plan includes creating the links.

If the user changes something — update the plan and show it again.

### 7. Creation
After confirmation call `createJiraIssue` for every ticket:
- `cloudId`, `projectKey`, `issueTypeName` from the config, `summary`, `description` (if any);
- in `additional_fields`: `{"<storyPointsField>": <SP>, "<sprintField>": <sprintId>}` (the sprint as a number, not an object);
- assign to the current user if that is the project's practice (`assignee_account_id`, if known).

Creation with the sprint or SP field fails (the field is not on the create screen) — create the ticket without it and set the field via `editJiraIssue`. If that fails too — tell the user which ticket and which field were not set.

Create tickets one by one; on an error do not retry blindly — first check via JQL whether the ticket was created anyway (by summary in this project within the last minutes), so you do not create duplicates.

**Dependencies.** Create tickets in dependency order: blockers first. Then by the time a ticket is created, its blockers' keys are known, and the description says "Блокируется: ABC-123" instead of plan numbers. Then link the tickets:
- if the Atlassian tools include creating an issue link (e.g. `createIssueLink`), create a `Blocks` link: blocker → blocked ticket;
- if there is no such tool, the links stay only in the descriptions. Tell the user which links to set by hand.

### 8. The quarterly review log
After creation append the tickets to the file `<reviewLogDir>/<YYYY>-Q<N>.md` (the quarter by the current date: Jan–Mar Q1, Apr–Jun Q2, Jul–Sep Q3, Oct–Dec Q4). No file — create it with the header:

```markdown
# Задачи <YYYY> Q<N>

| Дата | Ключ | Задача | SP | Спринт | Ссылка |
|------|------|--------|----|--------|--------|
```

And add a line for every **successfully created** ticket, e.g.:
```
| 2026-10-02 | ABC-123 | Настроить CI для сервиса X | 3 | ABC Sprint 42 | https://<site>.atlassian.net/browse/ABC-123 |
```
Do not overwrite the file — only append.

### 9. Summary
Show the user the created tickets with keys and links, the total SP, how many tickets are now in the sprint (n/5), the created "blocks" links (or which to set by hand), the log file path and any errors.

---

Slicing into vertical slices, "blocks" links and expand–contract for wide refactorings are taken from `to-tickets` in [mattpocock/skills](https://github.com/mattpocock/skills) (MIT).

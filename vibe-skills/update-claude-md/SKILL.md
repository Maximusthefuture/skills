---
name: update-claude-md
description: "Brings CLAUDE.md up to date — removes stale information, updates sections to the current state of the code, adds what is missing. Use when the user asks to update CLAUDE.md, clean up project docs, remove noise from the agent's context, sync the docs with the code («обнови CLAUDE.md», «почисти документацию»), or when CLAUDE.md clearly diverges from reality."
---

You are a technical writer. The task: bring CLAUDE.md in line with the real state of the codebase. CLAUDE.md is context for an AI agent, not for people: it must be accurate, short and current.

## Workflow

### Step 1: Read the current CLAUDE.md

Read the `CLAUDE.md` at the project root in full. Write down:
- which sections it has;
- which concrete claims about the code/architecture/stack it makes;
- which directory, file and command paths it mentions.

### Step 2: Investigate the current state of the code

For every claim in CLAUDE.md find confirmation in the code. Universal sources of truth:

- **Stack and dependencies** — the project's dependency manifest (`package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, etc.).
- **Entry points / external interfaces** — the matching directories (controllers, routers, CLI commands, queue handlers).
- **Project structure** — the real directory tree, first and second level.
- **Development commands** — the project's task runner (`Justfile`, `Makefile`, `package.json:scripts`, etc.).
- **Architectural units** (aggregates/modules/services/packages) — look at the contents of the matching directories.

Do not hardcode specific paths or commands — determine them from the current state of the project every time.

### Step 3: Find the divergences

For every CLAUDE.md section record:
- **Stale**: in CLAUDE.md, not in the code
- **Wrong**: described differently from how it really works
- **Missing**: in the code, absent from CLAUDE.md (important things)

The criterion for adding: information the agent needs to avoid mistakes or avoid asking again. Do not add everything — only what affects decisions.

### Step 4: Prepare the list of changes

Before editing show the user the list:
```
REMOVE:
- [section/line]: reason

UPDATE:
- [section]: what is stale → what is current

ADD:
- [section]: what and why
```

Wait for confirmation (or skip this step if the user said "just update it").

### Step 5: Apply the changes

Edit CLAUDE.md with the Edit tool point by point, without rewriting the whole file.

Principles:
- Keep the section structure if it is logical
- Keep instructions for the agent (language settings, the order of calling skills, etc.)
- Remove the obvious — what is visible from the code itself
- Remove duplication between CLAUDE.md and `.claude/rules/*.md`
- Code structure: update only if the changes are substantial (new modules, removed modules)

## Do not touch

- Language settings and agent behavior instructions
- The "skill orchestrator" section and similar meta-instructions
- Things not derivable from the code: business context, reasons for architectural decisions, non-obvious constraints, pitfalls

## Final answer format

After all edits:
```
CLAUDE.md updated:
- Removed: [short list]
- Updated: [short list]
- Added: [short list]
```

Write the edits and the final answer in the user's language and keep CLAUDE.md in the language it is written in.

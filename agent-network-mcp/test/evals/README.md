# Coordinator behavior checks

These opt-in tests launch the real isolated coordinator, with a temporary project
and two runner IDs. No runners are launched and no tasks are approved or created.
They require a locally authenticated coordinator CLI and use model tokens.

Build first (`npm run build`), because the coordinator starts the compiled project
MCP entry point. In PowerShell:

```powershell
$env:COORDINATOR_EVAL = '1'
$env:COORDINATOR_EVAL_ENGINE = 'claude' # or codex / kimi
# Optional: $env:COORDINATOR_EVAL_MODEL = '<configured model>'
npm test -- test/evals/coordinator.test.ts
Remove-Item Env:COORDINATOR_EVAL
```

The checks exercise a clear request, a short answer to a previous question,
unknown implementation details, and a consequential unresolved requirement.
They verify saved proposals versus clarification, question count, and the human
approval boundary. They are skipped during normal tests.

These are behavioral regression signals, not proof of semantic quality. Review
actual proposals in the project UI as well: each explicit outcome must have a
matching acceptance check, assumptions must be distinguishable from facts, and
the proposal must not introduce unrequested functionality. Structured required
fields prevent missing sections, but cannot guarantee truthful or useful text.

Existing saved proposals retain their original payload and approval hash. The
required brief applies to new coordinator tool calls; the operator's existing
edit/approval flow and the task API keep their current contract.

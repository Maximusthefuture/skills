<!-- A fragment for the project's CLAUDE.md: routing between java-dev-flow and OpenSpec. -->

## Development: java-dev-flow + OpenSpec

The engineering process is set by the `java-dev-flow` skill. Agreements on what we build live in OpenSpec (`openspec/`). Details — `references/openspec.md` in the `java-dev-flow` skill.

| Situation | What to do |
|---|---|
| Size S: an edit without changes to schema, API, authorization, transactions, external effects | no change — `java-dev-flow` directly |
| A bug that restores behavior already described in `openspec/specs/` | no change — `java-dev-flow`, route B |
| A bug that showed the spec is wrong or incomplete | a change with a MODIFIED/ADDED requirement |
| Refactoring without behavior change | no change (or a change with `skip_specs: true` if a trace is needed) |
| Size M | `/opsx:propose <name>` → artifact review → `/opsx:apply` |
| Size L | `/opsx:explore` → `/opsx:propose <name>` → artifact review → `/opsx:apply` |
| Reviewing change artifacts, grilling a `spec.md` | `/java-spec-review <name or path to spec.md>` |
| Understanding changed along the way | `/opsx:update` — do not deviate from `design.md` silently |
| Everything is implemented | the "Verification" group in `tasks.md` is closed → `/opsx:verify` if enabled → `/opsx:archive` |
| A production incident | no change — `debugging-discipline`; code comes after the cause is found |

Rules:
- Code is written only after a human has reviewed the change artifacts, unless the user said otherwise.
- Every task from `tasks.md` is implemented via `java-tdd`: the test first, and it must fail before the implementation.
- A task is ticked `[x]` only after its test and the module tests are green.
- The "Verification" group for M and L runs the `java-code-reviewer` and `critic` agents on the diff, in one message.
- "Done" — only from the output of commands run after the last edit.

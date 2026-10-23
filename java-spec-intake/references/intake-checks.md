# What breaks when an analysts' design is carried over

**Open when:** step 1 (what to mark on page 1) and step 3 (questions), and when a domain skill is missing in the session.

Each line: what the input usually says → what to check in the project → what goes into our change. **[fact]** is yours to find; **[decision]** goes to the operator.

## Shape of the code

- **Packages.** A feature package (`…orders.giftwrap.{web,service,repo}`) or one flat package → **[fact]** how the project packages code (`java-conventions`, `CLAUDE.md`, existing code wins) → Classes table by the project's layers; mark the departure on page 1.
- **Controller.** A hand-written `@RestController` with its own DTOs → **[fact]** is there `openapi.yaml` + openapi-generator (`interfaceOnly`)? → API contract: the `openapi.yaml` edit, the generated `*Api` the controller implements.
- **Reference.** The input names no example → **[fact]** the closest existing endpoint / listener / job → Reference in `design.md`.
- **New abstractions.** Interfaces, factories, strategies with one implementation → **[fact]** does the code already branch on this set (`java-extensibility-review`)? → one class, unless a second variant exists or is decided.
- **New libraries.** A framework, a broker, a cache the build does not have → **[decision]** only if the existing stack cannot do it; recommend what is there.

## Data

- **Migrations.** Flyway `V12__…sql` in a Liquibase project (or the reverse) → **[fact]** `db/changelog` → a changeset per the project's naming.
- **NOT NULL on a filled table** without a default → **[fact]** is the table in production use? → expand/contract or a default + backfill (`migration-safety`); **[decision]** the value for old rows.
- **Statuses.** A new status → **[fact]** every `switch` / `if` on the enum, the DB CHECK constraint, consumers of status events → scenarios for the transitions; MODIFIED for the old ones.
- **Money and amounts.** `double`, no currency, no rounding rule → **[fact]** how the code holds money → BigDecimal + currency as the code does; **[decision]** rounding if the input does not say.

## Behaviour

- **Happy path only.** → errors as scenarios with status + code: invalid input 400, no permission 403, someone else's resource 404, wrong state 409, a neighbour down. **[decision]** for business-level refusals.
- **Side effects.** "Save and send an event / call the provider" → **[fact]** is there an outbox, idempotency keys? → a retry scenario (same request twice — one effect), outbox instead of direct publishing (`idempotency-and-side-effects`).
- **Who may call it.** No roles in the input → **[fact]** how the code authorizes the neighbouring endpoints → 401/403/404 scenarios; **[decision]** the permission if new.
- **Lists.** "Show all …" → limit, sorting, pagination, an index (`query-discipline`); **[decision]** the default page size if it matters to the business.
- **Their numbers.** Thresholds, limits, "from the fifth order" → keep them word for word in THEN; ambiguity ("from the fifth" = 5th or 6th?) is a **[decision]**.

## Tasks

- **No tests, or tests in a last group** → one task per scenario: `X.Y Scenario "…" — <test level> — verify: <test>`, the test first; groups are slices in the build order.
- **Tasks by layer for the whole feature** ("1. all entities, 2. all services") → slices: changeset → entity and repository → service → controller → errors → metrics.
- **No verification** → the Verification group from `openspec/config.yaml`.

## What not to ask

- What the code answers: table names, existing endpoints, the build tool, the test stack.
- Style of their wording: rewrite it, do not discuss it.
- Their task list order: ours follows the scenarios and the build order anyway.

# Question bank for an OpenSpec change

**Open when:** you go through step 3 of the skill, and also if a domain skill is missing in the session.

Question tags:
- **[code]** — the answer is checked against the repository: Grep, Read, changelog, tests, `pom.xml`;
- **[decision]** — usually the user decides if neither the artifacts nor the code have the answer.

A question without an answer in the artifacts is not yet a finding. First look for the answer in the code and the project's conventions.

Sections:
- [A. proposal.md](#a-proposalmd)
- [B. specs — requirements and scenarios](#b-specs--requirements-and-scenarios)
- [C. design.md](#c-designmd)
- [D. tasks.md](#d-tasksmd)
- [E. Cross-checking](#e-cross-checking)
- [F. Facts from the code](#f-facts-from-the-code)
- [G. Pre-mortem on the artifacts](#g-pre-mortem-on-the-artifacts)
- [What not to ask](#what-not-to-ask)

---

## A. proposal.md

- **A1. Why.** Which problem, for whom, why now? Is it phrased so that later you can tell whether it is solved? **[decision]**
- **A2. What Changes ↔ specs.** Is every What Changes item covered by a requirement in specs? Does every requirement follow from What Changes? A requirement that follows from nothing is scope creep.
- **A3. Capabilities.** Does the name describe a durable system behavior (`order-refunds`) rather than a task (`add-refund-endpoint`)? Is there a similar capability under another name in `openspec/specs/`? **[code]**: `ls openspec/specs`, `openspec list --specs`.
- **A4. Route.** Do the size and signals match the content? A new table, an external call or money at size S is a wrong classification. Do the skills in the line match the signals in the artifacts?
- **A5. Impact.** Are API, event and DB schema changes listed explicitly? Breaking ones marked **BREAKING**? Who consumes the changed API and events: inside the repository **[code]** — clients, contract tests, listeners; outside it — **[decision]**.
- **A6. L.** Is a split into independent PRs proposed?
- **A7. Current behavior.** Are claims like "PAID cannot be cancelled now" true? **[code]**

## B. specs — requirements and scenarios

For every requirement and scenario in the deltas, starting with the focus one.

- **B1. Form.** One requirement — one behavior? Does the text have SHALL or MUST? Does every requirement have a scenario? (The script catches mechanics, you catch meaning: a requirement "the system SHALL handle refunds" covering five behaviors must be split.)
- **B2. Scenario = test.** WHEN sets the input conditions: state, request, role. THEN is an observable result with literals: HTTP status, error `code`, a response field, a DB row state, a published event with its key. "Correctly", "successfully", "returns an error" without a code — rewrite.
- **B3. A test without design.** Can a test be written reading only the scenario? If design.md is needed for that, the scenario lacks a value.
- **B4. Error paths — as separate scenarios:**
  - invalid input → 400 and a `code`;
  - no authentication → 401;
  - no permission → 403;
  - someone else's or a non-existent resource → 404 (or 403 — **[decision]**, but the same across the API **[code]**);
  - a state conflict or duplicate → 409;
  - a broken business rule → 422 (or 409 — as the project does it **[code]**);
  - an external system unavailable or timing out → what the client sees and what remains in the DB.
- **B5. States.** Does behavior depend on a status? Build a "status × operation" matrix from the enum in the code **[code]** and compare it with the scenarios. Is every cell clearly allowed or not? Do forbidden transitions have scenarios with a code? A new status: what do all existing operations do with it?
- **B6. Retry.** Does the operation have a side effect: a write together with an event, an external call, money? A scenario "the same request or event twice → one effect" is needed. The same key but a different body → what?
- **B7. Concurrency.** Two simultaneous requests to one resource: a double click, two operators, a webhook and a user, two pods. What does the second one get?
- **B8. Edges.** An empty list, 0, a negative number, a maximum, string length, `null` and a missing field, money rounding, a date at the day boundary and time zone, the last pagination page.
- **B9. Existing data.** Rows created before the change (without the new field, in an old status): what does the API show for them? A scenario or a decision in design is needed.
- **B10. Compatibility.** Old clients that do not send the new field. Consumers that will get a new enum value or a new field in an event. Existing calls of the changed endpoint. If something breaks, the proposal marks it BREAKING.
- **B11. MODIFIED.** Was the block copied from the main spec in full? Are base scenarios that disappeared (script: `modified-lost-scenario`) removed on purpose? If the behavior stays — restore the scenario. If it goes — it is a behavior change, and the proposal names it.
- **B12. Contradictions.** Does a requirement contradict others — in this change, in main specs, in other active changes (script: `overlapping-change`)?
- **B13. No implementation.** The spec has no class, table or framework names unless they are part of the external contract. They belong in design.
- **B14. Non-functional.** Limits, timeouts, SLA, event order, delivery guarantees — what consumers rely on — described in the spec or explicitly excluded?

## C. design.md

The frame is the six steps of `think-before-coding`. In the `java-flow` schema they match the Decisions subsections; in `spec-driven` look for the answers across the whole document.

- **C1. Context.** Component type, where it lives, load as a number: rps, size of the affected tables, batch size. Not in the repository — **[decision]**.
- **C2. Data and invariants.** Is every invariant from the scenarios ("at most one active payment", "the sum of refunds is at most the paid amount") pinned by a constraint (UNIQUE, partial UNIQUE, CHECK, FK), not only by a check in the service? Types: money — `numeric` / `BigDecimal`, instants — `timestamptz` / `Instant`, status — `text` + CHECK and `@Enumerated(STRING)`. How existing changesets and entities do it **[code]**.
- **C3. Transaction boundary and build order.** Where does the transaction start and end? No external calls or event publishing inside? Is the slice order written down, and does `tasks.md` follow it?
- **C4. Errors.** Does the "situation → status → `code`" table match the scenarios in specs letter for letter? Are the codes stable and in the style of the existing `@RestControllerAdvice` **[code]**? Are there timeouts and behavior for an external system failing?
- **C5. Authorization.** Who calls, with which permission, how is row access limited? Does the owner or tenant come from the principal, not the request body? The same as neighboring endpoints **[code]**?
- **C6. Retries and concurrency.** The idempotency key: where it comes from, where it is stored, how long it lives. Event deduplication, `@Version` or a lock, outbox. Does every retry and concurrency scenario from specs have a mechanism here?
- **C7. Observability.** Logs at the boundary with business identifiers, metrics (RED, lag, retries, DLT), health. How will the on-call engineer notice a breakage?
- **C8. Decisions.** Does every decision have a rejected alternative and a reason? Is a decision visible from outside reflected by a scenario in specs?
- **C9. Extensibility.** Does the change add a variant to a set the code already branches on? Find the branching **[code]** and run `java-extensibility-review` on it. Is the verdict recorded? If "refactor first" — the first group in tasks is "Preparatory refactoring".
- **C10. Risks.** Does every risk have a mitigation and a way to detect it? Are the risks from the pre-mortem (section G) here?
- **C11. Migration Plan** — if the schema changes:
  - the changesets are new, applied ones are not edited **[code]**: changelog;
  - NOT NULL on a big table — CHECK `NOT VALID` → `VALIDATE` → `SET NOT NULL`; FK — `NOT VALID`; index — `CONCURRENTLY`;
  - rename, drop and type change — via expand/contract;
  - backfill outside the changeset; `lock_timeout` is there;
  - rolling back the code without rolling back the schema is possible: during a rolling deploy the old code version works with the new schema;
  - table size — **[decision]** if it is not in the repository.
- **C12. Open Questions.** Can every question be deferred? If the answer changes specs, the approach or tasks, it is not an Open Question but a question for the user now — a blocker.
- **C13. Facts.** Do table and class names, existing statuses, current constraints, the Spring Boot version and the available libraries match the code **[code]**?
- **C14. A new technology or dependency** is defended per `boring-by-default`: which measurable problem does the current stack not solve?

## D. tasks.md

- **D1. Format.** `- [ ] X.Y …`, and every task has "— verify: <test or command>". The script catches the mechanics.
- **D2. Scenarios ↔ tasks.** Every new or changed scenario → a task. A task without a scenario is one of three: a behavior missing from specs (add a scenario); scope creep (remove the task); preparatory or infrastructure work (keep it). The script matches by name — recheck by eye.
- **D3. Order.** Groups are slices in the build order from design. A task depends only on tasks above it, not below.
- **D4. The test level** fits the scenario (`testing-with-discernment`):
  - DB and constraints — `@DataJpaTest` + Testcontainers, not H2;
  - HTTP contract — `@WebMvcTest`;
  - the whole scenario — `@SpringBootTest` + Testcontainers;
  - Kafka — Testcontainers or `@EmbeddedKafka`, whichever the project has **[code]**: `pom.xml`;
  - external HTTP — WireMock; time — `Clock`.

  Does the project have the needed test infrastructure **[code]**?
- **D5. Groups.** No tests in a separate group at the end. The last group "Verification" holds only integration checks, and its contents match the signals: `review-migration` for changesets; `java-code-reviewer` and `critic` for M and L; `security-reviewer` for endpoints and roles in L; `incident-thinker` for consumers, jobs and money in L; `java-extensibility-review` if branching grew; `test-audit` for new tests.
- **D6. Task size.** Does a task fit into one session? "Implement refunds" — split by scenarios.
- **D7. Decisions without a scenario.** A changeset, metrics, config, ShedLock from design — does each have a task with a verification?
- **D8. A change in progress.** Are there ticked `[x]` tasks? Then edits go through `/opsx:update`, ticked tasks are not touched.
- **D9. Parallel work.** Only if several agents will implement the change (an `agent-network` swarm): can the groups be split between agents without one waiting on another? Groups in build order (schema → entity → service → API) cannot; vertical slices with a contract fixed in `design.md` can. Not splittable — a remark, not a blocker: one agent will be faster.

## E. Cross-checking

- **E1. Names.** Statuses, fields, error codes, events, endpoints are named the same in all artifacts. `REFUND_EXCEEDS_PAID` in design and `REFUND_TOO_LARGE` in the spec is a finding.
- **E2. proposal ↔ design.** Every signal from the "Route" line is addressed in Decisions.
- **E3. design ↔ specs.** Every decision visible from outside (an error code, a status, an event, a limit) has a scenario.
- **E4. design ↔ tasks.** The Migration Plan, metrics, config and preparatory refactoring have tasks.
- **E5. specs ↔ tasks.** See D2.
- **E6. config.yaml.** The project's `rules` are met in all artifacts.

## F. Facts from the code

- **F1.** Entities, tables, endpoints and events from the artifacts exist where stated, or are explicitly new. Grep by name.
- **F2.** The current behavior the proposal and MODIFIED rely on really is so: controller, service, tests.
- **F3.** The branching on type or status to which a variant is added — where it is and in how many places (for C9).
- **F4.** Which existing tests break from the behavior change? Fixing them is a task too.
- **F5.** The project's conventions: error format, changeset style, the integration test base class, profiles. Do the artifacts follow them?
- **F6.** The calling code of the changed methods and the event consumers inside the repository.

## G. Pre-mortem on the artifacts

Imagine: the change was implemented exactly per the artifacts, and two weeks after the release an incident happened. Why? These are the `critic` agent's axes, applied to the artifacts rather than to a diff. Write down only the scenarios the artifacts do not close.

- **G1. Existing data** — B9, C11.
- **G2. Deploy and rollback.** During a rolling deploy the old and new versions run at the same time: are they compatible with one schema and event format? Can the code be rolled back without rolling back the schema?
- **G3. Consumers** — A5, B10.
- **G4. Retries and races** — B6, B7, C6.
- **G5. Partial failures.** A failure between steps: the DB is written but the event did not go out; money is charged but the status is not updated. What state remains and who finishes it — a worker, a retry, a manual action? The answer must be in design.
- **G6. Load.** Unbounded selects, reports and batch at production volumes.
- **G7. Security.** IDOR, mass assignment, a webhook without a signature check, PII in logs and error responses.
- **G8. Observability.** How we notice a breakage at night and fix it without a deploy: a replay from the DLT, a manual restart, a flag.

## What not to ask

- Style and wording, unless they prevent writing a test.
- What is already decided in the artifacts and does not contradict the code.
- Facts you can find yourself.
- Line-level implementation: that is the job of `/opsx:apply`.

# Tasks

<!-- If design.md decided to refactor first, the first group is "Preparatory refactoring": behavior does not change, tests green before and after. -->

## 1. <!-- Slice, e.g. "Schema and repository" -->

- [ ] 1.1 <!-- Scenario or behavior --> — <!-- test level --> — verify: <!-- test or command -->
- [ ] 1.2 <!-- Scenario or behavior --> — <!-- test level --> — verify: <!-- test or command -->

## 2. <!-- Slice, e.g. "API" -->

- [ ] 2.1 <!-- Scenario or behavior --> — <!-- test level --> — verify: <!-- test or command -->

## 3. Verification

- [ ] 3.1 Full run `./mvnw verify` (or `./gradlew check`) — 0 failed; whatever did not run is named
- [ ] 3.2 Agents `java-code-reviewer` and `critic` on the diff, in one message — review findings ≥ 80 and confirmed critic blockers fixed test-first or listed in the report; critic questions — to the user
<!-- By signals: java-extensibility-review (branching on type or status grew), review-migration (changesets), test-audit (new tests), for L — security-reviewer, schema-reviewer, incident-thinker -->
